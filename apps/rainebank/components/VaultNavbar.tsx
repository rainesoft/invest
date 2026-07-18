"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import { Menu, X, Settings, HelpCircle, ShieldCheck } from 'lucide-react';
import LogoutButton from './LogoutButton';

const LINK_STYLE_BASE: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'none',
  transition: 'opacity 0.2s',
  whiteSpace: 'nowrap',
};

export default function VaultNavbar({ isAdmin = false }: { isAdmin?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname?.startsWith(href + '/');

  const desktopLinkStyle = (href: string): React.CSSProperties => ({
    ...LINK_STYLE_BASE,
    opacity: isActive(href) ? 1 : 0.65,
    fontWeight: isActive(href) ? 600 : 500,
    borderBottom: isActive(href) ? '2px solid var(--accent)' : '2px solid transparent',
    paddingBottom: '2px',
  });

  const mobileLinkStyle = (href: string): React.CSSProperties => ({
    color: isActive(href) ? 'var(--accent)' : 'var(--text-primary)',
    textDecoration: 'none',
    fontSize: '16px',
    fontWeight: isActive(href) ? 600 : 500,
    paddingLeft: isActive(href) ? '12px' : '0',
    borderLeft: isActive(href) ? '3px solid var(--accent)' : '3px solid transparent',
    transition: 'all 0.15s',
  });

  return (
    <>
      <style>{`
        .vault-desktop-nav { display: none !important; }
        .vault-mobile-toggle { display: flex !important; }
        .vault-mobile-menu { display: flex !important; }

        @media (min-width: 768px) {
          .vault-desktop-nav { display: flex !important; }
          .vault-mobile-toggle { display: none !important; }
          .vault-mobile-menu { display: none !important; }
        }

        @media (max-width: 767px) {
          .vault-nav-pill { padding: 10px 16px !important; }
        }
      `}</style>

      <div style={{ padding: '16px 16px 0', display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 50 }}>
        <nav
          className="vault-nav-pill"
          style={{
            display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '1200px',
            background: 'var(--panel-bg)', backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-color)', borderRadius: isOpen ? '20px' : '100px',
            padding: '10px 28px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            transition: 'border-radius 0.2s ease',
          }}
        >
          {/* ── Top Bar ─────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

            {/* Left: Logo + Desktop Links */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '32px', minWidth: 0 }}>
              <Link href="/" style={{ textDecoration: 'none', flexShrink: 0 }}><Logo /></Link>

              {/* Desktop nav links */}
              <div
                className="vault-desktop-nav"
                style={{ gap: '20px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}
              >
                <Link href="/dashboard" style={desktopLinkStyle('/dashboard')}>Vault</Link>
                <Link href="/wallet"    style={desktopLinkStyle('/wallet')}>Wallet</Link>
                <Link href="/fund-history" style={desktopLinkStyle('/fund-history')}>Fund History</Link>
                <Link href="/academy"  style={desktopLinkStyle('/academy')}>Academy</Link>
                {isAdmin && (
                  <Link href="/admin/deposits" style={{
                    ...desktopLinkStyle('/admin'),
                    display: 'flex', alignItems: 'center', gap: '5px',
                  }}>
                    <ShieldCheck size={14} />
                    Admin
                  </Link>
                )}
                <Link href="/docs"  style={desktopLinkStyle('/docs')}>API Docs</Link>
                <Link href="/help"  style={{ ...desktopLinkStyle('/help'), display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <HelpCircle size={14} />
                  Help
                </Link>
                <Link href="/settings" style={{ ...desktopLinkStyle('/settings'), display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Settings size={14} />
                  Settings
                </Link>
              </div>
            </div>

            {/* Right: Desktop logout */}
            <div className="vault-desktop-nav" style={{ gap: '16px', alignItems: 'center', flexShrink: 0 }}>
              <LogoutButton />
            </div>

            {/* Right: Mobile hamburger */}
            <div className="vault-mobile-toggle" style={{ alignItems: 'center' }}>
              <button
                onClick={() => setIsOpen(!isOpen)}
                aria-label={isOpen ? 'Close menu' : 'Open menu'}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-primary)', cursor: 'pointer',
                  padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>

          {/* ── Mobile Dropdown ──────────────────────────────────────────── */}
          {isOpen && (
            <div
              className="vault-mobile-menu"
              style={{
                flexDirection: 'column', gap: '4px',
                marginTop: '16px', paddingBottom: '12px',
                borderTop: '1px solid var(--border-color)', paddingTop: '16px',
              }}
            >
              {[
                { href: '/dashboard', label: 'Vault' },
                { href: '/wallet',    label: 'Wallet' },
                { href: '/fund-history', label: 'Fund History' },
                { href: '/academy',   label: 'Academy' },
                { href: '/docs',      label: 'API Docs' },
                { href: '/help',      label: 'Help' },
                { href: '/settings',  label: 'Settings' },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setIsOpen(false)}
                  style={{ ...mobileLinkStyle(href), padding: '8px 0', paddingLeft: isActive(href) ? '12px' : '0' }}
                >
                  {label}
                </Link>
              ))}

              {isAdmin && (
                <Link
                  href="/admin/deposits"
                  onClick={() => setIsOpen(false)}
                  style={{
                    ...mobileLinkStyle('/admin'),
                    padding: '8px 0',
                    paddingLeft: isActive('/admin') ? '12px' : '0',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}
                >
                  <ShieldCheck size={16} /> Admin
                </Link>
              )}

              <div style={{
                marginTop: '12px', paddingTop: '12px',
                borderTop: '1px solid var(--border-color)',
              }}>
                <LogoutButton />
              </div>
            </div>
          )}
        </nav>
      </div>
    </>
  );
}
