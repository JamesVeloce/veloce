import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const runtime = 'nodejs';

// Lazy initialization helpers to prevent build-time environment variable errors
function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(secretKey, { apiVersion: '2023-10-16' });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key);
}

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Missing RESEND_API_KEY');
  return new Resend(apiKey);
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const stripe = getStripe();
  const supabase = getSupabaseAdmin();
  const resend = getResend();

  let event: Stripe.Event;

  try {
    if (webhookSecret && signature) {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } else {
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const customerEmail = invoice.customer_email;
        const hostedInvoiceUrl = invoice.hosted_invoice_url;

        // 1. Log payment failure to Supabase
        const { error: dbError } = await supabase
          .from('dunning_logs')
          .insert({
            stripe_customer_id: customerId,
            customer_email: customerEmail,
            amount_due: invoice.amount_due,
            status: 'failed',
            attempt_count: invoice.attempt_count,
            created_at: new Date().toISOString(),
          });

        if (dbError) {
          console.error('Supabase logging error:', dbError);
        }

        // 2. Trigger automated dunning recovery email via Resend
        if (customerEmail && hostedInvoiceUrl) {
          await resend.emails.send({
            from: 'Veloce Dunning <billing@veloce.app>',
            to: customerEmail,
            subject: 'Action Required: Payment failed for your subscription',
            html: `
              <div style="font-family: sans-serif; padding: 20px;">
                <h2>Payment Failed</h2>
                <p>We were unable to process your payment of $${(invoice.amount_due / 100).toFixed(2)}.</p>
                <p>Please update your payment details to keep your subscription active:</p>
                <p><a href="${hostedInvoiceUrl}" style="background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Update Payment Method</a></p>
              </div>
            `,
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await supabase
          .from('subscriptions')
          .upsert({
            stripe_subscription_id: subscription.id,
            stripe_customer_id: subscription.customer as string,
            status: subscription.status,
            updated_at: new Date().toISOString(),
          });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook execution error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}