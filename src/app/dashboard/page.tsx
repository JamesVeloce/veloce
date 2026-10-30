import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function DashboardPage() {
  const { data: invoices } = await supabase
    .from('failed_invoices')
    .select('*, customers(email, name)')
    .order('created_at', { ascending: false });

  const { data: logs } = await supabase
    .from('recovery_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  const totalFailedInvoices = invoices?.length || 0;
  
  const totalAtRiskCents = invoices
    ?.filter((inv) => inv.status === 'recovering')
    .reduce((sum, inv) => sum + inv.amount_due_cents, 0) || 0;

  const totalRecoveredCents = invoices
    ?.filter((inv) => inv.status === 'recovered')
    .reduce((sum, inv) => sum + inv.amount_due_cents, 0) || 0;

  return (
    <div style={{ maxWidth: '1100px', margin: '40px auto', padding: '0 20px', fontFamily: 'sans-serif' }}>
      <header style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0' }}>Veloce Dunning Dashboard</h1>
        <p style={{ color: '#9ca3af', margin: 0 }}>Monitor failed subscription payments and active recovery workflows.</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '40px' }}>
        <div style={{ padding: '20px', borderRadius: '8px', border: '1px solid #374151', background: '#ffffff' }}>
          <span style={{ fontSize: '14px', color: '#4b5563', fontWeight: 'bold' }}>At-Risk Revenue</span>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '8px 0 0 0', color: '#dc2626' }}>
            ${(totalAtRiskCents / 100).toFixed(2)}
          </p>
        </div>

        <div style={{ padding: '20px', borderRadius: '8px', border: '1px solid #374151', background: '#ffffff' }}>
          <span style={{ fontSize: '14px', color: '#4b5563', fontWeight: 'bold' }}>Recovered Revenue</span>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '8px 0 0 0', color: '#16a34a' }}>
            ${(totalRecoveredCents / 100).toFixed(2)}
          </p>
        </div>

        <div style={{ padding: '20px', borderRadius: '8px', border: '1px solid #374151', background: '#ffffff' }}>
          <span style={{ fontSize: '14px', color: '#4b5563', fontWeight: 'bold' }}>Total Failed Invoices</span>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '8px 0 0 0', color: '#111827' }}>
            {totalFailedInvoices}
          </p>
        </div>
      </div>

      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>Failed Invoices</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #374151', color: '#9ca3af', fontSize: '14px' }}>
              <th style={{ padding: '12px 8px' }}>Customer</th>
              <th style={{ padding: '12px 8px' }}>Invoice ID</th>
              <th style={{ padding: '12px 8px' }}>Amount</th>
              <th style={{ padding: '12px 8px' }}>Status</th>
              <th style={{ padding: '12px 8px' }}>Step</th>
            </tr>
          </thead>
          <tbody>
            {invoices && invoices.length > 0 ? (
              invoices.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid #374151', fontSize: '14px' }}>
                  <td style={{ padding: '12px 8px' }}>
                    <strong>{inv.customers?.name || 'Unknown'}</strong>
                    <br />
                    <span style={{ color: '#9ca3af', fontSize: '12px' }}>{inv.customers?.email}</span>
                  </td>
                  <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>{inv.stripe_invoice_id}</td>
                  <td style={{ padding: '12px 8px' }}>
                    ${(inv.amount_due_cents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        backgroundColor: inv.status === 'recovering' ? '#fef3c7' : '#dcfce7',
                        color: inv.status === 'recovering' ? '#b45309' : '#15803d',
                      }}
                    >
                      {inv.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>Step {inv.current_step}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>
                  No failed invoices recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>Activity Logs</h2>
        <div style={{ border: '1px solid #374151', borderRadius: '8px', padding: '16px', background: '#ffffff' }}>
          {logs && logs.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {logs.map((log) => (
                <li
                  key={log.id}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: '14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#111827',
                  }}
                >
                  <span>
                    <strong style={{ color: '#1f2937' }}>[{log.event_type.toUpperCase()}]</strong> {log.details}
                  </span>
                  <span style={{ color: '#6b7280', fontSize: '12px', marginLeft: '12px' }}>
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: '#6b7280', margin: 0 }}>No recovery activity logged yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}