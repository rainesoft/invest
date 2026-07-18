import { ThemeProvider } from '@components/ThemeProvider';
import VaultNavbar from '@components/VaultNavbar';
import { supabaseServer } from '@lib/supabase-server';

export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = user?.email === 'david@rainesoft.com';

  return (
    <ThemeProvider>
      <div className="vault-layout">
        {/* Floating Header */}
        <VaultNavbar isAdmin={isAdmin} />

        <main className="vault-main" style={{ flex: 1, zIndex: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '1200px' }}>
            {children}
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
