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

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <History className="w-8 h-8 text-indigo-400" />
            Master Fund History
          </h1>
          <p className="text-slate-400 mt-2">
            Complete transparency into the execution performance of the RaineBank Master Node.
          </p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-2 rounded-full flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="w-4 h-4" />
          Verified Execution
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
          <p className="text-slate-400 text-sm font-medium mb-1">Total Trades Tracked</p>
          <h2 className="text-3xl font-bold text-white">{trades.length}</h2>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
          <p className="text-slate-400 text-sm font-medium mb-1">Win Rate (Closed)</p>
          <h2 className="text-3xl font-bold text-emerald-400">
            {trades.filter(t => t.status === 'CLOSED').length > 0 
              ? Math.round((trades.filter(t => t.status === 'CLOSED' && t.is_win).length / trades.filter(t => t.status === 'CLOSED').length) * 100) 
              : 0}%
          </h2>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl">
          <p className="text-slate-400 text-sm font-medium mb-1">Active Positions</p>
          <h2 className="text-3xl font-bold text-sky-400">{trades.filter(t => t.status !== 'CLOSED').length}</h2>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/50 text-slate-400 border-b border-slate-700">
              <tr>
                <th className="px-6 py-4 font-semibold">Asset</th>
                <th className="px-6 py-4 font-semibold">Direction</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Entry Price</th>
                <th className="px-6 py-4 font-semibold">Exit Price</th>
                <th className="px-6 py-4 font-semibold text-right">Yield (Points)</th>
                <th className="px-6 py-4 font-semibold text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <Activity className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Fetching immutable ledger...
                  </td>
                </tr>
              ) : trades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    No trades executed by the Master Node yet.
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-white">{trade.symbol}</td>
                    <td className="px-6 py-4">
                      {trade.side === 'BUY' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded text-xs font-bold">
                          <ArrowUpRight className="w-3 h-3" /> BUY
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 bg-rose-400/10 px-2 py-1 rounded text-xs font-bold">
                          <ArrowDownRight className="w-3 h-3" /> SELL
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {trade.status === 'CLOSED' ? (
                        <span className="text-slate-400 font-medium">Closed</span>
                      ) : (
                        <span className="text-sky-400 font-medium flex items-center gap-1">
                          <Activity className="w-3 h-3 animate-pulse" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono">
                      {trade.entry_price?.toFixed(5) || 'Pending'}
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono">
                      {trade.close_price?.toFixed(5) || '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {trade.status === 'CLOSED' ? (
                        <span className={`font-bold ${trade.is_win ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {trade.points_yield > 0 ? '+' : ''}{trade.points_yield.toFixed(3)}
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-slate-400 text-xs">
                      {trade.closed_at 
                        ? formatDistanceToNow(new Date(trade.created_at), { addSuffix: false }) 
                        : formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}
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
