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
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex justify-between items-center flex-wrap gap-6 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
            <ArrowUpRight size={24} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 tracking-tight m-0 mb-1">Pending Withdrawals</h2>
            <p className="text-gray-400 text-sm font-medium m-0">
              {withdrawals.length} request{withdrawals.length !== 1 ? 's' : ''} in queue • Total Batch: <span className="text-white font-bold">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </p>
          </div>
        </div>
        
        <button
          onClick={handleProcessBatch}
          disabled={processing || withdrawals.length === 0}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg ${
            processing || withdrawals.length === 0
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-white/5'
              : 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-red-500/30 hover:shadow-[0_0_20px_rgba(239,68,68,0.6)] hover:-translate-y-0.5'
          }`}
        >
          {processing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
          {processing ? 'Processing...' : 'Process Batch'}
        </button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-red-500" size={32} />
          </div>
        ) : withdrawals.length === 0 ? (
          <div className="text-center py-16 px-6 bg-black/20">
            <Clock size={32} className="mx-auto mb-4 text-gray-600" />
            <p className="text-gray-500 font-medium m-0">No pending withdrawals to process.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-400 bg-black/40">
                  <th className="p-5 font-bold uppercase tracking-wider">User</th>
                  <th className="p-5 font-bold uppercase tracking-wider">Reference</th>
                  <th className="p-5 font-bold uppercase tracking-wider">Net Amount</th>
                  <th className="p-5 font-bold uppercase tracking-wider">Fee</th>
                  <th className="p-5 font-bold uppercase tracking-wider">Destination</th>
                  <th className="p-5 font-bold uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {withdrawals.map((w) => (
                  <tr key={w.id} className="hover:bg-white/5 transition-colors group cursor-default">
                    <td className="p-5 text-white text-sm font-medium">
                      {w.user_email}
                    </td>
                    <td className="p-5 text-gray-400 text-sm font-mono bg-black/40 inline-block mt-3.5 mb-2 px-2 py-1 rounded border border-white/5">
                      {w.reference_code}
                    </td>
                    <td className="p-5 text-white text-base font-bold">
                      {w.currency} {Number(w.amount).toFixed(2)}
                    </td>
                    <td className="p-5 text-gray-400 text-sm font-medium">
                      {w.currency} {Number(w.performance_fee || 0).toFixed(2)}
                    </td>
                    <td className="p-5 text-gray-400 text-sm">
                      {w.destination_details?.recipient_code || 'Unknown'}
                    </td>
                    <td className="p-5 text-gray-400 text-sm font-medium">
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
