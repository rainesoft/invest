'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingForBot, setWaitingForBot] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, [supabase.auth]);

  // Poll for telegram_chat_id once waitingForBot is true
  useEffect(() => {
    if (!waitingForBot || !userId) return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('user_risk_settings')
        .select('telegram_chat_id')
        .eq('user_id', userId)
        .single();

      if (data && data.telegram_chat_id) {
        clearInterval(interval);
        
        // Ensure wallet exists before proceeding
        const { data: wallet } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', userId)
          .single();
  
        if (!wallet) {
           await supabase.from('wallets').insert({
              user_id: userId,
              ledger_balance: 0,
              escrow_balance: 0
           });
        }

        router.push('/dashboard');
        router.refresh();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [waitingForBot, userId, supabase, router]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setLoading(true);
    setError(null);

    try {
      const token = crypto.randomUUID();

      // Check if user_risk_settings already exists
      const { data: existing } = await supabase
        .from('user_risk_settings')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (existing) {
        await supabase
          .from('user_risk_settings')
          .update({ telegram_link_token: token })
          .eq('user_id', userId);
      } else {
        await supabase
          .from('user_risk_settings')
          .insert({
            user_id: userId,
            telegram_link_token: token,
            risk_per_trade_pct: 1.0, // Platform default
            max_daily_drawdown_pct: 5.0,
            is_live_execution_enabled: false
          });
      }

      setWaitingForBot(true);
      window.open(`https://t.me/rainebank_bot?start=${token}`, '_blank');

    } catch (err: any) {
      setError(err.message || 'An error occurred during onboarding.');
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '500px', width: '100%', padding: '40px', background: '#111', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
        
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '16px', letterSpacing: '-1px' }}>Welcome to Raine Bank</h1>
        <p style={{ color: '#9ca3af', marginBottom: '32px', lineHeight: 1.5 }}>
          As a member of our Platform PAMM, your capital is securely traded by our AI Master Account alongside institutional funds. 
          To finalize your account setup, please connect your Telegram for real-time trade alerts.
        </p>

        {error && (
          <div style={{ padding: '16px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '8px', marginBottom: '24px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'rgba(56,189,248,0.05)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(56,189,248,0.2)' }}>
            <input type="checkbox" required style={{ marginTop: '4px' }} />
            <p style={{ fontSize: '13px', color: '#9ca3af', margin: 0, lineHeight: 1.5 }}>
              I acknowledge that trading involves risk. I understand that I am depositing funds into the Raine Bank PAMM ecosystem and that the AI will autonomously manage capital on my behalf.
            </p>
          </div>

          {!waitingForBot ? (
            <button 
              type="submit" 
              disabled={loading}
              style={{
                background: '#38bdf8', color: '#000', padding: '16px', borderRadius: '100px',
                border: 'none', fontSize: '16px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1, marginTop: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg>
              {loading ? 'Generating Link...' : 'Connect Telegram'}
            </button>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#38bdf8', marginBottom: '8px' }}>Waiting for connection...</div>
              <div style={{ fontSize: '14px', color: '#9ca3af' }}>Please click "Start" in the Telegram app to verify your account.</div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
