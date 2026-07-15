'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '@components/ThemeProvider';
import { Moon, Sun, ShieldAlert, KeyRound, Save, Activity, Info } from 'lucide-react';
import toast from 'react-hot-toast';

const HintTooltip = ({ text }: { text: string }) => {
  const [show, setShow] = useState(false);
  return (
    <div 
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Info size={14} color="var(--text-secondary)" />
      {show && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '8px',
          padding: '8px 12px',
          background: '#1f2937',
          color: '#f9fafb',
          fontSize: '12px',
          borderRadius: '6px',
          width: 'max-content',
          maxWidth: '250px',
          pointerEvents: 'none',
          zIndex: 50,
          textAlign: 'left',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          lineHeight: '1.4'
        }}>
          {text}
        </div>
      )}
    </div>
  );
};

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subscription, setSubscription] = useState<any>(null);
  const [showBreakerModal, setShowBreakerModal] = useState(false);
  
  const [settings, setSettings] = useState({
    portfolio_capital: 10000,
    risk_per_trade_pct: 0.01,
    max_portfolio_heat_pct: 0.10,
    max_drawdown_pct: 0.05,
    high_water_mark_equity: 0,
    max_spread_points: 50,
    max_volume_per_trade: 50,
    active_broker: 'ALPACA',
    meta_api_token: '',
    meta_api_account_id: '',
    alpaca_key: '',
    alpaca_secret: '',
    is_live_execution_enabled: false,
    auto_trade_enabled: false,
    sync_trailing_stops: false,
    auto_trade_tiers: [] as string[],
    telegram_bot_token: '',
    telegram_chat_id: ''
  });

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.settings) {
          setSettings({
            portfolio_capital: data.settings.portfolio_capital || 10000,
            risk_per_trade_pct: data.settings.risk_per_trade_pct || 0.01,
            max_portfolio_heat_pct: data.settings.max_portfolio_heat_pct || 0.10,
            max_drawdown_pct: data.settings.max_drawdown_pct || 0.05,
            high_water_mark_equity: data.settings.high_water_mark_equity || 0,
            max_spread_points: data.settings.max_spread_points || 50,
            max_volume_per_trade: data.settings.max_volume_per_trade || 50,
            active_broker: data.settings.active_broker || 'ALPACA',
            meta_api_token: data.settings.meta_api_token || '',
            meta_api_account_id: data.settings.meta_api_account_id || '',
            alpaca_key: data.settings.alpaca_key || '',
            alpaca_secret: data.settings.alpaca_secret || '',
            is_live_execution_enabled: data.settings.is_live_execution_enabled || false,
            auto_trade_enabled: data.settings.auto_trade_enabled || false,
            sync_trailing_stops: data.settings.sync_trailing_stops || false,
            auto_trade_tiers: data.settings.auto_trade_tiers || [],
            telegram_bot_token: data.settings.telegram_bot_token || '',
            telegram_chat_id: data.settings.telegram_chat_id || ''
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch('/api/billing')
      .then(res => res.json())
      .then(data => {
        if (data.subscription) setSubscription(data.subscription);
      })
      .catch(console.error);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleTierToggle = (tier: string) => {
    setSettings(prev => {
      const current = prev.auto_trade_tiers;
      const updated = current.includes(tier) 
        ? current.filter(t => t !== tier)
        : [...current, tier];
      return { ...prev, auto_trade_tiers: updated };
    });
  };

  const toggleCancellation = async () => {
    if (!subscription) return;
    const newCancelState = !subscription.cancel_at_period_end;
    
    setSubscription({ ...subscription, cancel_at_period_end: newCancelState });
    toast.success(newCancelState ? 'Subscription will cancel at period end' : 'Subscription resumed');

    try {
      await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: newCancelState })
      });
    } catch (e) {
      toast.error('Failed to update subscription');
      setSubscription({ ...subscription, cancel_at_period_end: !newCancelState });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Settings saved successfully!');
      } else {
        toast.error(data.error || 'Failed to save settings');
      }
    } catch (err) {
      toast.error('An error occurred while saving.');
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="page-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>Loading settings...</div>;
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0', background: 'linear-gradient(to right, var(--text-primary), var(--text-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Vault Settings</h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '15px' }}>Configure your personalized risk appetite and execution preferences.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          style={{ 
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'var(--accent)', color: '#fff', border: 'none', 
            padding: '12px 24px', borderRadius: '8px', cursor: 'pointer',
            fontWeight: 600, transition: 'all 0.2s', opacity: saving ? 0.7 : 1
          }}
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {subscription && (
        <div style={{ background: 'var(--input-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '32px' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', margin: '0 0 16px 0' }}>
            <Activity size={20} color="var(--accent)" />
            Billing & Subscription
          </h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <p style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600 }}>{subscription.plan_tier === 'pro' ? `Autopilot Pro ($${subscription.billing_amount_usd}/mo)` : 'Free Tier'}</p>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
                {subscription.status === 'active' ? (
                  subscription.cancel_at_period_end 
                    ? `Cancels on ${new Date(subscription.next_billing_date).toLocaleDateString()}`
                    : `Next billing date: ${new Date(subscription.next_billing_date).toLocaleDateString()}`
                ) : (
                  `Status: ${subscription.status}`
                )}
              </p>
            </div>
            {subscription.status === 'active' && (
              <button 
                onClick={toggleCancellation}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  background: subscription.cancel_at_period_end ? 'var(--accent)' : 'transparent',
                  color: subscription.cancel_at_period_end ? '#fff' : '#ef4444',
                  border: `1px solid ${subscription.cancel_at_period_end ? 'var(--accent)' : '#ef4444'}`,
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'all 0.2s'
                }}
              >
                {subscription.cancel_at_period_end ? 'Resume Subscription' : 'Cancel Subscription'}
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
        
        {/* Risk Panel */}
        <div style={{ background: 'var(--input-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', margin: '0 0 24px 0' }}>
            <ShieldAlert size={20} color="var(--accent)" />
            Risk Profiling
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Portfolio Capital (USD)
                <HintTooltip text="This is your total bankroll. It tells the AI exactly how much money you're playing with so it knows how to scale your trades properly." />
              </label>
              <input type="number" name="portfolio_capital" value={settings.portfolio_capital} onChange={handleChange} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Risk Per Trade (%) - {Number(settings.risk_per_trade_pct) * 100}%
                <HintTooltip text="The maximum slice of your bankroll you are willing to lose on a single bad trade. If this is 1% and you have $10,000, the AI ensures you only lose exactly $100 if a stop-loss is hit." />
              </label>
              <input type="number" step="0.001" name="risk_per_trade_pct" value={settings.risk_per_trade_pct} onChange={handleChange} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Global Portfolio Heat Cap (%) - {Number(settings.max_portfolio_heat_pct) * 100}%
                <HintTooltip text="Your 'total exposure limit'. If set to 10%, across all open trades combined you will never risk more than 10% of your account at the same time. If hit, the system prevents opening new trades until some close." />
              </label>
              <input type="number" step="0.01" name="max_portfolio_heat_pct" value={settings.max_portfolio_heat_pct} onChange={handleChange} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Max Drawdown Protection (%) - {Number(settings.max_drawdown_pct) * 100}%
                <HintTooltip text="The absolute maximum drop your account can take from its highest peak. If the AI loses this much, the Drawdown Breaker physically disconnects the broker to protect your capital. Perfect for passing strict Prop Firm rules." />
              </label>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input type="number" step="0.01" name="max_drawdown_pct" value={settings.max_drawdown_pct} onChange={handleChange} style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <button 
                  onClick={() => setShowBreakerModal(true)}
                  style={{ padding: '12px 16px', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                  Reset Breaker
                </button>
              </div>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Max Spread Tolerance (Points)
                <HintTooltip text="A safety filter to prevent paying exorbitant broker fees. If a crazy news event inflates the broker's spread beyond this point tolerance, the AI refuses to execute the trade so you don't get ripped off." />
              </label>
              <input type="number" step="1" name="max_spread_points" value={settings.max_spread_points} onChange={handleChange} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Max Volume Per Trade (Lots)
                <HintTooltip text="A hard speed-limit on the physical size of a trade. Even if your Risk Per Trade says you can afford to buy 175 lots, if this is set to 50, the AI will shrink the order down to 50 lots so the broker doesn't reject it." />
              </label>
              <input type="number" min="0.01" step="0.01" name="max_volume_per_trade" value={settings.max_volume_per_trade} onChange={handleChange} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
            </div>
          </div>
        </div>

        {/* Execution & UI Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          <div style={{ background: 'var(--input-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', margin: '0 0 24px 0' }}>
              <KeyRound size={20} color="var(--accent)" />
              Broker Connection
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div>
                <label style={{ display: 'block', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Active Broker</label>
                <select name="active_broker" value={settings.active_broker} onChange={handleChange} style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                  <option value="ALPACA" style={{ color: '#000' }}>Alpaca (Equities / Crypto)</option>
                  <option value="METAAPI" style={{ color: '#000' }}>MetaAPI (MT4 / MT5 / Forex)</option>
                </select>
              </div>

              {settings.active_broker === 'METAAPI' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>MetaApi Token</label>
                    <input type="password" name="meta_api_token" value={settings.meta_api_token} onChange={handleChange} placeholder="Enter your secret token" style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Account ID</label>
                    <input type="text" name="meta_api_account_id" value={settings.meta_api_account_id} onChange={handleChange} placeholder="MT4/MT5 Account ID from MetaApi" style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  </div>
                </>
              )}

              {settings.active_broker === 'ALPACA' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Alpaca Key</label>
                    <input type="text" name="alpaca_key" value={settings.alpaca_key} onChange={handleChange} placeholder="APCA-API-KEY-ID" style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Alpaca Secret</label>
                    <input type="password" name="alpaca_secret" value={settings.alpaca_secret} onChange={handleChange} placeholder="APCA-API-SECRET-KEY" style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  </div>
                </>
              )}
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(37, 99, 235, 0.1)', borderRadius: '8px', border: '1px solid rgba(37, 99, 235, 0.2)', marginTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Activity size={24} color={settings.is_live_execution_enabled ? '#10b981' : 'var(--text-secondary)'} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px' }}>Live Execution</h3>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Allow AI to place real trades.</p>
                  </div>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                  <input type="checkbox" name="is_live_execution_enabled" checked={settings.is_live_execution_enabled} onChange={handleChange} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: settings.is_live_execution_enabled ? '#10b981' : '#4b5563', transition: '.4s', borderRadius: '24px' }}>
                    <span style={{ position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px', backgroundColor: 'white', transition: '.4s', borderRadius: '50%', transform: settings.is_live_execution_enabled ? 'translateX(24px)' : 'translateX(0)' }}></span>
                  </span>
                </label>
              </div>

            </div>
          </div>

          {/* Automated Trading */}
          <div style={{ background: 'var(--input-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ padding: '10px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '10px', color: '#10b981' }}>
                <Activity size={24} />
              </div>
              <div>
                <h2 style={{ fontSize: '18px', margin: '0 0 4px 0' }}>Automated Trading</h2>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>Permit the AI to autonomously execute approved signal tiers.</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>Master Auto-Trade Switch</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Globally enable or disable automated order execution.</p>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                  <input type="checkbox" name="auto_trade_enabled" checked={settings.auto_trade_enabled} onChange={handleChange} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: settings.auto_trade_enabled ? '#10b981' : '#4b5563', transition: '.4s', borderRadius: '24px' }}>
                    <span style={{ position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px', backgroundColor: 'white', transition: '.4s', borderRadius: '50%', transform: settings.auto_trade_enabled ? 'translateX(24px)' : 'translateX(0)' }}></span>
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>Sync Trailing Stops to Live Broker</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Physically modify live MT4/MT5 limit orders to lock in profit as price moves.</p>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                  <input type="checkbox" name="sync_trailing_stops" checked={settings.sync_trailing_stops} onChange={handleChange} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: settings.sync_trailing_stops ? '#10b981' : '#4b5563', transition: '.4s', borderRadius: '24px' }}>
                    <span style={{ position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px', backgroundColor: 'white', transition: '.4s', borderRadius: '50%', transform: settings.sync_trailing_stops ? 'translateX(24px)' : 'translateX(0)' }}></span>
                  </span>
                </label>
              </div>

              {settings.auto_trade_enabled && (
                <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Permitted Signal Tiers</label>
                  <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>Select which AI confidence tiers are allowed to bypass manual review.</p>
                  
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {['S-Tier', 'A-Tier', 'B-Tier', 'C-Tier'].map(tier => (
                      <button
                        key={tier}
                        onClick={() => handleTierToggle(tier)}
                        style={{
                          background: settings.auto_trade_tiers.includes(tier) ? 'rgba(37, 99, 235, 0.2)' : 'transparent',
                          border: `1px solid ${settings.auto_trade_tiers.includes(tier) ? '#3b82f6' : 'var(--border-color)'}`,
                          color: settings.auto_trade_tiers.includes(tier) ? '#60a5fa' : 'var(--text-secondary)',
                          padding: '8px 16px',
                          borderRadius: '24px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '13px',
                          transition: 'all 0.2s'
                        }}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Alerts & Notifications */}
          <div style={{ background: 'var(--input-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={20} color="var(--text-secondary)" />
              Alerts & Notifications
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Telegram Bot Token
                  <HintTooltip text="Create a bot via BotFather on Telegram and paste the HTTP API Token here to receive instant trade alerts." />
                </label>
                <input type="password" name="telegram_bot_token" value={settings.telegram_bot_token} onChange={handleChange} placeholder="e.g. 123456789:ABCdefGHIjkl..." style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Telegram Chat ID
                  <HintTooltip text="Your personal Telegram Chat ID (Positive numbers only). The bot will send automated real-time trade signals directly to this chat. Group chats and channels are strictly prohibited." />
                </label>
                <input 
                  type="text" 
                  name="telegram_chat_id" 
                  value={settings.telegram_chat_id} 
                  onChange={(e) => {
                    // Anti-piracy: Strip negative signs, @ symbols, and letters
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setSettings({ ...settings, telegram_chat_id: val });
                  }} 
                  placeholder="e.g. 987654321" 
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} 
                />
              </div>
            </div>
          </div>

          {/* Preferences */}
          <div style={{ background: 'var(--input-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 24px 0' }}>UI Preferences</h2>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ margin: '0 0 4px 0', fontWeight: 500 }}>Theme Mode</p>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Toggle between Light and Dark interface.</p>
              </div>
              <button 
                onClick={toggleTheme}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '8px',
                  background: 'transparent', border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer'
                }}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Reset Breaker Confirmation Modal */}
      {showBreakerModal && typeof document !== 'undefined' ? <>{createPortal(
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 99999
        }}>
          <div style={{
            background: 'var(--bg-color)', border: '1px solid var(--border-color)',
            borderRadius: '16px', padding: '32px', maxWidth: '400px', width: '90%',
            boxShadow: '0 24px 48px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <ShieldAlert size={28} color="#ef4444" />
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Reset Drawdown Breaker?</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '1.6', marginBottom: '24px' }}>
              Resetting the Drawdown Breaker will erase your High-Water Mark and immediately resume trading. Are you sure you want to do this?
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setShowBreakerModal(false)}
                style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  setSettings(prev => ({ ...prev, high_water_mark_equity: 0 }));
                  toast.success("Breaker Reset! Remember to click Save Settings.");
                  setShowBreakerModal(false);
                }}
                style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
              >
                Yes, Reset Breaker
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}</> : null}

    </div>
  );
}