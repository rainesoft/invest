'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, RefreshCcw, Landmark } from 'lucide-react';
import toast from 'react-hot-toast';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function WalletPage() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [isDepositing, setIsDepositing] = useState(false);

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    
    const { data, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('is_platform', false)
      .order('currency', { ascending: true });
      
    if (data) setWallets(data);
    setLoading(false);
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDepositing(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch('/api/wallet/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ amount: parseFloat(amount), currency })
      });

      const data = await res.json();
      
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
      } else {
        toast.error(data.error || 'Failed to initialize deposit');
      }
    } catch (err) {
      toast.error('An error occurred');
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <Landmark className="w-8 h-8 text-indigo-400" />
            Rainebank Escrow
          </h1>
          <p className="text-slate-400 mt-2">Manage your institutional trading capital across multiple currencies.</p>
        </div>
        <button onClick={fetchWallets} className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition">
          <RefreshCcw className="w-5 h-5 text-slate-300" />
        </button>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-3 text-center py-10 text-slate-500">Loading wallets...</div>
        ) : wallets.length === 0 ? (
          <div className="col-span-3 text-center py-10 text-slate-500 bg-slate-800/50 rounded-xl border border-slate-700">
            No active wallets found. Make a deposit to instantiate your ledger.
          </div>
        ) : (
          wallets.map(w => (
            <div key={w.id} className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 p-6 rounded-2xl shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Wallet className="w-24 h-24" />
              </div>
              <p className="text-slate-400 font-medium mb-1">{w.currency} Balance</p>
              <h2 className="text-4xl font-bold text-white tracking-tight">
                {w.currency === 'USD' ? '$' : w.currency === 'NGN' ? '₦' : '₵'}{Number(w.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </h2>
            </div>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Deposit Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-white flex items-center gap-2 mb-6">
            <ArrowDownToLine className="w-5 h-5 text-emerald-400" />
            Deposit Capital
          </h3>
          <form onSubmit={handleDeposit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Currency</label>
              <select 
                value={currency} 
                onChange={e => setCurrency(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="USD">USD - US Dollar</option>
                <option value="NGN">NGN - Nigerian Naira</option>
                <option value="GHS">GHS - Ghanaian Cedi</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Amount</label>
              <input 
                type="number" 
                min="1"
                step="0.01"
                required
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <button 
              type="submit" 
              disabled={isDepositing}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-3 rounded-lg transition disabled:opacity-50"
            >
              {isDepositing ? 'Initializing...' : 'Proceed to Paystack Gateway'}
            </button>
          </form>
        </div>

        {/* Withdraw Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 opacity-75">
          <h3 className="text-xl font-semibold text-white flex items-center gap-2 mb-6">
            <ArrowUpFromLine className="w-5 h-5 text-rose-400" />
            Request Withdrawal
          </h3>
          <div className="text-slate-400 text-sm mb-4">
            Withdrawal architecture is implemented securely on the backend via escrow locks. The frontend UI for bank account selection is coming in the next update.
          </div>
          <button disabled className="w-full bg-slate-700 text-slate-400 font-medium py-3 rounded-lg cursor-not-allowed">
            Coming Soon
          </button>
        </div>
      </div>
    </div>
  );
}
