import { supabaseServer } from '@lib/supabase-server';
import LandingNavbar from '@components/LandingNavbar';
import VaultNavbar from '@components/VaultNavbar';
import AcademyClient from './AcademyClient';

export const metadata = {
  title: 'Academy | Rainebank',
  description: 'Learn algorithmic trading, setup your broker, and explore advanced risk strategies.',
};

export default async function AcademyPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  let isAdmin = false;
  if (isLoggedIn) {
    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (userData?.is_admin) isAdmin = true;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {isLoggedIn ? <VaultNavbar isAdmin={isAdmin} /> : <LandingNavbar isLoggedIn={false} />}
      
      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '40px 24px' }}>
        <div style={{ width: '100%', maxWidth: '1200px' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px', marginTop: '32px' }}>
            <h1 style={{ fontSize: '48px', fontWeight: 700, margin: '0 0 16px 0', letterSpacing: '-0.02em' }}>
              Trading Academy
            </h1>
            <p style={{ fontSize: '20px', color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto', lineHeight: '1.6' }}>
              Master algorithmic execution. Explore our step-by-step setup guides and institutional trading strategies.
            </p>
          </div>

          <AcademyClient />
        </div>
      </main>
    </div>
  );
}
