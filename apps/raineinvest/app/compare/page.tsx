import Link from 'next/link';
import Logo from '@components/Logo';
import LandingNavbar from '@components/LandingNavbar';
import { supabaseServer } from '@lib/supabase-server';

export default async function ComparePage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

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

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 24px' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '64px', maxWidth: '800px' }}>
          <div style={{
            display: 'inline-block', background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7',
            padding: '6px 16px', borderRadius: '100px', fontSize: '13px', fontWeight: 700, marginBottom: '24px',
            border: '1px solid rgba(168, 85, 247, 0.2)'
          }}>
            Why We're Different
          </div>
          <h1 style={{ fontSize: '48px', fontWeight: 800, color: '#fff', marginBottom: '24px', letterSpacing: '-1.5px', lineHeight: 1.1 }}>
            Most "AI Trading Bots" are basically blind robots.
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '20px', lineHeight: 1.6 }}>
            The market is flooded with bots that promise to make you rich. But here is the secret: almost all of them fall into two traps. Here is how we break the mold.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '1000px', width: '100%' }}>

          {/* Competitor 1 */}
          <div style={{
            background: 'linear-gradient(145deg, rgba(30,30,30,0.5) 0%, rgba(15,15,15,0.8) 100%)',
            border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', padding: '40px',
            display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <div style={{ fontSize: '32px' }}>🤖</div>
            <h2 style={{ fontSize: '28px', fontWeight: 700, color: '#fff', margin: 0 }}>The "Blind Robot" Problem</h2>
            <p style={{ color: '#9ca3af', fontSize: '17px', lineHeight: 1.6, margin: 0 }}>
              <strong>What the other guys do:</strong> They give you a bot that says "If the stock goes above this line, buy it." The problem? The bot has zero common sense. It doesn't know if there is terrible news in the world or if the market is crashing. It just blindly follows its one rule and crashes your account.
            </p>
          </div>

          {/* Competitor 2 */}
          <div style={{
            background: 'linear-gradient(145deg, rgba(30,30,30,0.5) 0%, rgba(15,15,15,0.8) 100%)',
            border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', padding: '40px',
            display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <div style={{ fontSize: '32px' }}>🤓</div>
            <h2 style={{ fontSize: '28px', fontWeight: 700, color: '#fff', margin: 0 }}>The "Too Complicated" Problem</h2>
            <p style={{ color: '#9ca3af', fontSize: '17px', lineHeight: 1.6, margin: 0 }}>
              <strong>What the other guys do:</strong> They give you insane charts and thousands of settings, expecting you to be a math genius to set it up. If you click the wrong button, you lose all your money.
            </p>
          </div>

          {/* Us */}
          <div style={{
            background: 'linear-gradient(180deg, rgba(56,189,248,0.1) 0%, rgba(10,10,10,1) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.4)', borderRadius: '24px', padding: '40px',
            display: 'flex', flexDirection: 'column', gap: '16px',
            boxShadow: '0 24px 64px rgba(56, 189, 248, 0.1)'
          }}>
            <div style={{ fontSize: '32px' }}>🧠</div>
            <h2 style={{ fontSize: '32px', fontWeight: 800, color: '#38bdf8', margin: 0 }}>Us: Your Smart Trading Buddy</h2>
            <p style={{ color: '#e5e7eb', fontSize: '18px', lineHeight: 1.6, margin: 0 }}>
              We don't use blind robots. Our AI acts exactly like a smart human trader. 
            </p>
            <ul style={{ color: '#9ca3af', fontSize: '17px', lineHeight: 1.6, margin: 0, paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <li><strong>It actually reads the room:</strong> It looks at the news and the whole market. If things look dangerous, it refuses to trade, protecting your money.</li>
              <li><strong>It explains itself:</strong> Before taking a trade, it tells you exactly <em>why</em> in plain English. No complicated jargon, just a clear reason like "The stock hit rock bottom and is bouncing back."</li>
              <li><strong>Hardcoded Safety:</strong> We locked the AI in a mathematical sandbox. It is literally impossible for it to risk too much of your money on a single trade.</li>
            </ul>
            <div style={{ marginTop: '24px' }}>
              <Link href="/dashboard" style={{
                display: 'inline-block', background: '#fff', color: '#000', padding: '16px 32px', borderRadius: '100px',
                textDecoration: 'none', fontSize: '16px', fontWeight: 600
              }}>
                See it in action
              </Link>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.05)', padding: '48px 24px', marginTop: '64px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px'
      }}>
        <Logo />
        <div style={{ color: '#4b5563', fontSize: '13px' }}>
          © {new Date().getFullYear()} RaineInvest. Developed by Rainesoft Solutions.
        </div>
      </footer>
    </div>
  );
}
