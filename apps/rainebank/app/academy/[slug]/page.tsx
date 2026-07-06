import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Lock, CheckCircle2 } from 'lucide-react';
import { ACADEMY_POSTS } from '../../../data/academy';
import LandingNavbar from '@components/LandingNavbar';
import { supabaseServer } from '@lib/supabase-server';

export default async function AcademyPostPage({ params }: { params: { slug: string } }) {
  const post = ACADEMY_POSTS.find(p => p.slug === params.slug);
  
  if (!post) {
    notFound();
  }

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;
  
  let hasPremiumAccess = false;

  if (isLoggedIn && post.isPremium) {
    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('plan_tier, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();
      
    if (sub && sub.plan_tier !== 'free') {
      hasPremiumAccess = true;
    }
  }

  const isLocked = post.isPremium && !hasPremiumAccess;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-color)' }}>
      <LandingNavbar isLoggedIn={isLoggedIn} />

      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '40px 24px' }}>
        <article style={{ width: '100%', maxWidth: '800px' }}>
          
          <Link href="/academy" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '48px', fontWeight: 500, transition: 'color 0.2s' }}>
            <ArrowLeft size={16} /> Back to Academy
          </Link>

          <div style={{ marginBottom: '48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {post.category}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>•</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{post.readTime}</span>
              {post.isPremium && (
                <>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>•</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', padding: '6px 12px', borderRadius: '100px', fontSize: '13px', fontWeight: 600 }}>
                    <Lock size={14} /> PRO EXCLUSIVE
                  </span>
                </>
              )}
            </div>
            <h1 style={{ fontSize: '48px', fontWeight: 700, margin: '0 0 24px 0', lineHeight: '1.2', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              {post.title}
            </h1>
            <p style={{ fontSize: '20px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: 0 }}>
              {post.excerpt}
            </p>
          </div>

          {/* Content Area */}
          <div style={{ position: 'relative' }}>
            <div style={{ 
              filter: isLocked ? 'blur(8px)' : 'none', 
              opacity: isLocked ? 0.4 : 1,
              pointerEvents: isLocked ? 'none' : 'auto',
              userSelect: isLocked ? 'none' : 'auto',
              transition: 'all 0.4s ease'
            }}>
              {post.content}
            </div>

            {/* Premium Paywall Overlay */}
            {isLocked && (
              <div style={{
                position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
                background: 'var(--panel-bg)', backdropFilter: 'blur(24px)',
                border: '1px solid var(--border-color)', borderRadius: '24px',
                padding: '48px', textAlign: 'center', width: '100%', maxWidth: '500px',
                boxShadow: '0 24px 48px rgba(0,0,0,0.2)'
              }}>
                <div style={{ display: 'inline-flex', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', padding: '16px', borderRadius: '50%', marginBottom: '24px' }}>
                  <Lock size={32} />
                </div>
                <h3 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 16px 0', color: 'var(--text-primary)' }}>
                  Unlock Premium Alpha
                </h3>
                <p style={{ fontSize: '16px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: '0 0 32px 0' }}>
                  This advanced trading strategy is reserved exclusively for Rainebank Pro members. Upgrade your account to read this and access our institutional execution engine.
                </p>
                <Link href={isLoggedIn ? "/dashboard" : "/login"} style={{
                  display: 'inline-flex', background: 'var(--text-primary)', color: 'var(--bg-color)',
                  padding: '16px 32px', borderRadius: '100px', textDecoration: 'none',
                  fontSize: '16px', fontWeight: 600, width: '100%', justifyContent: 'center'
                }}>
                  {isLoggedIn ? "Upgrade to Pro" : "Log in to Upgrade"}
                </Link>
                <ul style={{ marginTop: '32px', textAlign: 'left', listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    <CheckCircle2 size={16} color="#4ade80" /> Access to all Premium Guides
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    <CheckCircle2 size={16} color="#4ade80" /> Institutional Execution Algorithms
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    <CheckCircle2 size={16} color="#4ade80" /> Automated Risk Management
                  </li>
                </ul>
              </div>
            )}
          </div>

          {/* Social Share Buttons */}
          <div style={{ marginTop: '64px', paddingTop: '32px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>Share this guide:</span>
            <a href={`https://twitter.com/intent/tweet?url=https://rainebank.com/academy/${post.slug}&text=${encodeURIComponent(post.title)}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '100px', background: '#000', color: '#fff', textDecoration: 'none', fontSize: '14px', fontWeight: 600, border: '1px solid rgba(255,255,255,0.2)' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              Share on X
            </a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=https://rainebank.com/academy/${post.slug}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '100px', background: '#1877F2', color: '#fff', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              Share on Facebook
            </a>
          </div>
        </article>
      </main>
    </div>
  );
}
