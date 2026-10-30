import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const eventType = body.type;
    const eventData = body.data?.object;

    if (!eventData) {
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    // 1. HANDLE PAYMENT FAILURE (DUNNING INITIALIZATION)
    if (eventType === 'invoice.payment_failed') {
      const { id: invoiceId, customer_email, customer_name, amount_due, currency, hosted_invoice_url } = eventData;

      // Upsert customer
      const { data: customer, error: customerErr } = await supabase
        .from('customers')
        .upsert(
          { email: customer_email, name: customer_name || 'Valued Customer' },
          { onConflict: 'email' }
        )
        .select()
        .single();

      if (customerErr) throw customerErr;

      // Upsert failed invoice
      const { data: invoice, error: invoiceErr } = await supabase
        .from('failed_invoices')
        .upsert(
          {
            customer_id: customer.id,
            stripe_invoice_id: invoiceId,
            amount_due_cents: amount_due,
            currency: currency || 'usd',
            status: 'recovering',
            current_step: 1,
            hosted_invoice_url: hosted_invoice_url,
          },
          { onConflict: 'stripe_invoice_id' }
        )
        .select()
        .single();

      if (invoiceErr) throw invoiceErr;

      // Dispatch Dunning Email via Resend Sandbox
      const formattedAmount = (amount_due / 100).toFixed(2);
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: customer_email,
        subject: `Action Required: Payment failed ($${formattedAmount})`,
        html: `<p>Hi ${customer.name},</p>
               <p>We couldn't process your payment of <strong>$${formattedAmount}</strong>.</p>
               <p><a href="${hosted_invoice_url}">Click here to update your payment method.</a></p>`,
      });

      // Log activity
      await supabase.from('recovery_logs').insert({
        invoice_id: invoice.id,
        event_type: 'payment_failed',
        details: `Payment of $${formattedAmount} failed. Dunning sequence initialized.`,
      });

      console.log(`Successfully queued invoice ${invoiceId} for dunning recovery.`);
      return NextResponse.json({ status: 'success', message: 'Invoice queued for dunning recovery.' }, { status: 200 });
    }

    // 2. HANDLE PAYMENT SUCCESS (RECOVERY COMPLETED)
    if (eventType === 'invoice.payment_succeeded') {
      const { id: invoiceId, amount_paid } = eventData;

      // Mark invoice as recovered
      const { data: invoice } = await supabase
        .from('failed_invoices')
        .update({ status: 'recovered' })
        .eq('stripe_invoice_id', invoiceId)
        .select()
        .single();

      if (invoice) {
        const formattedAmount = (amount_paid / 100).toFixed(2);

        // Log recovery success
        await supabase.from('recovery_logs').insert({
          invoice_id: invoice.id,
          event_type: 'payment_recovered',
          details: `Payment of $${formattedAmount} successfully recovered!`,
        });
      }

      console.log(`Successfully marked invoice ${invoiceId} as recovered.`);
      return NextResponse.json({ status: 'success', message: 'Invoice marked as recovered.' }, { status: 200 });
    }

    return NextResponse.json({ status: 'ignored', message: 'Unhandled event type.' }, { status: 200 });
  } catch (err: any) {
    console.error('Webhook Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}