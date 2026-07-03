'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import toast from 'react-hot-toast';

type Opportunity = {
  id: string;
  symbol: string;
  order_type: string;
  entry_price: number;
  take_profit: number;
  stop_loss: number;
  expected_profit: number;
  expected_loss: number;
};

type Rejection = {
  symbol: string;
  reason: string;
  layer: string;
  rationale?: string;
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

function getSymbolName(symbol: string) {
  const base = symbol.replace(/[mcz_]+$/, '').toUpperCase();
  const map: Record<string, string> = {
    'XAUUSD': 'Gold vs US Dollar',
    'XAGUSD': 'Silver vs US Dollar',
    'BTCUSD': 'Bitcoin',
    'ETHUSD': 'Ethereum',
    'UKOIL': 'Brent Crude Oil',
    'USOIL': 'WTI Crude Oil',
    'EURUSD': 'Euro vs US Dollar',
    'GBPUSD': 'British Pound vs US Dollar'
  };
  return map[base] || symbol;
}

export default function ResearchPage() {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('4H');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<Opportunity[] | null>(null);
  const [rejections, setRejections] = useState<Rejection[] | null>(null);
  const [progressLogs, setProgressLogs] = useState<string[]>([]);

  const commonSymbols = ['XAUUSD', 'XAGUSD', 'BTCUSD', 'UKOIL'];

  const handleRunAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol) return;

    setIsLoading(true);
    setResults(null);
    setRejections(null);
    setProgressLogs([]);

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.toUpperCase(), timeframe })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to run analysis');
      }

      if (!res.body) throw new Error("No readable stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (!dataStr) continue;

            try {
              const eventData = JSON.parse(dataStr);
              if (eventData.type === 'progress') {
                setProgressLogs(prev => [...prev, eventData.message]);
              } else if (eventData.type === 'complete') {
                setResults(eventData.opportunities || []);
                setRejections(eventData.rejections || []);
              } else if (eventData.type === 'error') {
                throw new Error(eventData.message);
              }
            } catch (e) {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred during analysis');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>

      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, color: '#fff', marginBottom: '8px', letterSpacing: '-1px' }}>
          Intelligence Desk
        </h1>
        <p style={{ color: '#9ca3af', fontSize: '16px' }}>
          Manually trigger the Alpha engine to analyze specific assets.
        </p>
      </div>

      <div style={{
        background: '#111',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '24px',
        padding: '32px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)'
      }}>
        <form onSubmit={handleRunAnalysis} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1', minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>
              ASSET SYMBOL
            </label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              style={{
                width: '100%',
                background: '#000',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '12px 16px',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '16px',
                outline: 'none',
                appearance: 'none',
              }}
            >
              {commonSymbols.map(sym => <option key={sym} value={sym}>{getSymbolName(sym)}</option>)}
            </select>
          </div>

          <div style={{ width: '120px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>
              TIMEFRAME
            </label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              style={{
                width: '100%',
                background: '#000',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '12px 16px',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '16px',
                outline: 'none',
                appearance: 'none',
              }}
            >
              <option value="30Min">30 Minutes</option>
              <option value="1H">Hourly</option>
              <option value="4H">4 Hours</option>
              <option value="1D">Daily</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isLoading || !symbol}
            style={{
              background: isLoading ? '#374151' : '#fff',
              color: isLoading ? '#9ca3af' : '#000',
              border: 'none',
              padding: '14px 32px',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: isLoading || !symbol ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              height: '47px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '160px'
            }}
          >
            {isLoading ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </form>
      </div>

      {isLoading && progressLogs.length > 0 && (
        <div style={{
          background: '#0a0a0a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px',
          padding: '24px',
          fontFamily: 'monospace',
          color: '#4ade80',
          fontSize: '14px',
          lineHeight: '1.6',
          boxShadow: 'inset 0 0 32px rgba(0,0,0,0.5)',
          minHeight: '120px'
        }}>
          {progressLogs.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: '12px' }}>
              <span style={{ color: '#6b7280' }}>[{new Date().toISOString().split('T')[1].split('.')[0]}]</span>
              <span>{log}</span>
            </div>
          ))}
          <div style={{ animation: 'blink 1s infinite' }}>_</div>
          <style>{`
            @keyframes blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {results && results.length === 0 && (!rejections || rejections.length === 0) && (
        <div style={{ textAlign: 'center', padding: '48px', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '24px', color: '#9ca3af' }}>
          Analysis completed. No actionable setups found for {symbol.toUpperCase()} at this time.
        </div>
      )}

      {results && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px' }}>
            Actionable Setups
          </h2>

          {results.map((opp, idx) => (
            <div key={idx} style={{
              background: 'linear-gradient(145deg, rgba(30,30,30,0.8) 0%, rgba(15,15,15,0.8) 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '24px',
              padding: '32px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 600 }}>LIVE SIGNAL</div>
                <div style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>VALID SETUP</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '48px', fontWeight: 800, color: '#fff', letterSpacing: '-1px' }}>{getSymbolName(opp.symbol)}</div>
                  <div style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600, letterSpacing: '1px' }}>{opp.symbol}</div>
                </div>
                <div style={{ fontSize: '24px', color: opp.order_type.includes('BUY') ? '#4ade80' : '#ef4444', fontWeight: 600 }}>
                  {opp.order_type} @ {opp.entry_price.toFixed(4)}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '24px', margin: '32px 0' }}>
                <div style={{ flex: 1, background: '#0a0a0a', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>TAKE PROFIT</div>
                  <div style={{ fontSize: '20px', color: '#fff', fontWeight: 700 }}>{opp.take_profit.toFixed(4)}</div>
                </div>
                <div style={{ flex: 1, background: '#0a0a0a', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px', fontWeight: 600 }}>STOP LOSS</div>
                  <div style={{ fontSize: '20px', color: '#fff', fontWeight: 700 }}>{opp.stop_loss.toFixed(4)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Link 
                  href="/opportunities"
                  style={{
                    background: '#fff',
                    color: '#000',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-block',
                    transition: 'opacity 0.2s'
                  }}
                >
                  View Signal →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {rejections && rejections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px', marginTop: '16px' }}>
            Analysis Ledger (Rejected Setups)
          </h2>

          {rejections.map((rej, idx) => (
            <div key={idx} style={{
              background: 'rgba(20, 20, 20, 0.8)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '24px',
              padding: '32px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 600 }}>ANALYSIS RESULT</div>
                <div style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>REJECTED - LAYER {rej.layer}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '16px' }}>
                <div style={{ fontSize: '32px', fontWeight: 800, color: '#fff', letterSpacing: '-1px' }}>{getSymbolName(rej.symbol)}</div>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600, letterSpacing: '1px' }}>{rej.symbol}</div>
              </div>

              <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>REASON</div>
                <TrendBadge {...parseAnalysisText(rej.reason)} />
                <p style={{ fontSize: '15px', color: '#e5e7eb', lineHeight: 1.5, margin: 0 }}>
                  {parseAnalysisText(rej.reason).content}
                </p>
                {rej.rationale && (
                  <>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '16px', marginBottom: '12px', fontWeight: 600 }}>INSTITUTIONAL RATIONALE</div>
                    <TrendBadge {...parseAnalysisText(rej.rationale)} />
                    <p style={{ fontSize: '15px', color: '#e5e7eb', lineHeight: 1.5, margin: 0 }}>
                      {parseAnalysisText(rej.rationale).content}
                    </p>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
