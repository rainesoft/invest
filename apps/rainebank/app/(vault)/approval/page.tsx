'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';
import { ShieldCheck, XCircle, CheckCircle, Activity, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

type Signal = {
  id: string;
  symbol: string;
  side: string;
  timeframe: string;
  entry_plan_json?: { price: number };
  stop_plan_json?: { price: number };
  take_profit_json?: { price: number };
  risk_summary?: string;
  confidence?: number;
  ai_summary?: string;
  created_at: string;
};

export default function ApprovalPage() {
  const client = supabase;
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      // Check admin status
      const { data: settings, error: authErr } = await client
        .from('user_risk_settings')
        .select('is_admin')
        .limit(1)
        .single();
        
      if (authErr || !settings?.is_admin) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      
      setIsAdmin(true);

      // Fetch pending signals
      const { data: pendingSignals, error: sigErr } = await client
        .from('trade_opportunities')
        .select('*')
        .eq('status', 'PENDING_APPROVAL')
        .order('created_at', { ascending: false });

      if (sigErr) throw sigErr;
      setSignals(pendingSignals || []);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const channel = client
      .channel('pending-signals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_opportunities' }, () => {
        loadData();
      })
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client]);

  const handleAction = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    try {
      const { error } = await client
        .from('trade_opportunities')
        .update({ status: action })
        .eq('id', id);

      if (error) throw error;
      toast.success(`Signal ${action.toLowerCase()} successfully!`);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <div style={{ color: '#38bdf8', fontSize: '18px', fontWeight: 600 }}>Authenticating Admin...</div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div style={{ padding: '64px 24px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', background: 'rgba(239, 68, 68, 0.1)', padding: '16px', borderRadius: '50%', marginBottom: '24px' }}>
          <ShieldCheck size={48} color="#ef4444" />
        </div>
        <h1 style={{ fontSize: '32px', color: '#fff', fontWeight: 800 }}>Access Denied</h1>
        <p style={{ color: '#9ca3af', maxWidth: '400px', margin: '16px auto' }}>
          This area is restricted to administrators. You do not have permission to view or approve pending signals.
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: '64px' }}>
      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ShieldCheck size={32} color="#38bdf8" />
          <h1 style={{ fontSize: '36px', fontWeight: 800, color: '#fff', letterSpacing: '-1px', margin: 0 }}>
            Command Center
          </h1>
        </div>
        <p style={{ color: '#9ca3af', margin: '8px 0 0 0', fontSize: '16px', paddingLeft: '44px' }}>
          Review and authorize pending AI signals before global execution.
        </p>
      </div>

      {signals.length === 0 ? (
        <div style={{ 
          background: 'rgba(30, 30, 30, 0.6)', 
          border: '1px solid rgba(255,255,255,0.05)', 
          borderRadius: '16px', 
          padding: '64px', 
          textAlign: 'center' 
        }}>
          <Activity size={48} color="#6b7280" style={{ margin: '0 auto 16px' }} />
          <h3 style={{ color: '#fff', fontSize: '20px', margin: '0 0 8px 0' }}>No Pending Signals</h3>
          <p style={{ color: '#9ca3af', margin: 0 }}>The AI has not generated any new opportunities requiring approval.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px' }}>
          {signals.map((sig) => (
            <div key={sig.id} style={{
              background: '#1a1a1a',
              border: `1px solid ${sig.side === 'LONG' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
            }}>
              {/* Header */}
              <div style={{ 
                padding: '20px 24px', 
                background: sig.side === 'LONG' ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }}>{sig.symbol}</span>
                  <span style={{ 
                    color: sig.side === 'LONG' ? '#10b981' : '#ef4444',
                    background: sig.side === 'LONG' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 700
                  }}>
                    {sig.side}
                  </span>
                </div>
                <div style={{ color: '#9ca3af', fontSize: '13px', fontWeight: 500 }}>
                  {sig.timeframe}
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>ENTRY</div>
                    <div style={{ color: '#fff', fontSize: '18px', fontWeight: 700 }}>{sig.entry_plan_json?.price || 'MARKET'}</div>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>STOP LOSS</div>
                    <div style={{ color: '#ef4444', fontSize: '18px', fontWeight: 700 }}>{sig.stop_plan_json?.price || '-'}</div>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>TAKE PROFIT</div>
                    <div style={{ color: '#10b981', fontSize: '18px', fontWeight: 700 }}>{sig.take_profit_json?.price || '-'}</div>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <AlertTriangle size={16} color="#f59e0b" />
                    <span style={{ color: '#f59e0b', fontSize: '14px', fontWeight: 600 }}>AI Risk Assessment</span>
                  </div>
                  <p style={{ color: '#d1d5db', fontSize: '14px', lineHeight: '1.5', margin: 0 }}>
                    {sig.ai_summary || 'No detailed analysis provided.'}
                  </p>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button 
                    onClick={() => handleAction(sig.id, 'REJECTED')}
                    style={{
                      flex: 1,
                      padding: '14px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                  >
                    <XCircle size={20} /> Reject
                  </button>
                  <button 
                    onClick={() => handleAction(sig.id, 'APPROVED')}
                    style={{
                      flex: 1,
                      padding: '14px',
                      background: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.2s',
                      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'none'}
                  >
                    <CheckCircle size={20} /> Approve Signal
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
