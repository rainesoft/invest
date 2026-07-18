import { redirect } from 'next/navigation';
import { supabaseServer } from '@lib/supabase-server';
import ResearchClient from './ResearchClient';

export default async function ResearchPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Enforce RBAC: check if user is admin
  const { data: userData } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!userData?.is_admin) {
    // If not admin, redirect them to the vault dashboard
    redirect('/dashboard');
  }

  return <ResearchClient />;
}
