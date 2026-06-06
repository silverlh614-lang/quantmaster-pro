// @responsibility analysis 영역 MarketPositionSection 컴포넌트
import React from 'react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';
import { formatMarketCapJoWon } from '../../../utils/marketCapFormat';

interface Props {
  stock: StockRecommendation;
}

// 시가총액 분류 표시 — 전역 toKoLabel 의 MID='중기'(사이클)와 충돌하므로 여기선 MID='중형'.
const MARKET_CAP_LABEL: Record<string, string> = { LARGE: '대형', MID: '중형', SMALL: '소형' };

export function MarketPositionSection({ stock }: Props) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-3 px-1">
        <div className="w-1 h-5 bg-blue-500 rounded-full" />
        <h3 className="text-base font-black text-white uppercase tracking-tighter">시장 위치</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 tracking-tight mb-1.5">모멘텀 순위</span>
          <span className="text-2xl font-black text-blue-400">#{stock.momentumRank}</span>
          <span className="text-[9px] font-bold text-white/40 mt-0.5">상위 {Math.round((stock.momentumRank / 2500) * 100)}%</span>
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 tracking-tight mb-1.5">수급 품질</span>
          <div className="flex gap-1.5">
            <div className={cn("px-2 py-0.5 rounded text-[9px] font-black border",
              stock.supplyQuality?.active ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-white/20 border-white/[0.07]")}>
              액티브
            </div>
            <div className={cn("px-2 py-0.5 rounded text-[9px] font-black border",
              stock.supplyQuality?.passive ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-white/5 text-white/20 border-white/[0.07]")}>
              패시브
            </div>
          </div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 tracking-tight mb-1.5">섹터 상태</span>
          <span className={cn("text-xs font-black", stock.isLeadingSector ? "text-orange-400" : "text-white/40")}>
            {stock.isLeadingSector ? "주도" : "후순위"}
          </span>
          <span className="text-[9px] font-bold text-white/25 tracking-tight mt-0.5">
            {stock.isPreviousLeader ? "기존 주도주" : "신규 후보"}
          </span>
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 tracking-tight mb-1.5">고점 대비</span>
          {(() => {
            // peakPrice 미확보(0)·현재가 미만 등 비정상값이면 '—' 로 표기.
            // (직전엔 peakPrice 0 → ₩0 + (1 - 가격/1)*100 = --72299900% 깨짐)
            const peak = stock.peakPrice;
            const valid = typeof peak === 'number' && peak > 0 && stock.currentPrice > 0 && peak >= stock.currentPrice;
            const pct = valid ? Math.round((1 - stock.currentPrice / peak) * 100) : null;
            return (
              <>
                <span className="text-base font-black text-white">{valid ? `₩${peak.toLocaleString()}` : '—'}</span>
                <span className="text-[10px] font-black text-red-400 mt-0.5">
                  {valid ? `-${pct}%` : '데이터 없음'}
                </span>
              </>
            );
          })()}
        </div>

        <div className="bg-white/5 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center justify-center text-center">
          <span className="text-[9px] font-black text-white/25 tracking-tight mb-1.5">시가총액</span>
          <span className="text-sm font-black text-white">{MARKET_CAP_LABEL[stock.marketCapCategory ?? ''] ?? stock.marketCapCategory ?? '-'} 시총</span>
          <span className="text-[9px] font-bold text-white/40 mt-0.5">{formatMarketCapJoWon(stock.marketCap)}</span>
        </div>
      </div>
    </div>
  );
}
