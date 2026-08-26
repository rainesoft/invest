"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import { Menu, X } from 'lucide-react';

export default function LandingNavbar({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const isComparePage = pathname === '/compare';

  return (
    <div className="w-full px-6 py-6 flex justify-center relative z-50">
      <nav 
        className={`w-full max-w-6xl flex flex-col bg-[#111111]/90 backdrop-blur-xl border border-white/10 px-8 py-4 shadow-2xl transition-all duration-200 ease-in-out ${isOpen ? 'rounded-3xl' : 'rounded-full'}`}
      >
        {/* Top Bar */}
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-12">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <Logo />
            </Link>

            {/* Desktop Links */}
            <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
              {isComparePage ? (
                <Link href="/" className="hover:text-white transition-colors">Home</Link>
              ) : (
                <>
                  <Link href="#features" className="hover:text-white transition-colors">Features</Link>
                  <Link href="#pricing" className="hover:text-white transition-colors">Pricing</Link>
                  <Link href="/academy" className="hover:text-white transition-colors">Academy</Link>
                </>
              )}
            </div>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-6">
            {!isLoggedIn && (
              <Link href="/login" className="text-sm font-semibold text-white hover:text-gray-300 transition-colors">
                Log in
              </Link>
            )}
            <Link 
              href={isLoggedIn ? "/dashboard" : "/login"} 
              className="bg-white text-black px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-200 transition-colors"
            >
              {isLoggedIn ? "Open Vault" : "Get Started"}
            </Link>
          </div>

          {/* Mobile Toggle Button */}
          <div className="flex md:hidden items-center">
            <button 
              onClick={() => setIsOpen(!isOpen)} 
              className="p-2 text-white hover:bg-white/10 rounded-full transition-colors"
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {isOpen && (
          <div className="flex md:hidden flex-col gap-5 mt-6 pt-6 border-t border-white/10 pb-4 animate-in slide-in-from-top-2">
            {isComparePage ? (
              <Link onClick={() => setIsOpen(false)} href="/" className="text-lg font-semibold text-white">Home</Link>
            ) : (
              <>
                <Link onClick={() => setIsOpen(false)} href="#features" className="text-lg font-semibold text-white">Features</Link>
                <Link onClick={() => setIsOpen(false)} href="#pricing" className="text-lg font-semibold text-white">Pricing</Link>
                <Link onClick={() => setIsOpen(false)} href="/academy" className="text-lg font-semibold text-white">Academy</Link>
              </>
            )}

            <div className="flex flex-col gap-4 mt-4 pt-6 border-t border-white/10">
              {!isLoggedIn && (
                <Link 
                  onClick={() => setIsOpen(false)} 
                  href="/login" 
                  className="text-white text-center py-3 rounded-xl border border-white/20 font-semibold text-base hover:bg-white/5 transition-colors"
                >
                  Log in
                </Link>
              )}
              <Link 
                onClick={() => setIsOpen(false)} 
                href={isLoggedIn ? "/dashboard" : "/login"} 
                className="bg-white text-black py-3 rounded-full text-center font-semibold text-base hover:bg-gray-200 transition-colors"
              >
                {isLoggedIn ? "Open Vault" : "Get Started"}
              </Link>
            </div>
          </div>
        )}
      </nav>
    </div>
  );
}
