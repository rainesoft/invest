import { redirect } from 'next/navigation';
import { supabaseServer } from '@lib/supabase-server';
import { ThemeProvider } from '@components/ThemeProvider';
import VaultNavbar from '@components/VaultNavbar';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if the user is an admin
  const { data: userData, error } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (error || !userData?.is_admin) {
    // If not an admin, redirect them back to the vault
    redirect('/wallet');
  }

  return (
    <ThemeProvider>
      <div className="vault-layout">
        <VaultNavbar isAdmin={true} />
        <main style={{ flex: 1, padding: '24px', zIndex: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: '1200px' }}>
            <div style={{ marginBottom: '24px' }}>
              <h1 style={{ color: '#fff', fontSize: '24px', margin: '0 0 8px 0' }}>Admin Dashboard</h1>
              <p style={{ color: '#9ca3af', margin: 0 }}>Review and manage pending operations.</p>
            </div>
            {children}
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
