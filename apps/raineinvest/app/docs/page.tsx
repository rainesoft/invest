import React from 'react';
import Logo from '@components/Logo';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { supabaseServer } from '@lib/supabase-server';

export const metadata = {
  title: 'API Documentation | AI Trading',
  description: 'Integration guide for the Institutional Alpha feed.',
};

export default async function ApiDocs() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  
  const backLink = user ? '/dashboard' : '/';
  const backText = user ? 'Back to Vault' : 'Back to Home';

  return (
    <div style={{ padding: '40px 24px', maxWidth: '900px', margin: '0 auto', minHeight: '100vh' }}>
      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
        
        {/* Navigation */}
        <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '24px', borderBottom: '1px solid var(--border-color)' }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <Logo />
          </Link>
          <Link href={backLink} style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={16} />
            {backText}
          </Link>
        </nav>

        {/* Header */}
        <header style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h1 style={{ fontSize: '36px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Institutional API
          </h1>
          <p style={{ fontSize: '18px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            Programmatic access to the Alpha Engine. Consume mathematically verified, AI-evaluated trade setups in real-time.
          </p>
        </header>

        {/* Authentication Section */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', margin: 0 }}>Authentication</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            All requests to the API must be authenticated via a Bearer token in the <code style={{ background: 'var(--input-bg)', color: 'var(--accent)', padding: '2px 6px', borderRadius: '4px', fontSize: '14px' }}>Authorization</code> header. Keys are provisioned securely via our Unkey edge network.
          </p>
          <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px', fontFamily: 'monospace', fontSize: '14px', color: '#c9d1d9', overflowX: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
            <span style={{ color: '#ff7b72' }}>GET</span> /api/vault/signals HTTP/1.1<br/>
            <span style={{ color: '#79c0ff' }}>Host:</span> api.aitrading.com<br/>
            <span style={{ color: '#79c0ff' }}>Authorization:</span> Bearer live_xxxxxxxxxxxxxxxxx
          </div>
        </section>

        {/* Endpoint: Get Signals */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', margin: 0 }}>Retrieve Signals</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 700, letterSpacing: '1px' }}>GET</span>
            <code style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '16px' }}>/api/vault/signals</code>
          </div>
          <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>Fetches the latest evaluated trade opportunities. The feed is ordered chronologically by execution timestamp. Free tier users experience a 4-hour delay and receive masked metrics.</p>
          
          <h3 style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)', marginTop: '16px', margin: 0 }}>Query Parameters</h3>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: '16px', listStyle: 'none', padding: 0, margin: 0 }}>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <code style={{ color: 'var(--accent)', minWidth: '80px', fontFamily: 'monospace', fontSize: '14px' }}>page</code>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}><span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', opacity: 0.7 }}>(Optional)</span> Pagination page number. Default is 1.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <code style={{ color: 'var(--accent)', minWidth: '80px', fontFamily: 'monospace', fontSize: '14px' }}>limit</code>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}><span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', opacity: 0.7 }}>(Optional)</span> Number of records to return. Default is 10.</span>
            </li>
          </ul>

          <h3 style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)', marginTop: '16px', margin: 0 }}>Response Payload (Pro Tier)</h3>
          <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px', fontFamily: 'monospace', fontSize: '14px', color: '#a5d6ff', overflowX: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
{`{
  "signals": [
    {
      "id": "a1b2c3d4-...",
      "symbol": "XAUUSD",
      "side": "LONG",
      "timeframe": "1H",
      "status": "APPROVED",
      "entry_plan_json": {
        "price": 2342.50
      },
      "stop_plan_json": {
        "stop": 2338.00
      },
      "take_profit_json": {
        "tp": 2351.50
      },
      "ai_summary": "Price has swept the previous session liquidity pool. M30 structural alignment is bullish with price > EMA 50 > EMA 200. RSI indicates momentum buildup without overextension. 1:2 RR mandated.",
      "created_at": "2026-06-15T14:30:00Z"
    }
  ],
  "is_pro": true,
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10
  }
}`}
            </pre>
          </div>
        </section>

        {/* Rate Limiting */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', margin: 0 }}>Rate Limits & Edge Security</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            API endpoints are protected by global edge rate-limiting to ensure feed stability. 
            The standard tier allows for <strong style={{ color: 'var(--text-primary)' }}>60 requests per minute</strong> per API key. Exceeding this limit will result in a <code style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontSize: '14px' }}>429 Too Many Requests</code> response.
          </p>
        </section>

      </div>
    </div>
  );
}
