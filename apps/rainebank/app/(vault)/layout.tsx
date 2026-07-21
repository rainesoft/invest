import { ThemeProvider } from '@components/ThemeProvider';
import VaultNavbar from '@components/VaultNavbar';
import { supabaseServer } from '@lib/supabase-server';
import { redirect } from 'next/navigation';

export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  // Enforce Onboarding
  const { data: riskSettings } = await supabase
    .from('user_risk_settings')
    .select('telegram_chat_id')
    .eq('user_id', user.id)
    .single();

  if (!riskSettings || !riskSettings.telegram_chat_id) {
    redirect('/onboarding');
  }

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
