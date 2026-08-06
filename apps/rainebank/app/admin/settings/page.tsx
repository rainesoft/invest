'use client';

import { useEffect, useState } from 'react';
import { getTradingSymbolsAction, updateTradingSymbolsAction } from './actions';
import { Settings, Save, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

const AVAILABLE_SYMBOLS = [
  { group: 'Forex', symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD', 'EURJPY', 'GBPJPY'] },
  { group: 'Metals & Commodities', symbols: ['XAUUSD', 'XAGUSD', 'UKOIL'] },
  { group: 'Indices', symbols: ['US30', 'NAS100'] },
  { group: 'Crypto', symbols: ['BTCUSD'] }
];

export default function AdminSettingsPage() {
  const [activeSymbols, setActiveSymbols] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    async function load() {
      const symbols = await getTradingSymbolsAction();
      setActiveSymbols(symbols);
      setIsLoading(false);
    }
    load();
  }, []);

  const toggleSymbol = (symbol: string) => {
    setActiveSymbols(prev => 
      prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    const { success, error } = await updateTradingSymbolsAction(activeSymbols);
    setIsSaving(false);
    
    if (success) {
      setMessage({ text: 'Trading symbols updated successfully!', type: 'success' });
      setTimeout(() => setMessage(null), 3000);
    } else {
      setMessage({ text: error || 'Failed to update', type: 'error' });
    }
  };

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="relative bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl shadow-2xl">
        
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              <Settings size={24} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Active Trading Symbols</h2>
              <p className="text-gray-400 text-sm">Toggle the assets that the AI trading agents are allowed to analyze and execute.</p>
            </div>
          </div>
          
          <button 
            onClick={handleSave}
            disabled={isLoading || isSaving}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-5 py-2.5 rounded-lg font-medium transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            Save Configuration
          </button>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
            {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span className="font-medium text-sm">{message.text}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={32} className="text-purple-400 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {AVAILABLE_SYMBOLS.map((group) => (
              <div key={group.group} className="bg-black/20 p-5 rounded-xl border border-white/5">
                <h3 className="text-gray-300 font-semibold mb-4 border-b border-white/10 pb-2">{group.group}</h3>
                <div className="flex flex-col gap-3">
                  {group.symbols.map(symbol => {
                    const isActive = activeSymbols.includes(symbol);
                    return (
                      <label 
                        key={symbol} 
                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border ${
                          isActive 
                            ? 'bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20' 
                            : 'bg-white/5 border-transparent hover:bg-white/10'
                        }`}
                      >
                        <span className={`font-medium ${isActive ? 'text-purple-300' : 'text-gray-400'}`}>
                          {symbol}
                        </span>
                        <div className={`w-10 h-5 rounded-full relative transition-colors ${isActive ? 'bg-purple-500' : 'bg-gray-600'}`}>
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        
      </div>
    </div>
  );
}
