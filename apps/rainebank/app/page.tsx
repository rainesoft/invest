import Link from 'next/link';
import Logo from '@components/Logo';
import { createClient } from '@supabase/supabase-js';
import LandingNavbar from '@components/LandingNavbar';
import PricingSlider from '@components/PricingSlider';
import { supabaseServer } from '@lib/supabase-server';

export const dynamic = 'force-dynamic';

function parseAnalysisText(text: string | null) {
  if (!text) return { tier: null, structure: null, strategy: null, content: '' };
  
  // Try to match the exact pattern: [Tier] [Structure -> Strategy]
  const match = text.match(/^\[(.*?-Tier)\] \[(.*?) -> (.*?)\]/);
  
  if (!match) {
    // If exact pattern fails, maybe there's just a Tier at the start
    const fallbackMatch = text.match(/^\[(.*?-Tier)\]/);
    if (!fallbackMatch) return { tier: null, structure: null, strategy: null, content: text };
    return {
      tier: fallbackMatch[1],
      structure: null,
      strategy: null,
      content: text.replace(/^\[(.*?-Tier)\]\s*-?\s*/, '').trim()
    };
  }

  return {
    tier: match[1],
    structure: match[2],
    strategy: match[3],
    content: text.replace(/^\[(.*?-Tier)\] \[(.*?) -> (.*?)\]\s*-?\s*/, '').trim()
  };
}

function TrendBadge({ tier, structure, strategy }: { tier: string | null, structure: string | null, strategy: string | null }) {
  if (!tier && !structure && !strategy) return null;

  // Tier Colors
  let tierColor = '#9ca3af';
  let tierBg = 'rgba(156,163,175,0.1)';
  if (tier === 'S-Tier') {
    tierColor = '#fbbf24'; // amber-400
    tierBg = 'rgba(251,191,36,0.1)';
  } else if (tier === 'A-Tier') {
    tierColor = '#c084fc'; // purple-400
    tierBg = 'rgba(192,132,252,0.1)';
  } else if (tier === 'B-Tier') {
    tierColor = '#38bdf8'; // sky-400
    tierBg = 'rgba(56,189,248,0.1)';
  } else if (tier === 'C-Tier') {
    tierColor = '#f87171'; // red-400
    tierBg = 'rgba(248,113,113,0.1)';
  }

  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
      {tier && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: tierBg, color: tierColor, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 800 }}>
          <span>{tier}</span>
        </div>
      )}
      {(structure || strategy) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', color: '#d1d5db', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
          {structure && <span>{structure}</span>}
          {structure && strategy && <span style={{ color: '#6b7280' }}>→</span>}
          {strategy && <span>{strategy}</span>}
        </div>
      )}
    </div>
  );
}

