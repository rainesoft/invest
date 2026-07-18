'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, RefreshCcw, Landmark, Info } from 'lucide-react';
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

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawWalletId, setWithdrawWalletId] = useState('');
  const [recipientCode, setRecipientCode] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('is_platform', false)
        .order('currency', { ascending: true });

      if (data) {
        setWallets(data);
        if (data.length > 0) {
          setWithdrawWalletId(prev => prev || data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch wallets:', err);
    } finally {
      setLoading(false);
    }
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

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawWalletId) return toast.error('Please select a wallet');

    setIsWithdrawing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const selectedWallet = wallets.find(w => w.id === withdrawWalletId);
      if (!selectedWallet) throw new Error('Invalid wallet');

      if (parseFloat(withdrawAmount) > selectedWallet.balance) {
        throw new Error('Insufficient funds. You cannot withdraw more than your wallet balance.');
      }

      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          amount: parseFloat(withdrawAmount),
          currency: selectedWallet.currency,
          walletId: withdrawWalletId,
          destination: { recipient_code: recipientCode }
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to request withdrawal');
      }

      toast.success(data.message || 'Withdrawal initiated successfully!');
      setWithdrawAmount('');
      setRecipientCode('');
      fetchWallets(); // refresh balances
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setIsWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <div style={{ color: '#38bdf8', fontSize: '18px', fontWeight: 600 }}>Syncing Ledger...</div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: '64px' }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '36px', fontWeight: 800, color: '#fff', letterSpacing: '-1px', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
            Wallet
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '15px', marginTop: '8px' }}>
            Manage your institutional trading capital across multiple currencies.
          </p>
        </div>
        <button
          onClick={fetchWallets}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '10px',
            borderRadius: '12px',
            color: '#e5e7eb',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          <RefreshCcw size={20} />
        </button>
      </div>

      {/* Processing Notice Banner */}
      <div style={{
        background: 'rgba(56, 189, 248, 0.1)',
        border: '1px solid rgba(56, 189, 248, 0.2)',
        borderRadius: '16px',
        padding: '20px',
        marginBottom: '32px',
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-start'
      }}>
        <Info size={24} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <h4 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, margin: '0 0 8px 0' }}>Processing Times</h4>
          <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0, lineHeight: '1.5' }}>
            Deposits and withdrawals may take up to <strong>3 business days</strong> to process. This is because funds are routed between your wallet and the broker.
            Your <strong>Ledger Balance</strong> includes pending transfers, while your <strong>Available Balance</strong> shows cleared funds actively deployed in the Virtual PAMM.
          </p>
        </div>
      </div>

      {/* Balances Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '40px' }}>
        {wallets.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '48px 32px', borderRadius: '24px', textAlign: 'center' }}>
            <div style={{ color: '#9ca3af', fontSize: '16px' }}>No active wallets found. Make a deposit to instantiate your ledger.</div>
          </div>
        ) : (
          wallets.map(w => (
            <div key={w.id} style={{
              background: 'linear-gradient(145deg, rgba(30,30,30,0.8) 0%, rgba(15,15,15,0.8) 100%)',
              border: '1px solid rgba(255,255,255,0.05)',
              padding: '32px',
              borderRadius: '24px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.05, transform: 'rotate(15deg)' }}>
                <Wallet size={120} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Available Balance</div>
                  <div style={{ fontSize: '40px', fontWeight: 800, color: '#fff', letterSpacing: '-1px', lineHeight: 1 }}>
                    {w.currency === 'USD' ? '$' : w.currency === 'NGN' ? '₦' : '₵'}{Number(w.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: '12px', color: '#38bdf8', marginTop: '6px', fontWeight: 500 }}>Active in PAMM Vault</div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Ledger Balance</div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: '#e5e7eb', letterSpacing: '-0.5px', lineHeight: 1 }}>
                    {w.currency === 'USD' ? '$' : w.currency === 'NGN' ? '₦' : '₵'}{Number(w.ledger_balance !== undefined ? w.ledger_balance : w.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '6px' }}>Total including pending bank transfers</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Actions Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        {/* Deposit Card */}
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ArrowDownToLine size={20} color="#4ade80" />
            Deposit Capital
          </h3>
          <form onSubmit={handleDeposit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>CURRENCY</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px 16px', color: '#fff', fontSize: '15px', outline: 'none' }}
              >
                <option value="USD">USD - US Dollar</option>
                <option value="NGN">NGN - Nigerian Naira</option>
                <option value="GHS">GHS - Ghanaian Cedi</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>AMOUNT</label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px 16px', color: '#fff', fontSize: '15px', outline: 'none' }}
              />
            </div>
            <button
              type="submit"
              disabled={isDepositing}
              style={{
                marginTop: '8px',
                width: '100%',
                background: isDepositing ? '#374151' : '#4ade80',
                color: isDepositing ? '#9ca3af' : '#064e3b',
                fontWeight: 700,
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                cursor: isDepositing ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {isDepositing ? 'Initializing...' : 'Proceed to Gateway'}
            </button>
          </form>
        </div>

        {/* Withdraw Card */}
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ArrowUpFromLine size={20} color="#f87171" />
            Request Withdrawal
          </h3>
          <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>SOURCE WALLET</label>
              <select
                value={withdrawWalletId}
                onChange={e => setWithdrawWalletId(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px 16px', color: '#fff', fontSize: '15px', outline: 'none' }}
              >
                {wallets.map(w => (
                  <option key={w.id} value={w.id}>{w.currency} - Balance: {w.currency === 'USD' ? '$' : w.currency === 'NGN' ? '₦' : '₵'}{Number(w.balance).toFixed(2)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>AMOUNT</label>
              <input
                type="number"
                min="1"
                step="0.01"
                max={wallets.find(w => w.id === withdrawWalletId)?.balance || 0}
                required
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px 16px', color: '#fff', fontSize: '15px', outline: 'none' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>PAYSTACK RECIPIENT CODE</label>
              <input
                type="text"
                required
                value={recipientCode}
                onChange={e => setRecipientCode(e.target.value)}
                placeholder="RCP_xxxxxxxxxx"
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px 16px', color: '#fff', fontSize: '15px', outline: 'none' }}
              />
            </div>
            <button
              type="submit"
              disabled={isWithdrawing || wallets.length === 0}
              style={{
                marginTop: '8px',
                width: '100%',
                background: isWithdrawing ? '#374151' : '#ef4444',
                color: isWithdrawing ? '#9ca3af' : '#fff',
                fontWeight: 700,
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                cursor: isWithdrawing || wallets.length === 0 ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {isWithdrawing ? 'Processing Escrow...' : 'Submit Request'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
