'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

export default function AutoTradingToggle() {
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(res => res.json())
      .then(data => {
        if (data.auto_trading_enabled !== undefined) {
          setIsEnabled(data.auto_trading_enabled);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setIsLoading(false));
  }, []);

  const toggle = async () => {
    const newState = !isEnabled;
    setIsEnabled(newState);
    const loadingToast = toast.loading(newState ? 'Enabling Auto Trading...' : 'Pausing Auto Trading...');
    
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_trading_enabled: newState })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      
      toast.success(newState ? 'Auto Trading ACTIVE' : 'Auto Trading PAUSED', { id: loadingToast });
    } catch (error: any) {
      setIsEnabled(!newState); // Revert
      toast.error(error.message, { id: loadingToast });
    }
  };

  if (isLoading) return null;

  return (
    <button
      onClick={toggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: isEnabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        border: `1px solid ${isEnabled ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
        color: isEnabled ? '#10b981' : '#ef4444',
        padding: '6px 12px',
        borderRadius: '8px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '13px',
        transition: 'all 0.2s',
        marginLeft: 'auto' // Pushes to the right side if flex container allows
      }}
    >
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: isEnabled ? '#10b981' : '#ef4444',
        boxShadow: isEnabled ? '0 0 8px #10b981' : '0 0 8px #ef4444'
      }} />
      {isEnabled ? 'AUTO TRADING: ON' : 'AUTO TRADING: OFF'}
    </button>
  );
}
