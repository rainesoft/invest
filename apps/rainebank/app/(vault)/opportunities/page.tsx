'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import toast from 'react-hot-toast';

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
  status: string;
};

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

export default function Page() {
  const client = supabase;
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);

  // Pagination State
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = client
        .from('trade_opportunities')
        .select('id, symbol, side, timeframe, created_at, entry_plan_json, stop_plan_json, take_profit_json, ai_summary, status', { count: 'exact' })
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (!showWarnings) {
        query = query.eq('status', 'PUBLISHED');
      } else {
        query = query.or('status.eq.PUBLISHED,and(status.eq.REJECTED,ai_risks.eq.Rejected by AI Risk Officer)');
      }

      const { data, count } = await query;

      setOpps(data ?? []);
      setHasMore(count ? (from + pageSize) < count : false);
      setLoading(false);
    };
    load();
  }, [client, page, showWarnings]);



  if (loading) {
    return <div style={{ color: '#9ca3af', fontSize: '15px' }}>Loading signals...</div>;
  }

  const handleExecute = async (id: string) => {
    setProcessing(id);
    try {
      const res = await fetch(`/api/opportunities/${id}/execute`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execution failed');
      
      toast.success('Trade executed successfully!');
      // Optimistically update status so the user knows they executed it
      setOpps(prev => prev.map(o => o.id === id ? { ...o, status: 'EXECUTED' } : o));
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', margin: 0 }}>
          Published AI Signals
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 600 }}>Show C-Tier Signals</span>
          <div
            onClick={() => {
              setPage(1);
              setShowWarnings(!showWarnings);
            }}
            style={{
              width: '44px',
              height: '24px',
              background: showWarnings ? '#f87171' : '#374151',
              borderRadius: '9999px',
              position: 'relative',
              cursor: 'pointer',
              transition: 'background 0.2s ease-in-out'
            }}
          >
            <div style={{
              position: 'absolute',
              top: '2px',
              left: showWarnings ? '22px' : '2px',
              width: '20px',
              height: '20px',
              background: '#fff',
              borderRadius: '50%',
              transition: 'left 0.2s ease-in-out',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }} />
          </div>
        </div>
      </div>
      
      {opps.length === 0 && <p style={{ color: '#9ca3af' }}>No pending opportunities.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {opps.map((signal) => {
          const entryPrice = signal.entry_plan_json?.price || signal.entry_plan_json?.limit_price;
          const stopPrice = signal.stop_plan_json?.stop || signal.stop_plan_json?.stop_price;
          const tpPrice = signal.take_profit_json?.tp || signal.take_profit_json?.tp_price;
          const isProcessing = processing === signal.id;
          const isWarning = signal.status === 'REJECTED';

          return (
            <div key={signal.id} style={{
              background: '#0a0a0a',
              border: `1px solid ${isWarning ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.05)'}`,
              padding: '32px',
              borderRadius: '24px',
              transition: 'transform 0.2s, box-shadow 0.2s',
              opacity: isProcessing ? 0.5 : 1,
              pointerEvents: isProcessing ? 'none' : 'auto'
            }}
            onMouseOver={(e) => {
              if (isProcessing) return;
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.4)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
            }}
            onMouseOut={(e) => {
              if (isProcessing) return;
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
            }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }}>{signal.symbol}</div>
                  <div style={{
                    background: signal.side === 'LONG' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                    color: signal.side === 'LONG' ? '#4ade80' : '#f87171',
                    padding: '4px 12px',
                    borderRadius: '100px',
                    fontSize: '12px',
                    fontWeight: 800
                  }}>
                    {signal.side}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 600 }}>{signal.timeframe}</div>
                </div>
                <div style={{ color: '#6b7280', fontSize: '13px', fontWeight: 500 }}>
                  {new Date(signal.created_at).toLocaleString()}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: '#111', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>ENTRY</div>
                  {entryPrice ? (
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#e5e7eb' }}>{entryPrice}</div>
                  ) : (
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#6b7280' }}>—</div>
                  )}
                </div>
                <div style={{ background: '#111', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>STOP LOSS</div>
                  {stopPrice ? (
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171' }}>{stopPrice}</div>
                  ) : (
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#6b7280' }}>—</div>
                  )}
                </div>
                <div style={{ background: '#111', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>TAKE PROFIT</div>
                  {tpPrice ? (
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#4ade80' }}>{tpPrice}</div>
                  ) : (
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#6b7280' }}>—</div>
                  )}
                </div>
              </div>

              <div style={{ background: isWarning ? 'rgba(248,113,113,0.05)' : 'rgba(37,99,235,0.05)', padding: '20px', borderRadius: '16px', border: `1px solid ${isWarning ? 'rgba(248,113,113,0.2)' : 'rgba(37,99,235,0.1)'}`, marginBottom: '24px' }}>
                <div style={{ fontSize: '12px', color: isWarning ? '#f87171' : '#38bdf8', marginBottom: '12px', fontWeight: 700 }}>
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

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '24px' }}>
                {signal.status === 'PUBLISHED' ? (
                  <button 
                    onClick={() => handleExecute(signal.id)}
                    disabled={processing === signal.id}
                    style={{
                      background: signal.side === 'LONG' ? '#10b981' : '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 24px',
                      fontSize: '14px',
                      fontWeight: 700,
                      cursor: processing === signal.id ? 'not-allowed' : 'pointer',
                      opacity: processing === signal.id ? 0.7 : 1,
                      transition: 'opacity 0.2s'
                    }}
                  >
                    {processing === signal.id ? 'Executing...' : `Execute ${signal.side}`}
                  </button>
                ) : (
                  <div style={{ color: signal.status === 'APPROVED' ? '#10b981' : '#9ca3af', fontSize: '13px', fontWeight: 600 }}>
                    Status: {signal.status}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!(page === 1 && !hasMore) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '32px' }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: '10px 24px',
              background: page === 1 ? 'rgba(255,255,255,0.05)' : '#262626',
              color: page === 1 ? '#6b7280' : '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: page === 1 ? 'not-allowed' : 'pointer',
              fontWeight: 600
            }}
          >
            Previous
          </button>
          <div style={{ color: '#9ca3af', fontSize: '14px' }}>Page {page}</div>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            style={{
              padding: '10px 24px',
              background: !hasMore ? 'rgba(255,255,255,0.05)' : '#262626',
              color: !hasMore ? '#6b7280' : '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: !hasMore ? 'not-allowed' : 'pointer',
              fontWeight: 600
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

