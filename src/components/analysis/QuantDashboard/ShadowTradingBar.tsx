import React from 'react';
import { PlayCircle } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
  stockCode?: string;
  stockName?: string;
  currentPrice?: number;
  onShadowTrade?: (stockCode: string, stockName: string, currentPrice: number) => void;
}

export function ShadowTradingBar({ result, stockCode, stockName, currentPrice, onShadowTrade }: Props) {
  if (!stockCode || !stockName || !currentPrice || currentPrice <= 0) return null;

  return (
    <div className="mb-12 p-6 border-2 border-dashed border-violet-400 bg-violet-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <p className="text-[10px] font-black text-violet-500 uppercase tracking-widest mb-1">SHADOW TRADING</p>
        <p className="text-sm font-bold text-theme-text">
          {stockName} ({stockCode}) — {currentPrice.toLocaleString()}원
        </p>
        <p className="text-[10px] text-gray-500 mt-1">
          {result.recommendation === '풀 포지션' || result.recommendation === '절반 포지션'
            ? 'Kelly ' + result.positionSize + '% · RRR ' + result.rrr.toFixed(1) + ' — 신호 조건 충족'
            : '관망/매도 신호 — Shadow 기록만 가능'}
        </p>
      </div>
      <button
        onClick={() => onShadowTrade?.(stockCode, stockName, currentPrice)}
        disabled={!onShadowTrade}
        className={cn(
          'flex items-center gap-2 px-6 py-3 font-black text-sm uppercase tracking-widest border-2 transition-all',
          onShadowTrade
            ? 'border-violet-500 bg-violet-500 text-white hover:bg-violet-600 active:scale-95'
            : 'border-gray-300 bg-gray-200 text-gray-400 cursor-not-allowed'
        )}
      >
        <PlayCircle className="w-4 h-4" />
        모의계좌 실행 / Shadow 기록
      </button>
    </div>
  );
}
