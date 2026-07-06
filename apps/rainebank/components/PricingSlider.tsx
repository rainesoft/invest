'use client';

import { useState } from 'react';
import Link from 'next/link';

interface PricingSliderProps {
  isLoggedIn: boolean;
}

const tiers = [
  { minCapital: 500, label: "$500", feeUSD: 9, projMin: 25, projMax: 50 },
  { minCapital: 1000, label: "$1,000", feeUSD: 19, projMin: 50, projMax: 100 },
  { minCapital: 2500, label: "$2,500", feeUSD: 39, projMin: 125, projMax: 250 },
  { minCapital: 5000, label: "$5,000", feeUSD: 79, projMin: 250, projMax: 500 },
  { minCapital: 10000, label: "$10,000+", feeUSD: 149, projMin: 500, projMax: 1000 },
];

export default function PricingSlider({ isLoggedIn }: PricingSliderProps) {
  const [sliderIndex, setSliderIndex] = useState(1); // Default to $1,000 tier
  const currentTier = tiers[sliderIndex];

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
        POPULAR
      </div>
      
      <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8', marginBottom: '16px' }}>Autopilot Trader</div>
      
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', color: '#9ca3af', fontSize: '14px', marginBottom: '8px', fontWeight: 500 }}>
          Trading Capital: <span style={{ color: '#fff', fontSize: '16px', fontWeight: 700 }}>{currentTier.label}</span>
        </label>
        <input 
          type="range" 
          min="0" 
          max={tiers.length - 1} 
          value={sliderIndex} 
          onChange={(e) => setSliderIndex(parseInt(e.target.value))} 
          style={{ 
            width: '100%', 
            cursor: 'pointer',
            accentColor: '#38bdf8',
            height: '6px',
            borderRadius: '10px'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', color: '#6b7280', fontSize: '12px' }}>
          <span>$500</span>
          <span>$10k+</span>
        </div>
      </div>

      <div style={{ background: 'rgba(56, 189, 248, 0.05)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.1)', marginBottom: '24px' }}>
        <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Historical Return Projection (5-10%/mo)</div>
        <div style={{ fontSize: '24px', fontWeight: 700, color: '#4ade80' }}>
          ~${currentTier.projMin} - ${currentTier.projMax} <span style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 500 }}>/ mo</span>
        </div>
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px', fontStyle: 'italic' }}>
          *Past performance is not indicative of future results. Not a guarantee.
        </div>
      </div>

      <div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '4px' }}>Software Fee</div>
      <div style={{ fontSize: '48px', fontWeight: 800, color: '#fff', marginBottom: '16px', letterSpacing: '-2px' }}>
        ${currentTier.feeUSD}
        <span style={{ fontSize: '18px', color: '#9ca3af', fontWeight: 500, letterSpacing: '0' }}>/mo</span>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 40px 0', display: 'flex', flexDirection: 'column', gap: '16px', color: '#e5e7eb', flex: 1 }}>
        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          Get trades in real-time
        </li>
        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          1-Click Execution directly to your broker
        </li>
        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          AI Risk and Money Management
        </li>
        <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          Detailed reasoning for every trade
        </li>
      </ul>

      <Link href={isLoggedIn ? "/dashboard" : "/login"} style={{
        background: '#fff', color: '#000', padding: '16px', borderRadius: '100px',
        textDecoration: 'none', fontSize: '15px', fontWeight: 600, textAlign: 'center'
      }}>
        {isLoggedIn ? "Start your Autopilot" : "Get Started"}
      </Link>
    </div>
  );
}
