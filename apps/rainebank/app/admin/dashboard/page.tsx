import { fetchLiveTrades, fetchMacroSentiment, fetchSystemHealth } from './actions';
import { Activity, AlertTriangle, TrendingUp, ShieldAlert, BarChart3, Clock, DollarSign, Target, CheckCircle2 } from 'lucide-react';
import SignalsTab from '@components/SignalsTab';

export const revalidate = 0; // Ensure fresh data on every load

export default async function AdminDashboardPage() {
  const [liveTrades, macroSentiment, systemHealth] = await Promise.all([
    fetchLiveTrades(),
    fetchMacroSentiment(),
    fetchSystemHealth()
  ]);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      
      {/* Top Level System Health & Macro Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Drawdown Monitor */}
        <div className="relative bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl overflow-hidden group hover:border-red-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl -mr-16 -mt-16 transition-opacity group-hover:opacity-100 opacity-50"></div>
          <div className="flex items-center gap-3 mb-2 relative">
            <div className="p-2.5 bg-red-500/10 rounded-xl border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
              <ShieldAlert size={20} className="text-red-400" />
            </div>
            <h3 className="text-gray-400 text-sm font-medium tracking-wide uppercase">Master Daily Drawdown</h3>
          </div>
          <div className="flex items-end gap-2 mt-6 relative">
            <span className={`text-4xl font-bold tracking-tight leading-none ${systemHealth?.daily_drawdown && systemHealth.daily_drawdown > 4 ? 'text-red-400' : 'text-white'}`}>
              {systemHealth?.daily_drawdown?.toFixed(2) || 0}%
            </span>
            <span className="text-sm text-gray-500 mb-1 font-medium">/ 5.0% Limit</span>
          </div>
          <div className="w-full bg-black/40 rounded-full h-2 mt-6 p-0.5 border border-white/5 relative">
            <div 
              className={`h-full rounded-full transition-all duration-1000 shadow-lg ${systemHealth?.daily_drawdown && systemHealth.daily_drawdown > 4 ? 'bg-gradient-to-r from-red-500 to-red-400 shadow-red-500/50' : 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-emerald-500/50'}`}
              style={{ width: `${Math.min(100, (systemHealth?.daily_drawdown || 0) / 5 * 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Global Macro Sentiment */}
        <div className="relative bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl overflow-hidden group hover:border-blue-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-16 -mt-16 transition-opacity group-hover:opacity-100 opacity-50"></div>
          <div className="flex items-center gap-3 mb-2 relative">
            <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
              <Activity size={20} className="text-blue-400" />
            </div>
            <h3 className="text-gray-400 text-sm font-medium tracking-wide uppercase">Macro Sentiment</h3>
          </div>
          <div className="mt-5 flex flex-col gap-3 relative">
            {macroSentiment.slice(0,2).map((snap: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center bg-black/40 p-3 rounded-xl border border-white/5 hover:bg-white/5 transition-colors">
                <span className="text-white font-semibold tracking-tight">{snap.symbol}</span>
                <div className="flex items-center gap-3">
                   <span className={`text-xs font-bold px-2.5 py-1 rounded-md shadow-sm ${snap.macro_bias === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/20 text-red-400 border border-red-500/20'}`}>
                      {snap.macro_bias}
                   </span>
                   <span className="text-gray-400 text-xs truncate max-w-[120px] font-medium">{snap.narrative?.split('.')[0]}</span>
                </div>
              </div>
            ))}
            {macroSentiment.length === 0 && <span className="text-sm text-gray-500 py-2">No snapshot data available</span>}
          </div>
        </div>
        
        {/* Active Capital Allocation */}
        <div className="relative bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl overflow-hidden group hover:border-emerald-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-16 -mt-16 transition-opacity group-hover:opacity-100 opacity-50"></div>
          <div className="flex items-center gap-3 mb-2 relative">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <DollarSign size={20} className="text-emerald-400" />
            </div>
            <h3 className="text-gray-400 text-sm font-medium tracking-wide uppercase">Total Open Risk</h3>
          </div>
          <div className="flex items-end gap-2 mt-6 relative">
            <span className="text-4xl font-bold tracking-tight text-white leading-none">
              ${liveTrades.reduce((acc: number, t: any) => acc + (t.risk_amount || 0), 0).toFixed(2)}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-4 font-medium relative">Currently deployed across <span className="text-white font-bold">{liveTrades.length}</span> open positions</p>
        </div>
      </div>

      {/* Combined Executions & Signals Tab */}
      <div className="mt-4">
        <SignalsTab liveTrades={liveTrades} />
      </div>
      
    </div>
  );
}
