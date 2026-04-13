import React from 'react';
import { Globe } from 'lucide-react';
import { cn } from '../../ui/cn';

interface GlobalEtfMonitoring {
  symbol?: string;
  name: string;
  price?: number;
  change: number;
  signal?: 'BUY' | 'SELL' | 'HOLD';
  reason?: string;
  implication?: string;
  flow?: 'INFLOW' | 'OUTFLOW';
}

interface GlobalEtfSectionProps {
  etfs: GlobalEtfMonitoring[];
}

export const GlobalEtfSection: React.FC<GlobalEtfSectionProps> = React.memo(({ etfs }) => (
  <section>
    <div className="flex items-center gap-4 mb-8">
      <Globe className="w-6 h-6 text-indigo-400" />
      <h3 className="text-xl font-black text-white uppercase tracking-tighter">Global ETF Monitoring</h3>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {etfs.map((etf, i) => {
        const displayLabel = etf.flow ?? (etf.signal === 'BUY' ? 'INFLOW' : etf.signal === 'SELL' ? 'OUTFLOW' : etf.signal ?? '');
        const isInflow = displayLabel === 'INFLOW';
        const displayNote = etf.implication ?? etf.reason ?? '';
        const change = etf.change ?? 0;
        return (
          <div key={i} className="glass-3d p-6 rounded-[2rem] border border-white/10 hover:bg-white/[0.05] transition-all">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">{etf.symbol ?? etf.name}</span>
                {etf.symbol && <h4 className="text-sm font-black text-white truncate max-w-[120px]">{etf.name}</h4>}
              </div>
              {displayLabel && (
                <div className={cn(
                  "px-3 py-1 rounded-lg text-[10px] font-black",
                  isInflow ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                )}>
                  {displayLabel}
                </div>
              )}
            </div>
            <div className="flex items-baseline gap-2 mb-4">
              {etf.price != null && (
                <span className="text-2xl font-black text-white">${etf.price.toLocaleString()}</span>
              )}
              <span className={cn("text-xs font-bold", change >= 0 ? "text-green-400" : "text-red-400")}>
                {change >= 0 ? '+' : ''}{change}%
              </span>
            </div>
            {displayNote && (
              <p className="text-[10px] text-white/40 font-medium leading-relaxed line-clamp-2">
                {displayNote}
              </p>
            )}
          </div>
        );
      })}
    </div>
  </section>
));
