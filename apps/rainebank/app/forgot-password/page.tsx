'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@lib/supabase';
import { Terminal, ArrowRight, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Logo from '@components/Logo';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
      });
      if (resetError) throw resetError;
      
      setSuccess('Recovery link dispatched. Check your institutional email.');
    } catch (err: any) {
      console.error("Password Reset Error:", err);
      setError(err.message || 'An error occurred during password recovery.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#050505',
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background Gradients */}
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: 'radial-gradient(circle at 15% 15%, rgba(37, 99, 235, 0.1) 0%, transparent 40%), radial-gradient(circle at 85% 85%, rgba(74, 222, 128, 0.05) 0%, transparent 40%)',
        zIndex: 0, pointerEvents: 'none'
      }} />

      {/* Floating Header */}
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', zIndex: 10 }}>
        <nav style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          background: 'rgba(20, 20, 20, 0.6)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.05)', borderRadius: '100px',
          padding: '12px 32px', width: '100%', maxWidth: '1200px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <Logo />
          </Link>
        </nav>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', zIndex: 10 }}>
        {/* Main Card */}
        <div
          style={{
            width: '100%',
            maxWidth: '420px',
            padding: '40px',
            background: 'linear-gradient(145deg, rgba(30,30,30,0.8) 0%, rgba(15,15,15,0.8) 100%)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '24px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
            <div
              style={{
                padding: '12px',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderRadius: '12px',
                border: '1px solid rgba(56, 189, 248, 0.2)',
              }}
            >
              <Terminal size={32} color="#38bdf8" />
            </div>
          </div>

          <h2
            style={{
              fontSize: '28px',
              fontWeight: 800,
              textAlign: 'center',
              marginBottom: '8px',
              letterSpacing: '-1px',
              color: '#fff'
            }}
          >
            Recover Ledger Access
          </h2>
          <p
            style={{
              color: '#9ca3af',
              textAlign: 'center',
              marginBottom: '32px',
              fontSize: '15px',
            }}
          >
            Enter your email to receive a recovery link.
          </p>

          {error && (
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderLeft: '4px solid #ef4444',
                borderRadius: '8px',
                marginBottom: '24px',
                fontSize: '14px',
                color: '#fca5a5',
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderLeft: '4px solid #22c55e',
                borderRadius: '8px',
                marginBottom: '24px',
                fontSize: '14px',
                color: '#86efac',
              }}
            >
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: '#9ca3af',
                }}
              >
                INSTITUTIONAL EMAIL
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@fund.com"
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  backgroundColor: '#0a0a0a',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  color: 'white',
                  fontSize: '15px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#38bdf8')}
                onBlur={(e) => (e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)')}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                marginTop: '16px',
                padding: '16px',
                backgroundColor: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: '100px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'opacity 0.2s',
                opacity: loading ? 0.7 : 1,
              }}
              onMouseOver={(e) => {
                if (!loading) e.currentTarget.style.opacity = '0.9';
              }}
              onMouseOut={(e) => {
                if (!loading) e.currentTarget.style.opacity = '1';
              }}
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  Dispatch Magic Link <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div style={{ marginTop: '32px', textAlign: 'center' }}>
            <Link 
              href="/login"
              style={{
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                fontSize: '14px',
                cursor: 'pointer',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <ArrowLeft size={16} /> Return to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
