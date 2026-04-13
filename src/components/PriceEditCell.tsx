import React, { useState } from 'react';
import { Check, X, RefreshCw, Edit2 } from 'lucide-react';
import { cn } from '../ui/cn';

interface PriceEditCellProps {
  stockCode: string;
  currentPrice: number;
  syncingStock: string | null;
  onManualUpdate: (newPrice: number) => void;
  onSync: () => void;
}

export const PriceEditCell: React.FC<PriceEditCellProps> = ({
  stockCode,
  currentPrice,
  syncingStock,
  onManualUpdate,
  onSync,
}) => {
  const [editing, setEditing] = useState(false);
  const [priceInput, setPriceInput] = useState('');

  const startEditing = () => {
    setEditing(true);
    setPriceInput(currentPrice?.toString() || '');
  };

  const submitPrice = () => {
    onManualUpdate(Number(priceInput));
    setEditing(false);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          className="w-20 sm:w-24 px-2 py-0.5 bg-white/10 border border-white/20 rounded text-xs sm:text-sm text-white focus:outline-none focus:border-orange-500"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitPrice();
            if (e.key === 'Escape') cancelEditing();
          }}
        />
        <button
          onClick={submitPrice}
          className="p-1 hover:bg-green-500/20 rounded transition-colors"
        >
          <Check className="w-3 h-3 text-green-400" />
        </button>
        <button
          onClick={cancelEditing}
          className="p-1 hover:bg-red-500/20 rounded transition-colors"
        >
          <X className="w-3 h-3 text-red-400" />
        </button>
      </div>
    );
  }

  return (
    <>
      <span className="text-sm sm:text-base font-black text-white tracking-tighter">₩{currentPrice?.toLocaleString()}</span>
      <div className="flex items-center gap-1 ml-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSync();
          }}
          disabled={syncingStock === stockCode}
          className={cn(
            "p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all active:scale-90",
            syncingStock === stockCode && "animate-spin opacity-50"
          )}
          title="현재가, 최신 뉴스 및 전략 동기화"
        >
          <RefreshCw className="w-3 h-3 text-white" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            startEditing();
          }}
          className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all active:scale-90"
          title="가격 수동 수정"
        >
          <Edit2 className="w-3 h-3 text-white/60 hover:text-white" />
        </button>
      </div>
    </>
  );
};
