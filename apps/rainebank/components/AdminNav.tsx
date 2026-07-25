'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileSearch, Zap, ArrowDownToLine, ArrowUpFromLine, Activity } from 'lucide-react';
import AutoTradingToggle from './AutoTradingToggle';


const TABS = [
  { href: '/admin/dashboard',   label: 'Dashboard',   Icon: Activity,        activeColor: '#10b981', activeBg: 'rgba(16,185,129,0.1)' },
  { href: '/admin/deposits',    label: 'Deposits',    Icon: ArrowDownToLine, activeColor: '#3b82f6', activeBg: 'rgba(59,130,246,0.1)' },
  { href: '/admin/withdrawals', label: 'Withdrawals', Icon: ArrowUpFromLine, activeColor: '#f87171', activeBg: 'rgba(248,113,113,0.1)' },
];


export default function AdminNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + '/');

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-white/5">
      <div className="flex bg-black/20 p-1 rounded-xl border border-white/5 backdrop-blur-md">
        {TABS.map(({ href, label, Icon, activeColor }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                active 
                  ? 'bg-white/10 text-white shadow-lg shadow-black/20 ring-1 ring-white/10 scale-100'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 scale-95 hover:scale-100'
              }`}
            >
              <Icon size={16} style={{ color: active ? activeColor : 'currentColor' }} className={active ? 'drop-shadow-lg' : ''} />
              {label}
            </Link>
          );
        })}
      </div>
      <div className="ml-auto">
        <AutoTradingToggle />
      </div>
    </div>
  );
}
