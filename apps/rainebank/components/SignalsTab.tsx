'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';
import { TrendingUp, TrendingDown, Minus, Target } from 'lucide-react';

type Opportunity = {
  id: string;
  symbol: string;
  side: string;
  timeframe: string;
  created_at: string;
  entry_plan_json: any;
  stop_plan_json: any;
  take_profit_json: any;
  ai_summary: string | null;
  ai_risks: string | null;
  status: string;
  confidence: number;
};

function parseAnalysisText(text: string) {
  const agentMatch = text.match(/^\[(SWING|SCALPER|SNIPER|NEWS)\]/i);
  const agent = agentMatch ? agentMatch[1].toUpperCase() : null;
  
  let cleanText = text;
  if (agentMatch) {
    cleanText = cleanText.substring(agentMatch[0].length).trim();
  }

  const match = cleanText.match(/^\[(.*?-Tier)\]\s*\[(.*?)\s*(?:->|→)\s*(.*?)\]/);
  if (!match) {
    const fallbackMatch = cleanText.match(/^\[(.*?)\s*(?:->|→)\s*(.*?)\]/);
    if (!fallbackMatch) return { agent, tier: null, structure: null, strategy: null, content: cleanText };
    return {
      agent,
      tier: null,
      structure: fallbackMatch[1],
      strategy: fallbackMatch[2],
      content: cleanText.replace(fallbackMatch[0], '').trim()
    };
  }
  return {
    agent,
    tier: match[1],
    structure: match[2],
    strategy: match[3],
    content: cleanText.replace(match[0], '').trim()
  };
}

function TrendBadge({ agent, tier, structure, strategy }: { agent: string | null, tier: string | null, structure: string | null, strategy: string | null }) {
  if (!structure) return null;

  let label = 'NONE';
  let color = '#9ca3af';
  let bg = 'rgba(156,163,175,0.1)';
  let Icon = Minus;

  if (structure.includes('BULLISH')) {
    label = 'BULLISH'; color = '#4ade80'; bg = 'rgba(74,222,128,0.1)'; Icon = TrendingUp;
  } else if (structure.includes('BEARISH')) {
    label = 'BEARISH'; color = '#f87171'; bg = 'rgba(248,113,113,0.1)'; Icon = TrendingDown;
  }

  let tierColor = '#9ca3af';
  let tierBg = 'rgba(156,163,175,0.1)';
  if (tier === 'S-Tier') { tierColor = '#fbbf24'; tierBg = 'rgba(251,191,36,0.1)'; }
  else if (tier === 'A-Tier') { tierColor = '#c084fc'; tierBg = 'rgba(192,132,252,0.1)'; }
  else if (tier === 'B-Tier') { tierColor = '#38bdf8'; tierBg = 'rgba(56,189,248,0.1)'; }
  else if (tier === 'C-Tier') { tierColor = '#f87171'; tierBg = 'rgba(248,113,113,0.1)'; }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
      {agent && (
        <div style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 800 }}>
          {agent}
        </div>
      )}
      {tier && (
        <div style={{ background: tierBg, color: tierColor, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 800 }}>
          {tier}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: bg, color, padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>
        <Icon size={14} />
        <span>TREND: {label}</span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.05)', color: '#e5e7eb', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
        STRATEGY: {strategy}
      </div>
    </div>
  );
}

