import LogoutButton from '@components/LogoutButton';
import Link from 'next/link';
import Logo from '@components/Logo';
import { ThemeProvider } from '@components/ThemeProvider';
import { Settings, HelpCircle } from 'lucide-react';

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="vault-layout">
        {/* Floating Header */}
        <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', zIndex: 10 }}>
          <nav style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--panel-bg)', backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-color)', borderRadius: '100px',
            padding: '12px 32px', width: '100%', maxWidth: '1200px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '48px' }}>
              <Link href="/" style={{ textDecoration: 'none' }}>
                <Logo />
              </Link>
              <div style={{ display: 'flex', gap: '24px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '14px', fontWeight: 500 }} className="md-flex hidden-mobile">
                <Link href="/research" style={{ color: 'inherit', textDecoration: 'none' }}>Research</Link>
                <Link href="/opportunities" style={{ color: 'inherit', textDecoration: 'none' }}>Signals</Link>
                <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>Vault</Link>
                <Link href="/trades" style={{ color: 'inherit', textDecoration: 'none' }}>Ledger</Link>
                <Link href="/docs" style={{ color: 'inherit', textDecoration: 'none' }}>API Docs</Link>
                <Link href="/help" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <HelpCircle size={16} />
                  Help
                </Link>
                <Link href="/settings" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Settings size={16} />
                  Settings
                </Link>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <LogoutButton />
            </div>
          </nav>
        </div>

        <main style={{ flex: 1, padding: '24px', zIndex: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '1200px' }}>
            {children}
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
