'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileSearch, Zap, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

const TABS = [
  { href: '/admin/deposits',    label: 'Deposits',    Icon: ArrowDownToLine, activeColor: '#3b82f6', activeBg: 'rgba(59,130,246,0.1)' },
  { href: '/admin/withdrawals', label: 'Withdrawals', Icon: ArrowUpFromLine, activeColor: '#f87171', activeBg: 'rgba(248,113,113,0.1)' },
  { href: '/admin/research',    label: 'Research',    Icon: FileSearch,      activeColor: '#a78bfa', activeBg: 'rgba(167,139,250,0.1)' },
  { href: '/admin/signals',     label: 'Signals',     Icon: Zap,             activeColor: '#fbbf24', activeBg: 'rgba(251,191,36,0.1)' },
];


export default function AdminNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + '/');

  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      marginBottom: '24px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      paddingBottom: '16px',
      flexWrap: 'wrap',  /* wraps on small screens instead of overflowing */
    }}>
      {TABS.map(({ href, label, Icon, activeColor, activeBg }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            style={{
              textDecoration: 'none',
              padding: '7px 14px',
              borderRadius: '8px',
              background: active ? activeBg : 'transparent',
              color: active ? activeColor : '#9ca3af',
              fontWeight: active ? 600 : 400,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
              border: `1px solid ${active ? activeColor + '33' : 'transparent'}`,
            }}
          >
            <Icon size={15} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
