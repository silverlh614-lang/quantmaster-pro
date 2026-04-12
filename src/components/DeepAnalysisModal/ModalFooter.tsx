import React from 'react';
import { X, Star, Globe, Clock } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { StockRecommendation } from '../../services/stockService';

interface ModalFooterProps {
  stock: StockRecommendation;
  onClose: () => void;
  watchlist: StockRecommendation[];
  setWatchlist: (list: StockRecommendation[]) => void;
}

export function ModalFooter({ stock, onClose, watchlist, setWatchlist }: ModalFooterProps) {
  const isWatchlisted = (watchlist || []).some(s => s.code === stock.code);

  return (
    <div className="p-4 border-t border-white/10 bg-white/5 flex flex-col items-center gap-4">
      <div className="flex items-center justify-center gap-6">
        <button
          onClick={() => onClose()}
          className="px-8 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/60 font-black text-sm transition-all border border-white/10 flex items-center gap-2"
        >
          <X className="w-4 h-4" />
          Close Analysis
        </button>
        <button
          onClick={() => {
            const currentWatchlist = watchlist || [];
            if (isWatchlisted) {
              setWatchlist(currentWatchlist.filter(s => s.code !== stock.code));
            } else {
              setWatchlist([...currentWatchlist, stock]);
            }
          }}
          className={cn(
            "px-8 py-3 rounded-2xl font-black text-sm transition-all flex items-center gap-2",
            isWatchlisted
              ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
              : "bg-orange-500 text-white shadow-[0_10px_20px_rgba(249,115,22,0.2)] hover:bg-orange-600"
          )}
        >
          <Star className={cn("w-4 h-4", isWatchlisted && "fill-red-400")} />
          {isWatchlisted ? 'Remove from Watchlist' : 'Add to Watchlist'}
        </button>
      </div>

      <div className="flex items-center gap-4 text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">
        <div className="flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          <span>Data Source: {stock.dataSource || 'Institutional Feeds'}</span>
        </div>
        <div className="w-1 h-1 rounded-full bg-white/10" />
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          <span>Last Updated: {stock.priceUpdatedAt || new Date().toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
