'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { CheckCircle, Clock, Loader2, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function AdminDepositsPage() {
  const [deposits, setDeposits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  useEffect(() => {
    fetchDeposits();
  }, []);

  const fetchDeposits = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('deposit_requests')
        .select('*')
        .eq('status', 'PENDING_CLEARANCE')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(d => d.user_id))];
        const { data: usersData } = await supabase
          .from('users')
          .select('id, email')
          .in('id', userIds);
          
        const userMap = (usersData || []).reduce((acc: any, u: any) => ({...acc, [u.id]: u.email}), {});
        const enrichedData = data.map(d => ({...d, user_email: userMap[d.user_id] || d.user_id}));
        setDeposits(enrichedData);
      } else {
        setDeposits([]);
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to fetch deposits');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    setApproving(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch('/api/admin/deposits/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ requestId: id })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve');

      toast.success('Deposit approved and cleared');
      fetchDeposits();
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setApproving(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{
        background: 'rgba(30, 41, 59, 0.5)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px',
        padding: '24px',
        overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px', gap: '12px' }}>
          <div style={{
            background: 'rgba(59, 130, 246, 0.1)',
            padding: '10px',
            borderRadius: '12px',
            color: '#3b82f6'
          }}>
            <Clock size={24} />
          </div>
          <div>
            <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 600, margin: '0 0 4px 0' }}>Pending Deposits</h2>
            <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0 }}>Review and clear funds routed to the Master Broker.</p>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <Loader2 className="animate-spin" size={32} color="#3b82f6" />
          </div>
        ) : deposits.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '12px',
            border: '1px dashed rgba(255,255,255,0.1)'
          }}>
            <p style={{ color: '#9ca3af', margin: 0 }}>No pending deposits to review.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', fontSize: '14px' }}>
                  <th style={{ padding: '12px', fontWeight: 500 }}>User</th>
                  <th style={{ padding: '12px', fontWeight: 500 }}>Reference</th>
                  <th style={{ padding: '12px', fontWeight: 500 }}>Amount</th>
                  <th style={{ padding: '12px', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '12px', fontWeight: 500, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((req) => (
                  <tr key={req.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '16px 12px', color: '#fff', fontSize: '14px' }}>
                      {req.user_email}
                    </td>
                    <td style={{ padding: '16px 12px', color: '#9ca3af', fontSize: '14px', fontFamily: 'monospace' }}>
                      {req.reference_code}
                    </td>
                    <td style={{ padding: '16px 12px', color: '#fff', fontSize: '16px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <DollarSign size={16} color="#3b82f6" />
                        {Number(req.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </td>
                    <td style={{ padding: '16px 12px', color: '#9ca3af', fontSize: '14px' }}>
                      {new Date(req.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '16px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleApprove(req.id)}
                        disabled={approving === req.id}
                        style={{
                          background: approving === req.id ? 'rgba(59, 130, 246, 0.5)' : '#3b82f6',
                          color: '#fff',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 600,
                          cursor: approving === req.id ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'background 0.2s'
                        }}
                      >
                        {approving === req.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <CheckCircle size={16} />
                        )}
                        {approving === req.id ? 'Approving...' : 'Mark as Deposited'}
                      </button>
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
