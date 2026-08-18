'use client';

import React, { useEffect, useState } from 'react';
import { Activity, Target, Clock, ArrowUpRight, ArrowDownRight, ShieldCheck, History } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

type SanitizedTrade = {
  id: string;
  symbol: string;
  side: string;
  status: string;
  entry_price: number | null;
  close_price: number | null;
  points_yield: number;
  is_win: boolean;
  created_at: string;
  closed_at: string | null;
  meta_api_order_id?: string | null;
};

export default function FundHistoryPage() {
  const [trades, setTrades] = useState<SanitizedTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch('/api/vault/fund-history');
        const data = await res.json();
        if (data.trades) {
          setTrades(data.trades);
        }
      } catch (err) {
        console.error('Failed to fetch fund history', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchHistory();
  }, []);

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
            <History size={36} color="#38bdf8" />
            Master Fund History
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '15px', marginTop: '8px' }}>
            Complete transparency into the execution performance of the RaineBank Master Node.
          </p>
        </div>
        <div style={{
          background: 'rgba(56, 189, 248, 0.1)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          padding: '8px 16px',
          borderRadius: '100px',
          fontSize: '13px',
          fontWeight: 700,
          color: '#38bdf8',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <ShieldCheck size={16} />
          VERIFIED EXECUTION
        </div>
      </div>

      {/* Stats Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px', marginBottom: '40px' }}>
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
          <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>TOTAL TRADES TRACKED</div>
          <div style={{ fontSize: '40px', fontWeight: 800, color: '#fff', letterSpacing: '-1px' }}>
            {trades.length}
          </div>
        </div>
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
          <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>WIN RATE (CLOSED)</div>
          <div style={{ fontSize: '40px', fontWeight: 800, color: '#4ade80', letterSpacing: '-1px' }}>
            {trades.filter(t => ['CLOSED', 'WON', 'LOST'].includes(t.status)).length > 0 
              ? Math.round((trades.filter(t => ['CLOSED', 'WON', 'LOST'].includes(t.status) && t.is_win).length / trades.filter(t => ['CLOSED', 'WON', 'LOST'].includes(t.status)).length) * 100) 
              : 0}%
          </div>
        </div>
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', padding: '32px', borderRadius: '24px' }}>
          <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '12px', fontWeight: 600 }}>ACTIVE POSITIONS</div>
          <div style={{ fontSize: '40px', fontWeight: 800, color: '#38bdf8', letterSpacing: '-1px' }}>
            {trades.filter(t => !['CLOSED', 'WON', 'LOST', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(t.status)).length}
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', textAlign: 'left', fontSize: '14px', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <tr>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af' }}>Asset</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af' }}>Ticket</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af' }}>Direction</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af' }}>Status</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af' }}>Entry Price</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af' }}>Exit Price</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af', textAlign: 'right' }}>Yield (Points)</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, color: '#9ca3af', textAlign: 'right' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
                    No trades executed by the Master Node yet.
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', transition: 'background 0.2s', cursor: 'default' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '16px 24px', fontWeight: 600, color: '#fff' }}>{trade.symbol}</td>
                    <td style={{ padding: '16px 24px', color: '#6b7280', fontFamily: 'monospace', fontSize: '12px' }}>
                      {trade.meta_api_order_id ? `#${trade.meta_api_order_id}` : '-'}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      {['BUY', 'LONG'].includes(trade.side) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 800 }}>
                          <ArrowUpRight size={14} /> BUY
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#f87171', background: 'rgba(248, 113, 113, 0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 800 }}>
                          <ArrowDownRight size={14} /> SELL
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      {['CLOSED', 'WON', 'LOST'].includes(trade.status) ? (
                        <span style={{ color: trade.status === 'WON' ? '#4ade80' : trade.status === 'LOST' ? '#f87171' : '#9ca3af', fontWeight: 600 }}>
                          {trade.status === 'WON' ? 'Won' : trade.status === 'LOST' ? 'Lost' : 'Closed'}
                        </span>
                      ) : ['FAILED', 'EXPIRED', 'CANCELLED'].includes(trade.status) ? (
                        <span style={{ color: '#6b7280', fontWeight: 600 }}>
                          {trade.status === 'FAILED' ? 'Failed' : trade.status === 'CANCELLED' ? 'Cancelled' : 'Expired'}
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#38bdf8', fontWeight: 600 }}>
                          <Activity size={14} /> Active
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#d1d5db', fontFamily: 'monospace', fontSize: '13px' }}>
                      {trade.entry_price ? trade.entry_price.toFixed(5) : 'Pending'}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#d1d5db', fontFamily: 'monospace', fontSize: '13px' }}>
                      {trade.close_price ? trade.close_price.toFixed(5) : (['CLOSED', 'WON', 'LOST'].includes(trade.status) ? 'N/A' : '-')}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      {['CLOSED', 'WON', 'LOST'].includes(trade.status) ? (
                        <span style={{ fontWeight: 800, color: trade.is_win ? '#4ade80' : (trade.status === 'CLOSED' && trade.points_yield === 0 ? '#9ca3af' : '#f87171') }}>
                          {trade.points_yield > 0 ? '+' : ''}{trade.points_yield ? trade.points_yield.toFixed(3) : '0.000'}
                        </span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right', color: '#9ca3af', fontSize: '12px' }}>
                      {trade.closed_at 
                        ? formatDistanceToNow(new Date(trade.closed_at)) + ' ago'
                        : formatDistanceToNow(new Date(trade.created_at)) + ' elapsed'
                      }
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
