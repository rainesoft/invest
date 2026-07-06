import LogoutButton from '@components/LogoutButton';
import { ThemeProvider } from '@components/ThemeProvider';
import VaultNavbar from '@components/VaultNavbar';

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="vault-layout">
        {/* Floating Header */}
        <VaultNavbar />

        <main style={{ flex: 1, padding: '24px', zIndex: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '1200px' }}>
            {children}
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
