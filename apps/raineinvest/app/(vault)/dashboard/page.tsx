'use client';

import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@lib/supabase';
import dynamic from 'next/dynamic';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, Activity, Target } from 'lucide-react';
import toast from 'react-hot-toast';

function parseAnalysisText(text: string) {
  const match = text.match(/^\[(.*?-Tier)\] \[(.*?) -> (.*?)\]/);
  if (!match) {
    const fallbackMatch = text.match(/^\[(.*?) -> (.*?)\]/);
    if (!fallbackMatch) return { tier: null, structure: null, strategy: null, content: text };
    return {
      tier: null,
      structure: fallbackMatch[1],
      strategy: fallbackMatch[2],
      content: text.replace(fallbackMatch[0], '').trim()
    };
  }
  return {
    tier: match[1],
    structure: match[2],
    strategy: match[3],
    content: text.replace(match[0], '').trim()
  };
}

function TrendBadge({ tier, structure, strategy }: { tier: string | null, structure: string | null, strategy: string | null }) {
  if (!structure) return null;
  
  let label = 'NONE';
  let color = '#9ca3af';
  let bg = 'rgba(156,163,175,0.1)';
  let Icon = Minus;
  
  if (structure.includes('BULLISH')) {
    label = 'BULLISH';
    color = '#4ade80';
    bg = 'rgba(74,222,128,0.1)';
    Icon = TrendingUp;
  } else if (structure.includes('BEARISH')) {
    label = 'BEARISH';
    color = '#f87171';
    bg = 'rgba(248,113,113,0.1)';
    Icon = TrendingDown;
  }

  // Tier Colors
  let tierColor = '#9ca3af';
  let tierBg = 'rgba(156,163,175,0.1)';
  if (tier === 'S-Tier') {
    tierColor = '#fbbf24'; // amber-400
    tierBg = 'rgba(251,191,36,0.1)';
  } else if (tier === 'A-Tier') {
    tierColor = '#c084fc'; // purple-400
    tierBg = 'rgba(192,132,252,0.1)';
  } else if (tier === 'B-Tier') {
    tierColor = '#38bdf8'; // sky-400
    tierBg = 'rgba(56,189,248,0.1)';
  } else if (tier === 'C-Tier') {
    tierColor = '#f87171'; // red-400
    tierBg = 'rgba(248,113,113,0.1)';
  }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
      {tier && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: tierBg, color: tierColor, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 800 }}>
          <span>{tier}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: bg, color, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>
        <Icon size={14} />
        <span>TREND: {label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', color: '#e5e7eb', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
        <span>STRATEGY: {strategy}</span>
      </div>
    </div>
  );
}

const TooltipIcon = ({ text, color, bgColor }: { text: string, color: string, bgColor: string }) => {
  const [show, setShow] = useState(false);
  return (
    <div 
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle', marginLeft: '4px' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', width: '16px', height: '16px', borderRadius: '50%', background: bgColor, color: color, fontSize: '10px', cursor: 'help', fontWeight: 800 }}>i</span>
      {show && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: '8px', padding: '12px', background: '#1a1a1a', color: '#e5e7eb', fontSize: '13px',
          borderRadius: '8px', width: 'max-content', maxWidth: '300px', whiteSpace: 'normal',
          zIndex: 100, border: '1px solid #333', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
          lineHeight: '1.4', fontWeight: 500, textAlign: 'left'
        }}>
          {text}
        </div>
      )}
    </div>
  );
};

const CheckoutButton = dynamic(() => import('@components/CheckoutButton'), {
  ssr: false,
});

type VaultSignal = {
  id: string;
  symbol: string;
  side: string;
  timeframe: string;
  status: string;
  created_at: string;
  entry_plan_json?: { price: number; limit_price?: number; order_type?: string } | null;
  stop_plan_json?: { stop: number; stop_price?: number } | null;
  take_profit_json?: { tp: number; tp_price?: number } | null;
  ai_summary?: string | null;
  ai_risks?: string | null;
  meta_api_order_id?: string;
  risk_amount?: number;
  volume?: number;
  trade_type?: string;
  confidence?: number;
};

