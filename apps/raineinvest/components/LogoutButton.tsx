'use client';

import { supabase } from '@lib/supabase';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      style={{
        background: 'none',
        border: 'none',
        color: '#a1a1aa',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '6px',
        transition: 'all 0.2s',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.color = '#ef4444';
        e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.color = '#a1a1aa';
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      title="Logout"
    >
      <LogOut size={16} />
      <span style={{ fontSize: '14px', fontWeight: 500 }}>Exit Vault</span>
    </button>
  );
}
