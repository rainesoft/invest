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
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="flex items-center mb-6 gap-4 border-b border-white/5 pb-6">
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
            <Clock size={24} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 tracking-tight m-0 mb-1">Pending Deposits</h2>
            <p className="text-gray-400 text-sm font-medium m-0">Review and clear funds routed to the Master Broker.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        ) : deposits.length === 0 ? (
          <div className="text-center py-16 px-6 bg-black/20 rounded-xl border border-dashed border-white/10">
            <p className="text-gray-500 font-medium m-0">No pending deposits to review.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-sm text-gray-400 bg-black/20">
                  <th className="p-4 font-bold uppercase tracking-wider">User</th>
                  <th className="p-4 font-bold uppercase tracking-wider">Reference</th>
                  <th className="p-4 font-bold uppercase tracking-wider">Amount</th>
                  <th className="p-4 font-bold uppercase tracking-wider">Date</th>
                  <th className="p-4 font-bold uppercase tracking-wider text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {deposits.map((req) => (
                  <tr key={req.id} className="hover:bg-white/5 transition-colors group cursor-default">
                    <td className="p-4 text-white text-sm font-medium">
                      {req.user_email}
                    </td>
                    <td className="p-4 text-gray-400 text-sm font-mono bg-black/20 inline-block mt-3 mb-2 px-2 py-1 rounded border border-white/5">
                      {req.reference_code}
                    </td>
                    <td className="p-4 text-white text-base font-bold">
                      <div className="flex items-center gap-1.5">
                        <DollarSign size={16} className="text-blue-400" />
                        {Number(req.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </td>
                    <td className="p-4 text-gray-400 text-sm font-medium">
                      {new Date(req.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleApprove(req.id)}
                        disabled={approving === req.id}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                          approving === req.id 
                            ? 'bg-blue-500/50 text-white cursor-not-allowed' 
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)] hover:shadow-[0_0_20px_rgba(59,130,246,0.6)] hover:-translate-y-0.5'
                        }`}
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