export default function SignalsTab({ liveTrades = [] }: { liveTrades?: any[] }) {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'INVALIDATED' | 'REJECTED'>('ACTIVE');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [hasMore, setHasMore] = useState(false);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('trade_opportunities')
        .select('id, symbol, side, timeframe, created_at, entry_plan_json, stop_plan_json, take_profit_json, ai_summary, ai_risks, status, confidence', { count: 'exact' })
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (activeTab === 'ACTIVE') {
        query = query.eq('status', 'APPROVED').not('ai_summary', 'ilike', '%C-Tier%');
      } else if (activeTab === 'INVALIDATED') {
        query = query.eq('status', 'REJECTED').ilike('ai_risks', '%Invalidated%');
      } else {
        query = query.eq('status', 'REJECTED').not('ai_risks', 'ilike', '%Invalidated%');
      }

      const { data, count } = await query;
      setOpps(data ?? []);
      setHasMore(count ? (from + pageSize) < count : false);
      setTotalPages(count ? Math.ceil(count / pageSize) : 1);
      setLoading(false);
    };
    load();
  }, [page, activeTab]);

  if (loading && opps.length === 0) {
    return <div style={{ color: '#9ca3af', fontSize: '15px' }}>Loading signals...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', margin: 0 }}>
          Active PAMM Execution Desk & AI Signals
        </h2>
        <div style={{ display: 'flex', background: '#111', padding: '4px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          {(['ACTIVE', 'INVALIDATED', 'REJECTED'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setPage(1); setActiveTab(tab); }}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: 'none',
                background: activeTab === tab ? '#262626' : 'transparent',
                color: activeTab === tab ? '#fff' : '#9ca3af',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {opps.length === 0 && <p style={{ color: '#9ca3af' }}>No signals in this category.</p>}

      {/* Signal Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: loading ? 'none' : 'auto' }}>
        {opps.map((signal) => {
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
                    background: signal.side === 'LONG' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                    color: signal.side === 'LONG' ? '#4ade80' : '#f87171',
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
                const trade = liveTrades.find(t => t.trade_opportunities?.id === signal.id);
                if (!trade) return null;
                return (
                  <div style={{
                    background: 'rgba(16,185,129,0.05)',
                    border: '1px solid rgba(16,185,129,0.2)',
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    boxShadow: '0 0 20px rgba(16,185,129,0.05)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(16,185,129,0.1)', padding: '6px 12px', borderRadius: '100px' }}>
                        <span style={{ display: 'flex', position: 'relative', width: '8px', height: '8px' }}>
                          <span style={{ animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite', position: 'absolute', display: 'inline-flex', height: '100%', width: '100%', borderRadius: '9999px', backgroundColor: '#34d399', opacity: 0.75 }}></span>
                          <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '9999px', height: '8px', width: '8px', backgroundColor: '#10b981' }}></span>
                        </span>
                        <span style={{ color: '#34d399', fontSize: '11px', fontWeight: 800, letterSpacing: '0.05em' }}>LIVE EXECUTION</span>
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: '12px', fontFamily: 'monospace' }}>ID: {trade.meta_api_order_id}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '24px' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600 }}>RISK ALLOCATION</div>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>${trade.risk_amount?.toFixed(2) || '0.00'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600 }}>VOLUME</div>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{trade.volume} Lots</div>
                      </div>
                      <div>
                         <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px', fontWeight: 600 }}>TYPE</div>
                         <div style={{ fontSize: '15px', fontWeight: 700, color: '#818cf8' }}>{trade.trade_type || 'STANDARD'}</div>
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
                    <div style={{ fontSize: '17px', fontWeight: 700, color: value ? color : '#6b7280' }}>{value ?? '—'}</div>
                  </div>
                ))}
              </div>

              {/* Invalidation reason */}
              {activeTab === 'INVALIDATED' && signal.ai_risks && (
                <div style={{ background: 'rgba(248,113,113,0.1)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '6px', fontWeight: 800 }}>REASON FOR INVALIDATION</div>
                  <p style={{ margin: 0, fontSize: '14px', color: '#fca5a5', lineHeight: 1.5 }}>{signal.ai_risks}</p>
                </div>
              )}

              {/* AI Rationale */}
              <div style={{ background: isWarning ? 'rgba(248,113,113,0.05)' : 'rgba(37,99,235,0.05)', padding: '18px', borderRadius: '14px', border: `1px solid ${isWarning ? 'rgba(248,113,113,0.2)' : 'rgba(37,99,235,0.1)'}`, marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', color: isWarning ? '#f87171' : '#38bdf8', marginBottom: '10px', fontWeight: 700 }}>
                  {isWarning ? 'AI RISK OFFICER WARNING' : 'LLM INSTITUTIONAL RATIONALE'}
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
                    Awaiting institutional analysis sequence.
                  </p>
                )}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                <div style={{ color: signal.status === 'APPROVED' ? '#10b981' : '#9ca3af', fontSize: '13px', fontWeight: 600 }}>
                  Status: {signal.status}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {!(page === 1 && !hasMore) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '32px' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '10px 24px', background: page === 1 ? 'rgba(255,255,255,0.05)' : '#262626', color: page === 1 ? '#6b7280' : '#fff', border: 'none', borderRadius: '8px', cursor: page === 1 ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
            Previous
          </button>
          <div style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 600 }}>Page {page} of {totalPages}</div>
          <button onClick={() => setPage(p => p + 1)} disabled={!hasMore}
            style={{ padding: '10px 24px', background: !hasMore ? 'rgba(255,255,255,0.05)' : '#262626', color: !hasMore ? '#6b7280' : '#fff', border: 'none', borderRadius: '8px', cursor: !hasMore ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