export default async function LandingPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  // Use Service Role key to bypass RLS so logged-out users can see the showcase signal
  // without us having to open the database to public anonymous scraping.
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  // Fetch the latest A-Tier trade opportunity for the live showcase
  let { data: latestSignals } = await supabaseAdmin
    .from('trade_opportunities')
    .select('*')
    .in('status', ['PENDING_APPROVAL', 'APPROVED', 'WON', 'LOST'])
    .ilike('ai_summary', '%[A-Tier]%')
    .order('created_at', { ascending: false })
    .limit(1);

  // Fallback to B-Tier if no A-Tier signals exist
  if (!latestSignals || latestSignals.length === 0) {
    const { data: bTierSignals } = await supabaseAdmin
      .from('trade_opportunities')
      .select('*')
      .in('status', ['PENDING_APPROVAL', 'APPROVED', 'WON', 'LOST'])
      .ilike('ai_summary', '%[B-Tier]%')
      .order('created_at', { ascending: false })
      .limit(1);
    latestSignals = bTierSignals;
  }

  const signal = latestSignals?.[0] || {
    symbol: 'SCANNING...',
    side: 'NEUTRAL',
    status: 'SEARCHING',
    entry_plan_json: { price: 'Pending Data' },
    ai_summary: 'The AI Risk Officer is currently scanning the global markets for high-probability setups. Check back shortly.'
  };

  const statusColor = signal.status === 'APPROVED' ? '#4ade80' : 
                      signal.status === 'REJECTED' ? '#ef4444' : '#38bdf8';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#050505',
      color: '#e5e7eb',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Background Gradients */}
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: 'radial-gradient(circle at 15% 15%, rgba(37, 99, 235, 0.1) 0%, transparent 40%), radial-gradient(circle at 85% 85%, rgba(74, 222, 128, 0.05) 0%, transparent 40%)',
        zIndex: -1, pointerEvents: 'none'
      }} />

      {/* Floating Inset Navigation */}
      <LandingNavbar isLoggedIn={isLoggedIn} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px' }}>

        {/* Hero Section */}
        <section style={{ maxWidth: '1200px', width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '64px', marginBottom: '120px' }}>

          {/* Left Column: Copy & CTA */}
          <div style={{ flex: '1 1 500px' }}>
            <div style={{
              display: 'inline-block', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8',
              padding: '6px 16px', borderRadius: '100px', fontSize: '13px', fontWeight: 600, marginBottom: '24px',
              border: '1px solid rgba(56, 189, 248, 0.2)'
            }}>
              Meet your new AI Trading Assistant
            </div>
            <h1 style={{
              fontSize: 'clamp(48px, 6vw, 72px)', lineHeight: 1.05, fontWeight: 800, marginBottom: '24px',
              color: '#fff', letterSpacing: '-1.5px'
            }}>
              Your personal AI that trades <br />
              <span style={{ color: '#9ca3af' }}>while you sleep.</span>
            </h1>
            <p style={{ fontSize: '18px', color: '#9ca3af', lineHeight: 1.6, marginBottom: '40px', maxWidth: '550px' }}>
              Imagine having a really smart math student who watches the stock market 24/7 for you. 
              It finds the absolute safest times to buy, double-checks the math so you never risk too much money, and automatically makes the trade for you. 
              No stress, no staring at screens all day.
            </p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <Link href={isLoggedIn ? "/dashboard" : "/login"} style={{
                background: '#fff', color: '#000', padding: '16px 32px', borderRadius: '100px',
                textDecoration: 'none', fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'
              }}>
                {isLoggedIn ? "Open your Dashboard" : "Get Started"}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </Link>
            </div>
          </div>

          {/* Right Column: Dynamic Mockup pulling from DB */}
          <div style={{ flex: '1 1 500px', display: 'flex', justifyContent: 'center' }}>
            <div style={{
              background: 'linear-gradient(145deg, rgba(30,30,30,0.8) 0%, rgba(15,15,15,0.8) 100%)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', padding: '32px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
              width: '100%', maxWidth: '450px', transform: 'rotateX(5deg) rotateY(-10deg)', perspective: '1000px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 600 }}>LIVE AI SIGNAL</div>
                <div style={{ background: `${statusColor}15`, color: statusColor, padding: '4px 10px', borderRadius: '100px', fontSize: '12px', fontWeight: 700 }}>
                  {signal.status || 'ACTIVE'}
                </div>
              </div>
              <div style={{ fontSize: '48px', fontWeight: 800, color: '#fff', marginBottom: '8px', letterSpacing: '-1px' }}>
                {signal.symbol}
              </div>
              <div style={{ fontSize: '24px', color: '#38bdf8', fontWeight: 600, marginBottom: '32px' }}>
                {signal.side?.toUpperCase()} @ {signal.entry_plan_json?.price}
              </div>

              <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>WHAT THE AI SAID:</div>
                <TrendBadge {...parseAnalysisText(signal.ai_summary)} />
                <p style={{ fontSize: '14px', color: '#e5e7eb', lineHeight: 1.5, margin: 0 }}>
                  {parseAnalysisText(signal.ai_summary).content.slice(0, 150)}{parseAnalysisText(signal.ai_summary).content.length > 150 ? '...' : ''}
                </p>
              </div>
            </div>
          </div>

        </section>

        {/* Features / How it Works Box */}
        <section id="features" style={{ maxWidth: '1200px', width: '100%', marginBottom: '120px' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <h2 style={{ fontSize: '40px', fontWeight: 800, color: '#fff', marginBottom: '16px', letterSpacing: '-1px' }}>Institutional Features</h2>
            <p style={{ color: '#9ca3af', fontSize: '18px', maxWidth: '600px', margin: '0 auto' }}>
              Trading doesn't have to be confusing. Here is exactly what our AI does for you behind the scenes.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>

            <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', padding: '40px' }}>
              <div style={{ fontSize: '32px', marginBottom: '16px' }}>👀</div>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Step 1: It Watches</h3>
              <p style={{ color: '#9ca3af', fontSize: '16px', lineHeight: 1.6 }}>
                You don't need to stare at charts all day. The AI scans the global markets (like gold, oil, and stocks) every few hours to find perfect, safe moments to enter a trade.
              </p>
            </div>

            <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', padding: '40px' }}>
              <div style={{ fontSize: '32px', marginBottom: '16px' }}>🧮</div>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Step 2: It Calculates Risk</h3>
              <p style={{ color: '#9ca3af', fontSize: '16px', lineHeight: 1.6 }}>
                Before ever suggesting a trade, it does the math. It ensures that if a trade goes wrong, you only lose a tiny fraction of a percent of your money, but if it goes right, you make double that. It is designed to aggressively protect your money.
              </p>
            </div>

            <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', padding: '40px' }}>
              <div style={{ fontSize: '32px', marginBottom: '16px' }}>🚀</div>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Step 3: It Executes</h3>
              <p style={{ color: '#9ca3af', fontSize: '16px', lineHeight: 1.6 }}>
                When you see a trade you like, you just click "Approve". The AI sends the math directly to your broker. You don't have to calculate lot sizes, stop losses, or take profits. It handles everything for you automatically.
              </p>
            </div>

          </div>
        </section>

        {/* Pricing Grid */}
        <section id="pricing" style={{ maxWidth: '1000px', width: '100%', marginBottom: '120px' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <h2 style={{ fontSize: '40px', fontWeight: 800, color: '#fff', marginBottom: '16px', letterSpacing: '-1px' }}>Pick your plan</h2>
            <p style={{ color: '#9ca3af', fontSize: '18px' }}>Start simple, upgrade when you're ready.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '32px' }}>

            {/* Free Tier */}
            <div style={{
              background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', padding: '40px',
              display: 'flex', flexDirection: 'column'
            }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Spectator Mode</div>
              <div style={{ fontSize: '48px', fontWeight: 800, color: '#fff', marginBottom: '16px', letterSpacing: '-2px' }}>GH₵ 0<span style={{ fontSize: '18px', color: '#9ca3af', fontWeight: 500, letterSpacing: '0' }}>/mo</span></div>
              <p style={{ color: '#9ca3af', fontSize: '15px', marginBottom: '32px' }}>Perfect if you just want to watch the AI work.</p>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 40px 0', display: 'flex', flexDirection: 'column', gap: '16px', color: '#e5e7eb', flex: 1 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                  See past trades
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                  Basic market analysis
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#4b5563' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  Live trading automation
                </li>
              </ul>

              <Link href="/login" style={{
                background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '16px', borderRadius: '100px',
                textDecoration: 'none', fontSize: '15px', fontWeight: 600, textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)'
              }}>Get Started for Free</Link>
            </div>

            {/* Alpha Tier (Dynamic Slider) */}
            <PricingSlider isLoggedIn={isLoggedIn} />
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.05)', padding: '48px 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px'
      }}>
        <Logo />
        <div style={{ display: 'flex', gap: '24px', color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>
          <Link href="/docs" style={{ color: 'inherit', textDecoration: 'none' }}>API Documentation</Link>
          <Link href="/login" style={{ color: 'inherit', textDecoration: 'none' }}>Client Login</Link>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Terms of Service</a>
        </div>
        <div style={{ color: '#4b5563', fontSize: '13px', marginTop: '24px' }}>
          © {new Date().getFullYear()} RaineBank. Developed by Rainesoft Solutions.
        </div>
      </footer>
    </div>
  );
}