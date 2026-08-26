import Link from 'next/link';
import Logo from '@components/Logo';
import { createClient } from '@supabase/supabase-js';
import LandingNavbar from '@components/LandingNavbar';
import PricingSlider from '@components/PricingSlider';
import { supabaseServer } from '@lib/supabase-server';

export const dynamic = 'force-dynamic';

function parseAnalysisText(text: string | null) {
  if (!text) return { tier: null, structure: null, strategy: null, content: '' };

  let content = text;
  
  // Clean up any agent prefix like [SWING] or [SCALP]
  content = content.replace(/^\[.*?\]\s*/, '');

  let tier = null;
  const tierMatch = content.match(/^\[(.*?-Tier)\]/);
  if (tierMatch) {
    tier = tierMatch[1];
    content = content.replace(/^\[(.*?-Tier)\]\s*/, '');
  }

  let structure = null;
  let strategy = null;
  const structMatch = content.match(/^\[(.*?) (?:->|→) (.*?)\]/);
  if (structMatch) {
    structure = structMatch[1];
    strategy = structMatch[2];
    content = content.replace(/^\[(.*?) (?:->|→) (.*?)\]\s*/, '');
  }

  // Remove pipes | and any leading/trailing dashes or colons
  content = content.replace(/\|/g, '').replace(/^[-:\s]+/, '').trim();
  content = content.replace(/\s{2,}/g, ' ');

  return { tier, structure, strategy, content };
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

  // 1. Try to fetch a WON S or A tier signal first
  let { data: wonSignals } = await supabaseAdmin
    .from('trade_opportunities')
    .select('*')
    .eq('status', 'WON')
    .or('ai_summary.ilike.%[S-Tier]%,ai_summary.ilike.%[A-Tier]%')
    .order('created_at', { ascending: false })
    .limit(1);

  let latestSignals = wonSignals;

  // 2. If no WON signals exist, fallback to any non-LOST S or A tier signal
  if (!latestSignals || latestSignals.length === 0) {
    const { data: fallbackSignals } = await supabaseAdmin
      .from('trade_opportunities')
      .select('*')
      .not('status', 'eq', 'LOST')
      .or('ai_summary.ilike.%[S-Tier]%,ai_summary.ilike.%[A-Tier]%')
      .order('created_at', { ascending: false })
      .limit(1);
    
    latestSignals = fallbackSignals;
  }

  const signal = latestSignals?.[0] || {
    symbol: 'MARKETS IDLE',
    side: 'MONITORING',
    status: 'STANDBY',
    entry_plan_json: { price: 'Awaiting Breakout' },
    ai_summary: '[A-Tier] [Macro Alignment -> Searching]\nThe Risk AI Agent is continuously analyzing cross-asset volatility and institutional order flow. We are currently holding cash and waiting for a strictly defined, high-probability structural break before deploying capital. No active trades meet our minimum Risk:Reward thresholds at this precise moment.'
  };

  const displayStatus = signal.status === 'REJECTED' ? 'ANALYSIS COMPLETE' :
                        signal.status === 'PENDING_APPROVAL' ? 'EVALUATING' : 
                        signal.status;

  const statusColor = displayStatus === 'APPROVED' || displayStatus === 'WON' ? '#4ade80' :
    displayStatus === 'ANALYSIS COMPLETE' ? '#c084fc' : '#38bdf8';

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] text-gray-200 font-sans relative overflow-hidden">
      {/* Background Gradients */}
      <div 
        className="fixed inset-0 w-full h-full -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 15% 15%, rgba(37, 99, 235, 0.1) 0%, transparent 40%), radial-gradient(circle at 85% 85%, rgba(74, 222, 128, 0.05) 0%, transparent 40%)'
        }} 
      />

      {/* Floating Inset Navigation */}
      <LandingNavbar isLoggedIn={isLoggedIn} />

      <main className="flex-1 flex flex-col items-center px-6 py-10 w-full">

        {/* Hero Section */}
        <section className="w-full max-w-6xl flex flex-col md:flex-row items-center gap-12 md:gap-16 mb-24 md:mb-32 mt-8 md:mt-12">

          {/* Left Column: Copy & CTA */}
          <div className="flex-1 w-full flex flex-col items-center md:items-start text-center md:text-left">
            <div className="inline-block bg-sky-500/10 text-sky-400 px-4 py-1.5 rounded-full text-sm font-semibold mb-6 border border-sky-500/20">
              An AI Fund Manager
            </div>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.1] mb-6 text-white tracking-tight">
              A super-smart AI that
              <span className="text-gray-400 block md:inline"> grows your money.</span>
            </h1>
            <p className="text-lg text-gray-400 leading-relaxed mb-10 max-w-lg">
              Deposit funds and let our AI trade the global markets for you.
              It automatically finds safe trades, manages the risk, and grows your account while you sleep. We only make money when you make money, so our goals are exactly the same as yours.
            </p>
            <div className="flex gap-4 flex-wrap justify-center md:justify-start">
              <Link href={isLoggedIn ? "/dashboard" : "/login"} className="bg-white text-black px-8 py-4 rounded-full text-base font-semibold flex items-center gap-2 hover:bg-gray-200 transition-colors">
                {isLoggedIn ? "Open your Dashboard" : "Get Started"}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </Link>
            </div>
          </div>

          {/* Right Column: Dynamic Mockup pulling from DB */}
          <div className="flex-1 w-full flex justify-center mt-8 md:mt-0 perspective-1000">
            <div 
              className="w-full max-w-[450px] p-8 rounded-3xl border border-white/10 shadow-2xl"
              style={{
                background: 'linear-gradient(145deg, rgba(30,30,30,0.8) 0%, rgba(15,15,15,0.8) 100%)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                transform: 'rotateX(5deg) rotateY(-5deg)' // Reduced rotation slightly for better mobile viewing
              }}
            >
              <div className="flex justify-between items-center mb-6">
                <div className="text-sm text-gray-400 font-semibold">LIVE AI SIGNAL</div>
                <div className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: `${statusColor}15`, color: statusColor }}>
                  {displayStatus || 'ACTIVE'}
                </div>
              </div>
              <div className="text-5xl font-extrabold text-white mb-2 tracking-tight">
                {signal.symbol}
              </div>
              <div className="text-2xl text-sky-400 font-semibold mb-8">
                {signal.side?.toUpperCase()} @ {signal.entry_plan_json?.price}
              </div>

              <div className="bg-[#0a0a0a] p-4 rounded-xl border border-white/5">
                <div className="text-xs text-gray-400 mb-3 font-semibold">WHAT THE AI SAID:</div>
                <TrendBadge {...parseAnalysisText(signal.ai_summary)} />
                <p className="text-sm text-gray-200 leading-relaxed m-0">
                  {parseAnalysisText(signal.ai_summary).content.slice(0, 150)}{parseAnalysisText(signal.ai_summary).content.length > 150 ? '...' : ''}
                </p>
              </div>
            </div>
          </div>

        </section>

        {/* Features / How it Works Box */}
        <section id="features" className="w-full max-w-6xl mb-24 md:mb-32">
          <div className="text-center mb-16 px-4">
            <h2 className="text-4xl font-extrabold text-white mb-4 tracking-tight">Institutional Features</h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Trading doesn't have to be confusing. Here is exactly what our AI does for you behind the scenes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-4 md:px-0">
            <div className="bg-[#111] border border-white/5 rounded-3xl p-8 hover:bg-[#151515] transition-colors">
              <div className="text-3xl mb-4">👀</div>
              <h3 className="text-xl font-bold text-white mb-4">Step 1: It Watches</h3>
              <p className="text-gray-400 text-base leading-relaxed">
                You don't need to stare at charts all day. The AI scans the global markets (like gold, oil, and stocks) every few hours to find perfect, safe moments to enter a trade.
              </p>
            </div>

            <div className="bg-[#111] border border-white/5 rounded-3xl p-8 hover:bg-[#151515] transition-colors">
              <div className="text-3xl mb-4">🧮</div>
              <h3 className="text-xl font-bold text-white mb-4">Step 2: It Calculates Risk</h3>
              <p className="text-gray-400 text-base leading-relaxed">
                Before ever suggesting a trade, it does the math. It ensures that if a trade goes wrong, you only lose a tiny fraction of a percent of your money, but if it goes right, you make double that. It is designed to aggressively protect your money.
              </p>
            </div>

            <div className="bg-[#111] border border-white/5 rounded-3xl p-8 hover:bg-[#151515] transition-colors">
              <div className="text-3xl mb-4">🚀</div>
              <h3 className="text-xl font-bold text-white mb-4">Step 3: It Executes</h3>
              <p className="text-gray-400 text-base leading-relaxed">
                When you see a trade you like, you just click "Approve". The AI sends the math directly to your broker. You don't have to calculate lot sizes, stop losses, or take profits. It handles everything for you automatically.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing Grid */}
        <section id="pricing" className="w-full max-w-5xl mb-24 md:mb-32">
          <div className="text-center mb-16 px-4">
            <h2 className="text-4xl font-extrabold text-white mb-4 tracking-tight">Pick your plan</h2>
            <p className="text-gray-400 text-lg">Start simple, upgrade when you're ready.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-4 md:px-0">
            {/* Free Tier */}
            <div className="bg-[#0a0a0a] border border-white/10 rounded-3xl p-8 md:p-10 flex flex-col">
              <div className="text-xl font-bold text-white mb-4">Performance Plan</div>
              <div className="text-5xl font-extrabold text-white mb-4 tracking-tight">20%<span className="text-lg text-gray-400 font-medium tracking-normal ml-1">fee</span></div>
              <p className="text-gray-400 text-base mb-8">We only win when you win. A 20% performance fee is deducted solely on net profits.</p>

              <ul className="flex-1 flex flex-col gap-4 text-gray-200 mb-10">
                <li className="flex items-center gap-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                  Fully Automated Execution
                </li>
                <li className="flex items-center gap-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                  High-Water Mark Protection
                </li>
                <li className="flex items-center gap-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                  Zero Management Fees
                </li>
              </ul>

              <Link href="/login" className="bg-white/5 hover:bg-white/10 border border-white/10 text-white py-4 px-6 rounded-full text-center text-base font-semibold transition-colors">
                Get Started for Free
              </Link>
            </div>

            {/* Alpha Tier (Dynamic Slider) */}
            <PricingSlider isLoggedIn={isLoggedIn} />
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 px-6 flex flex-col items-center gap-6 text-center">
        <Logo />
        <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-400 font-medium">
          <Link href="/docs" className="hover:text-white transition-colors">API Documentation</Link>
          <Link href="/login" className="hover:text-white transition-colors">Client Login</Link>
          <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
        </div>
        <div className="text-gray-600 text-sm mt-4">
          © {new Date().getFullYear()} RaineInvest. Developed by Rainesoft Solutions.
        </div>
      </footer>
    </div>
  );
}