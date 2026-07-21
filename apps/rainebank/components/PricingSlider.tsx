'use client';

import Link from 'next/link';

interface PricingSliderProps {
  isLoggedIn: boolean;
}

export default function PricingSlider({ isLoggedIn }: PricingSliderProps) {
  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(37,99,235,0.1) 0%, rgba(10,10,10,1) 100%)',
      border: '1px solid rgba(56, 189, 248, 0.4)', borderRadius: '24px', padding: '40px',
      display: 'flex', flexDirection: 'column', position: 'relative',
      boxShadow: '0 24px 64px rgba(37, 99, 235, 0.15)'
    }}>
      <div style={{
        position: 'absolute', top: '-16px', right: '40px', background: '#38bdf8', color: '#000',
        padding: '6px 16px', borderRadius: '100px', fontSize: '13px', fontWeight: 700
      }}>
        PRO TIER
      </div>
      
      <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8', marginBottom: '16px' }}>Autopilot Pro</div>
      
      <div style={{ fontSize: '48px', fontWeight: 800, color: '#fff', marginBottom: '16px', letterSpacing: '-2px' }}>
        $199
        <span style={{ fontSize: '18px', color: '#9ca3af', fontWeight: 500, letterSpacing: '0' }}>/mo</span>
      </div>

      <p style={{ color: '#9ca3af', fontSize: '15px', marginBottom: '32px' }}>Avoid performance fees completely. Keep 100% of the profits the AI generates for a flat monthly subscription.</p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 40px 0', display: 'flex', flexDirection: 'column', gap: '16px', color: '#e5e7eb', flex: 1 }}>
        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          0% Performance Fee
        </li>
        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          Unlimited Deposit Capacity
        </li>
        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          Fully Automated Execution
        </li>
      </ul>

      {isLoggedIn ? (
        <button 
          onClick={async (e) => {
            const btn = e.currentTarget;
            btn.innerText = 'Redirecting...';
            btn.style.opacity = '0.7';
            try {
              const res = await fetch('/api/checkout/subscribe', { method: 'POST' });
              const data = await res.json();
              if (data.authorization_url) {
                window.location.href = data.authorization_url;
              } else {
                alert(data.error || 'Failed to initialize checkout');
                btn.innerText = 'Upgrade to Pro';
                btn.style.opacity = '1';
              }
            } catch(err) {
              alert('Network error');
              btn.innerText = 'Upgrade to Pro';
              btn.style.opacity = '1';
            }
          }}
          style={{
            background: '#fff', color: '#000', padding: '16px', borderRadius: '100px',
            textDecoration: 'none', fontSize: '15px', fontWeight: 600, textAlign: 'center',
            border: 'none', cursor: 'pointer', outline: 'none'
          }}
        >
          Upgrade to Pro
        </button>
      ) : (
        <Link href="/login" style={{
          background: '#fff', color: '#000', padding: '16px', borderRadius: '100px',
          textDecoration: 'none', fontSize: '15px', fontWeight: 600, textAlign: 'center'
        }}>
          Get Started
        </Link>
      )}
    </div>
  );
}