export default function VaultDashboard() {
  const [signals, setSignals] = useState<VaultSignal[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [isPro, setIsPro] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hideRejected, setHideRejected] = useState(true);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [metricsRes, { data: authData }] = await Promise.all([
          fetch('/api/vault/metrics'),
          supabase.auth.getUser()
        ]);

        if (authData.user) {
          setUser({ id: authData.user.id, email: authData.user.email || '' });
        }

        const metricsData = await metricsRes.json();
        if (metricsRes.ok && !metricsData.error) {
          setMetrics(metricsData);
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to load dashboard metrics');
        console.error('Failed to load initial data', err);
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    const loadSignals = async () => {
      try {
        const res = await fetch(`/api/vault/signals?page=${page}&limit=10&hideRejected=${hideRejected}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        const data = await res.json();

        if (res.ok) {
          setSignals(data.signals || []);
          setIsPro(data.is_pro || false);
          if (data.pagination) {
            setTotalPages(Math.ceil(data.pagination.total / data.pagination.limit) || 1);
          }
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to load signals');
        console.error('Failed to load signals', err);
      } finally {
        setLoading(false);
      }
    };

    loadSignals();
  }, [page, hideRejected]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <div style={{ color: '#38bdf8', fontSize: '18px', fontWeight: 600 }}>Decrypting Ledger...</div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: '64px' }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '36px', fontWeight: 800, color: '#fff', letterSpacing: '-1px', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Activity size={36} color="#38bdf8" />
            The Vault
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '15px', marginTop: '8px' }}>Immutable execution ledger and system metrics.</p>
        </div>
        {!isPro ? (
          <div style={{
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            padding: '8px 16px',
            borderRadius: '100px',
            fontSize: '13px',
            fontWeight: 700,
            color: '#fef08a'
          }}>
            TIER 1 (DELAYED)
          </div>
        ) : (
          <div style={{
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            padding: '8px 16px',
            borderRadius: '100px',
            fontSize: '13px',
            fontWeight: 700,
            color: '#38bdf8'
          }}>
            ALPHA UNLOCKED
          </div>
        )}
      </div>

      {!isPro && user && (
        <div style={{
          background: 'linear-gradient(145deg, rgba(30,30,30,0.8) 0%, rgba(15,15,15,0.8) 100%)',
          border: '1px solid rgba(255,255,255,0.05)',
          padding: '32px',
          borderRadius: '24px',
          marginBottom: '40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '24px'
        }}>
          <div>
            <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>Public Access Mode</h3>
            <p style={{ color: '#9ca3af', fontSize: '15px', maxWidth: '600px', margin: 0 }}>
              Signals are intentionally delayed by 4+ hours and proprietary execution rationale is redacted.
              Upgrade to <strong>RaineInvest Alpha</strong> for real-time institutional market intelligence.
            </p>
          </div>
          <div style={{ minWidth: '200px' }}>
            <CheckoutButton
              email={user.email}
              userId={user.id}
              amountUSD={19}
            />
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      {metrics && (
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px', marginBottom: '24px' }}>
            <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
              <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>WIN RATE (30D)</div>
              <div style={{ fontSize: '40px', fontWeight: 800, color: '#4ade80', letterSpacing: '-1px' }}>
                {metrics.winRate}%
              </div>
            </div>
            <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
              <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>NET R-MULTIPLE</div>
              <div style={{ fontSize: '40px', fontWeight: 800, color: '#38bdf8', letterSpacing: '-1px' }}>
                {metrics.netR > 0 ? '+' : ''}{metrics.netR}R
              </div>
            </div>
            <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
              <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>SYSTEM EXPECTANCY</div>
              <div style={{ fontSize: '40px', fontWeight: 800, color: '#a855f7', letterSpacing: '-1px' }}>
                {metrics.expectancy > 0 ? '+' : ''}{metrics.expectancy}R
              </div>
            </div>
          </div>

          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px', height: '400px' }}>
            <div style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '24px', fontWeight: 600 }}>CUMULATIVE EQUITY CURVE (R)</div>
            <div style={{ width: '100%', height: 'calc(100% - 40px)' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.equityCurve} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorR" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }}
                    itemStyle={{ color: '#38bdf8', fontWeight: 'bold' }}
                  />
                  <Area type="monotone" dataKey="cumulative_r" stroke="#38bdf8" strokeWidth={3} fillOpacity={1} fill="url(#colorR)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Signals List */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>Ledger Feed</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 600 }}>Hide Rejected / Expired</span>
          <div 
            onClick={() => setHideRejected(!hideRejected)}
            style={{ 
              width: '40px', height: '24px', borderRadius: '12px', 
              background: hideRejected ? '#38bdf8' : '#333',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s'
            }}
          >
            <div style={{
              width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
              position: 'absolute', top: '3px', left: hideRejected ? '19px' : '3px',
              transition: 'left 0.2s'
            }} />
          </div>
        </div>
      </div>

      {signals.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280', background: '#111', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
          No executions found in your vault yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {signals.map((signal) => {
          const entryPrice = signal.entry_plan_json?.price || signal.entry_plan_json?.limit_price;
          const stopPrice = signal.stop_plan_json?.stop || signal.stop_plan_json?.stop_price;
          const tpPrice = signal.take_profit_json?.tp || signal.take_profit_json?.tp_price;

          const isWarning = signal.status === 'REJECTED';

          return (
            <div
              key={signal.id}
              style={{
                background: '#0a0a0a',
                border: `1px solid ${isWarning ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.05)'}`,
                padding: '24px', borderRadius: '20px', transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.4)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              {/* Symbol / Side / Time */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#fff' }}>{signal.symbol}</div>
                  <div style={{
                    background: signal.side === 'LONG' || signal.side === 'BUY' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                    color: signal.side === 'LONG' || signal.side === 'BUY' ? '#4ade80' : '#f87171',
                    padding: '3px 10px', borderRadius: '100px', fontSize: '12px', fontWeight: 800
                  }}>{signal.side}</div>
                  <div style={{ color: '#9ca3af', fontSize: '13px', fontWeight: 600 }}>{signal.timeframe}</div>
                  {signal.confidence && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', padding: '3px 10px', borderRadius: '100px', fontSize: '12px', fontWeight: 800 }}>
                      <Target size={14} />
                      {signal.confidence}% CONFIDENCE
                    </div>
                  )}
                </div>
                <div style={{ color: '#6b7280', fontSize: '13px' }}>{new Date(signal.created_at).toLocaleString()}</div>
              </div>

              {/* LIVE EXECUTION BANNER */}
              {(() => {
                if (!signal.meta_api_order_id) return null;
                
                const orderType = (signal.entry_plan_json?.order_type || 'MARKET').toUpperCase();
                const isPending = orderType.includes('LIMIT') || orderType.includes('STOP') || signal.status === 'VPS_PENDING' || signal.status === 'PENDING';
                const label = isPending ? `PENDING (${orderType})` : 'LIVE EXECUTION';
                const colorHex = isPending ? '#fbbf24' : '#34d399';
                const bgRgba = isPending ? 'rgba(251,191,36,0.1)' : 'rgba(16,185,129,0.1)';
                const borderRgba = isPending ? 'rgba(251,191,36,0.2)' : 'rgba(16,185,129,0.2)';
                const shadowRgba = isPending ? 'rgba(251,191,36,0.05)' : 'rgba(16,185,129,0.05)';
                const containerBg = isPending ? 'rgba(251,191,36,0.05)' : 'rgba(16,185,129,0.05)';

                return (
                  <div style={{
                    background: containerBg,
                    border: `1px solid ${borderRgba}`,
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    boxShadow: `0 0 20px ${shadowRgba}`
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', background: bgRgba, padding: '6px 12px', borderRadius: '100px' }}>
                        <span style={{ display: 'flex', position: 'relative', width: '8px', height: '8px' }}>
                          <span style={{ animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite', position: 'absolute', display: 'inline-flex', height: '100%', width: '100%', borderRadius: '9999px', backgroundColor: colorHex, opacity: 0.75 }}></span>
                          <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '9999px', height: '8px', width: '8px', backgroundColor: colorHex }}></span>
                        </span>
                        <span style={{ color: colorHex, fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em' }}>{label}</span>
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: '12px', fontFamily: 'monospace' }}>ID: {signal.meta_api_order_id}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '24px' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600 }}>RISK ALLOCATION</div>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>${signal.risk_amount?.toFixed(2) || '0.00'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600 }}>VOLUME</div>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{signal.volume} Lots</div>
                      </div>
                      <div>
                         <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600 }}>TYPE</div>
                         <div style={{ fontSize: '15px', fontWeight: 700, color: '#818cf8' }}>{signal.trade_type || 'STANDARD'}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Price Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                {[
                  { label: 'ENTRY', value: entryPrice, color: '#e5e7eb' },
                  { label: 'STOP LOSS', value: stopPrice, color: '#f87171' },
                  { label: 'TAKE PROFIT', value: tpPrice, color: '#4ade80' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: '#111', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.02)' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px', fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: '17px', fontWeight: 700, color: value && isPro ? color : '#6b7280' }}>
                      {value && isPro ? value : !isPro ? <span style={{ filter: 'blur(6px)', userSelect: 'none' }}>0.0000</span> : '—'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Invalidation reason */}
              {signal.status === 'REJECTED' && signal.ai_risks && (
                <div style={{ background: 'rgba(248,113,113,0.1)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '6px', fontWeight: 800 }}>REASON FOR REJECTION/INVALIDATION</div>
                  <p style={{ margin: 0, fontSize: '14px', color: '#fca5a5', lineHeight: 1.5 }}>{signal.ai_risks}</p>
                </div>
              )}

              {/* AI Rationale */}
              <div style={{ background: isWarning ? 'rgba(248,113,113,0.05)' : 'rgba(37,99,235,0.05)', padding: '18px', borderRadius: '14px', border: `1px solid ${isWarning ? 'rgba(248,113,113,0.2)' : 'rgba(37,99,235,0.1)'}`, marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', color: isWarning ? '#f87171' : '#38bdf8', marginBottom: '10px', fontWeight: 700 }}>
                  {isWarning ? 'AGENT-RISK WARNING' : 'LLM INSTITUTIONAL RATIONALE'}
                </div>
                {signal.ai_summary ? (
                  <>
                    <TrendBadge {...parseAnalysisText(signal.ai_summary)} />
                    <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.6, color: '#e5e7eb' }}>
                      {parseAnalysisText(signal.ai_summary).content}
                    </p>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: '15px', color: '#9ca3af', fontStyle: 'italic' }}>
                    {isPro ? 'Awaiting institutional analysis sequence.' : 'Institutional thesis hidden. Upgrade to Alpha to view full LLM Rationale and logical validation sequence.'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '40px' }}>
          <button
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{
              padding: '8px 16px',
              background: '#111',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              color: page === 1 ? '#4b5563' : '#fff',
              cursor: page === 1 ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              transition: 'all 0.2s'
            }}
          >
            Previous
          </button>
          <div style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>
            Page {page} of {totalPages}
          </div>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            style={{
              padding: '8px 16px',
              background: '#111',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              color: page === totalPages ? '#4b5563' : '#fff',
              cursor: page === totalPages ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              transition: 'all 0.2s'
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}