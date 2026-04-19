import React from 'react';
import { X, Star, Globe, Clock } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';

interface ModalFooterProps {
  stock: StockRecommendation;
  onClose: () => void;
  watchlist: StockRecommendation[];
  setWatchlist: (list: StockRecommendation[]) => void;
}

export function ModalFooter({ stock, onClose, watchlist, setWatchlist }: ModalFooterProps) {
  const isWatchlisted = (watchlist || []).some(s => s.code === stock.code);

  return (
    <div className="px-4 py-3 border-t border-white/10 bg-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="flex items-center gap-3 text-[9px] font-black text-white/20 uppercase tracking-[0.18em] order-2 sm:order-1 flex-wrap justify-center">
        <div className="flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          <span>Source: {stock.dataSource || 'Institutional Feeds'}</span>
        </div>
        <div className="w-1 h-1 rounded-full bg-white/10" />
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          <span>Updated: {stock.priceUpdatedAt || new Date().toLocaleString()}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 order-1 sm:order-2">
        <button
          onClick={() => onClose()}
          className="px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 font-black text-xs transition-all border border-white/10 flex items-center gap-1.5"
        >
          <X className="w-3.5 h-3.5" />
          Close
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
            "px-5 py-2 rounded-xl font-black text-xs transition-all flex items-center gap-1.5",
            isWatchlisted
              ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
              : "bg-orange-500 text-white shadow-lg shadow-orange-500/20 hover:bg-orange-600"
          )}
        >
          <Star className={cn("w-3.5 h-3.5", isWatchlisted && "fill-red-400")} />
          {isWatchlisted ? 'Remove' : 'Add to Watchlist'}
        </button>
      </div>
    </div>
  );
}
