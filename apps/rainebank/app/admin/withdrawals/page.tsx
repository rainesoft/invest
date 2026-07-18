'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@lib/supabase';
import { ArrowUpRight, Clock, Loader2, DollarSign, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchWithdrawals();
  }, []);

  const fetchWithdrawals = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('withdrawal_requests')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map((d: any) => d.user_id))];
        const { data: usersData } = await supabase
          .from('users')
          .select('id, email')
          .in('id', userIds);
          
        const userMap = (usersData || []).reduce((acc: any, u: any) => ({...acc, [u.id]: u.email}), {});
        const enrichedData = data.map((d: any) => ({...d, user_email: userMap[d.user_id] || d.user_id}));
        setWithdrawals(enrichedData);
      } else {
        setWithdrawals([]);
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to fetch withdrawals');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessBatch = async () => {
    if (!confirm('Are you sure you want to process this batch of withdrawals? This will simulate Paystack transfers and deduct from the platform escrow wallet.')) return;
    
    setProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch('/api/admin/withdrawals/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process batch');

      toast.success(`Processed ${data.processedCount} withdrawals successfully!`);
      fetchWithdrawals();
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setProcessing(false);
    }
  };

  const totalAmount = withdrawals.reduce((sum, w) => sum + Number(w.amount), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{
        background: 'rgba(30, 41, 59, 0.5)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px',
        padding: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '24px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: 'rgba(248, 113, 113, 0.1)',
            padding: '10px',
            borderRadius: '12px',
            color: '#f87171'
          }}>
            <ArrowUpRight size={24} />
          </div>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#fff', margin: '0 0 4px 0' }}>Pending Withdrawals</h2>
            <p style={{ fontSize: '14px', color: '#9ca3af', margin: 0 }}>
              {withdrawals.length} request{withdrawals.length !== 1 ? 's' : ''} in queue • Total Batch: <span style={{ color: '#fff', fontWeight: 600 }}>${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </p>
          </div>
        </div>
        
        <button
          onClick={handleProcessBatch}
          disabled={processing || withdrawals.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '12px 24px', borderRadius: '12px',
            background: processing || withdrawals.length === 0 ? '#374151' : '#f87171',
            color: processing || withdrawals.length === 0 ? '#9ca3af' : '#fff',
            border: 'none', fontWeight: 600, cursor: processing || withdrawals.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {processing ? <Loader2 size={18} className="spin" /> : <CheckCircle size={18} />}
          {processing ? 'Processing...' : 'Process Batch'}
        </button>
      </div>

      <div style={{
        background: 'rgba(30, 41, 59, 0.5)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px',
        overflow: 'hidden'
      }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>Loading withdrawals...</div>
        ) : withdrawals.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af' }}>
            <Clock size={32} style={{ margin: '0 auto 16px auto', opacity: 0.5 }} />
            No pending withdrawals to process.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '12px', fontWeight: 600 }}>USER</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '12px', fontWeight: 600 }}>REFERENCE</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '12px', fontWeight: 600 }}>NET AMOUNT</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '12px', fontWeight: 600 }}>FEE</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '12px', fontWeight: 600 }}>DESTINATION</th>
                  <th style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '12px', fontWeight: 600 }}>DATE</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '16px 24px', color: '#e5e7eb', fontSize: '14px' }}>
                      {w.user_email}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '14px', fontFamily: 'monospace' }}>
                      {w.reference_code}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#fff', fontSize: '14px', fontWeight: 500 }}>
                      {w.currency} {Number(w.amount).toFixed(2)}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '14px' }}>
                      {w.currency} {Number(w.performance_fee || 0).toFixed(2)}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '14px' }}>
                      {w.destination_details?.recipient_code || 'Unknown'}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#9ca3af', fontSize: '14px' }}>
                      {new Date(w.created_at).toLocaleDateString()}
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
