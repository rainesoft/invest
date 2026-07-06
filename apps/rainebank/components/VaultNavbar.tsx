"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import { Menu, X, Settings, HelpCircle } from 'lucide-react';
import LogoutButton from './LogoutButton';

export default function VaultNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

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
                <Link href="/research" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', opacity: pathname === '/research' ? 1 : 0.8, ':hover': { opacity: 1 } } as any}>Research</Link>
                <Link href="/opportunities" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', opacity: pathname === '/opportunities' ? 1 : 0.8, ':hover': { opacity: 1 } } as any}>Signals</Link>
                <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', opacity: pathname === '/dashboard' ? 1 : 0.8, ':hover': { opacity: 1 } } as any}>Vault</Link>
                <Link href="/trades" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', opacity: pathname === '/trades' ? 1 : 0.8, ':hover': { opacity: 1 } } as any}>Ledger</Link>
                <Link href="/docs" style={{ color: 'inherit', textDecoration: 'none', transition: 'opacity 0.2s', opacity: pathname === '/docs' ? 1 : 0.8, ':hover': { opacity: 1 } } as any}>API Docs</Link>
                <Link href="/help" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', transition: 'opacity 0.2s', opacity: pathname === '/help' ? 1 : 0.8, ':hover': { opacity: 1 } } as any}>
                  <HelpCircle size={16} />
                  Help
                </Link>
                <Link href="/settings" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', transition: 'opacity 0.2s', opacity: pathname === '/settings' ? 1 : 0.8, ':hover': { opacity: 1 } } as any}>
                  <Settings size={16} />
                  Settings
                </Link>
              </div>
            </div>

            {/* Desktop Actions */}
            <div className="desktop-nav" style={{ gap: '16px', alignItems: 'center' }}>
              <LogoutButton />
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
              <Link onClick={() => setIsOpen(false)} href="/research" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 500 }}>Research</Link>
              <Link onClick={() => setIsOpen(false)} href="/opportunities" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 500 }}>Signals</Link>
              <Link onClick={() => setIsOpen(false)} href="/dashboard" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 500 }}>Vault</Link>
              <Link onClick={() => setIsOpen(false)} href="/trades" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 500 }}>Ledger</Link>
              <Link onClick={() => setIsOpen(false)} href="/docs" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 500 }}>API Docs</Link>
              <Link onClick={() => setIsOpen(false)} href="/help" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <HelpCircle size={18} /> Help
              </Link>
              <Link onClick={() => setIsOpen(false)} href="/settings" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '16px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={18} /> Settings
              </Link>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                <LogoutButton />
              </div>
            </div>
          )}
        </nav>
      </div>
    </>
  );
}
