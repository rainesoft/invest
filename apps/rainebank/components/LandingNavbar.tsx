"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import { Menu, X } from 'lucide-react';

export default function LandingNavbar({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const isComparePage = pathname === '/compare';

  return (
    <>
      <style>{`
        .desktop-nav { display: none !important; }
        .mobile-nav { display: flex !important; }
        
        @media (min-width: 768px) {
          .desktop-nav { display: flex !important; }
          .mobile-nav { display: none !important; }
        }
      `}</style>

      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 50 }}>
        <nav style={{
          display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '1200px',
          background: 'var(--panel-bg)', backdropFilter: 'blur(16px)',
          border: '1px solid var(--border-color)', borderRadius: isOpen ? '24px' : '100px',
          padding: '12px 32px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          transition: 'border-radius 0.2s ease, background 0.2s ease'
        }}>
          {/* Top Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '48px' }}>
              <Link href="/" style={{ textDecoration: 'none' }}><Logo /></Link>

              {/* Desktop Links */}
              <div className="desktop-nav" style={{ gap: '24px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '14px', fontWeight: 500 }}>
                {isComparePage ? (
                  <Link href="/" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', ':hover': { opacity: 0.8 } } as any}>Home</Link>
                ) : (
                  <>
                    <Link href="#features" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', ':hover': { opacity: 0.8 } } as any}>Features</Link>
                    <Link href="/academy" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', ':hover': { opacity: 0.8 } } as any}>Academy</Link>
                    <Link href="#pricing" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', ':hover': { opacity: 0.8 } } as any}>Pricing</Link>
                  </>
                )}
              </div>
            </div>

            {/* Desktop Actions */}
            <div className="desktop-nav" style={{ gap: '16px', alignItems: 'center' }}>
              {!isLoggedIn && <Link href="/login" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Log in</Link>}
              <Link href={isLoggedIn ? "/dashboard" : "/login"} style={{
                background: 'var(--text-primary)', color: 'var(--bg-color)', padding: '10px 24px', borderRadius: '100px',
                textDecoration: 'none', fontSize: 14, fontWeight: 600, transition: 'opacity 0.2s'
              }}>{isLoggedIn ? "Open Vault" : "Get Started"}</Link>
            </div>

            {/* Mobile Toggle Button */}
            <div className="mobile-nav" style={{ alignItems: 'center' }}>
              <button onClick={() => setIsOpen(!isOpen)} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>

          {/* Mobile Dropdown Menu */}
          {isOpen && (
            <div className="mobile-nav" style={{ flexDirection: 'column', gap: '20px', marginTop: '24px', paddingBottom: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
              {isComparePage ? (
                <Link onClick={() => setIsOpen(false)} href="/" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 600 }}>Home</Link>
              ) : (
                <>
                  <Link onClick={() => setIsOpen(false)} href="#features" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 600 }}>Features</Link>
                  <Link onClick={() => setIsOpen(false)} href="#pricing" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 600 }}>Pricing</Link>
                  <Link onClick={() => setIsOpen(false)} href="/academy" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 600 }}>Academy</Link>
                </>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                {!isLoggedIn && <Link onClick={() => setIsOpen(false)} href="/login" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: 16, fontWeight: 600, textAlign: 'center', padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>Log in</Link>}
                <Link onClick={() => setIsOpen(false)} href={isLoggedIn ? "/dashboard" : "/login"} style={{ background: 'var(--text-primary)', color: 'var(--bg-color)', padding: '12px', borderRadius: '100px', textDecoration: 'none', fontSize: 16, fontWeight: 600, textAlign: 'center' }}>
                  {isLoggedIn ? "Open Vault" : "Get Started"}
                </Link>
              </div>
            </div>
          )}
        </nav>
      </div>
    </>
  );
}
