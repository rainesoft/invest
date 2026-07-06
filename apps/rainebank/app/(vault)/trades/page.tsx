'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';
import { Activity, Briefcase, TrendingUp, DollarSign } from 'lucide-react';

type Trade = {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  status: string;
  entry_price?: number;
  opened_at?: string;
};

export default function Page() {
  const client = supabase;
  const [trades, setTrades] = useState<Trade[]>([]);
  const [capital, setCapital] = useState(10000);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [{ data: tradesData }, { data: settingsData }] = await Promise.all([
        client.from('trades').select('*').order('opened_at', { ascending: false }),
        client.from('user_risk_settings').select('portfolio_capital').limit(1).single(),
      ]);

      setTrades(tradesData ?? []);
      if (settingsData) setCapital(settingsData.portfolio_capital);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const channel = client
      .channel('trades-history')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
        load();
      })
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <div style={{ color: '#38bdf8', fontSize: '18px', fontWeight: 600 }}>Syncing Ledger...</div>
      </div>
    );
  }

  const openTrades = trades.filter(t => t.status === 'OPEN').length;

  return (
    <div style={{ paddingBottom: '64px' }}>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '36px', fontWeight: 800, color: '#fff', letterSpacing: '-1px', margin: 0 }}>
          My Ledger
        </h1>
        <p style={{ color: '#9ca3af', margin: '8px 0 0 0', fontSize: '16px' }}>
          Real-time execution log and portfolio tracker, isolated securely to your account.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '24px',
        marginBottom: '40px'
      }}>
        {/* Metric Card 1 */}
        <div style={{
          background: 'rgba(30, 30, 30, 0.6)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ background: 'rgba(56, 189, 248, 0.1)', padding: '10px', borderRadius: '12px', color: '#38bdf8' }}>
              <Briefcase size={20} />
            </div>
            <div style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>Portfolio Capital</div>
          </div>
          <div style={{ fontSize: '32px', fontWeight: 700, color: '#fff' }}>
            ${capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Metric Card 2 */}
        <div style={{
          background: 'rgba(30, 30, 30, 0.6)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '12px', color: '#10b981' }}>
              <Activity size={20} />
            </div>
            <div style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>Active Executions</div>
          </div>
          <div style={{ fontSize: '32px', fontWeight: 700, color: '#fff' }}>
            {openTrades}
          </div>
        </div>
      </div>

      <div style={{
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '16px',
        overflow: 'hidden'
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #333' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff' }}>Execution Log</h3>
        </div>
        
        {trades.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            No executions found on your ledger yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontWeight: 500, fontSize: '13px' }}>ASSET</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontWeight: 500, fontSize: '13px' }}>DIRECTION</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontWeight: 500, fontSize: '13px' }}>SIZE</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontWeight: 500, fontSize: '13px' }}>PRICE</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontWeight: 500, fontSize: '13px' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid #333', transition: 'background 0.2s' }}>
                    <td style={{ padding: '16px 24px', color: '#fff', fontWeight: 600 }}>{t.symbol}</td>
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ 
                        color: t.side === 'LONG' ? '#10b981' : '#ef4444',
                        background: t.side === 'LONG' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 700
                      }}>
                        {t.side}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', color: '#d1d5db' }}>{t.qty}</td>
                    <td style={{ padding: '16px 24px', color: '#d1d5db' }}>{t.entry_price ? `$${t.entry_price}` : '-'}</td>
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ 
                        color: t.status === 'OPEN' ? '#38bdf8' : (t.status === 'CLOSED' ? '#9ca3af' : '#f59e0b'),
                        fontSize: '13px',
                        fontWeight: 500
                      }}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

