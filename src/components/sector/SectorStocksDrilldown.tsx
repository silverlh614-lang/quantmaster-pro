// @responsibility 섹터별 종목 드릴다운 모달 (PR-K)

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useRecommendationStore } from '../../stores';
import { filterStocksBySector } from '../../utils/sectorStockMatch';
import { classifySectorHeat, SECTOR_HEAT_CSS } from '../../utils/sectorHeatColor';

interface SectorStocksDrilldownProps {
  sectorName: string;
  /** 해당 섹터의 정규 점수 0~100 (히트맵 chip 의 score). */
  score?: number;
  onClose: () => void;
}

export function SectorStocksDrilldown({ sectorName, score, onClose }: SectorStocksDrilldownProps) {
  const recommendations = useRecommendationStore(s => s.recommendations);
  const watchlist = useRecommendationStore(s => s.watchlist);

  // 추천 + 워치리스트 통합 (filterStocksBySector 가 dedupe 처리)
  const merged = [...recommendations, ...watchlist];
  const matched = filterStocksBySector(merged, sectorName);
  const tone = score != null ? classifySectorHeat(score) : 'COLD';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-label={`${sectorName} 섹터 종목 드릴다운`}
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-white/10 rounded-xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded border', SECTOR_HEAT_CSS[tone])}>
              {score != null ? Math.round(score) : '—'}
            </span>
            <h2 className="text-base font-black">{sectorName}</h2>
            <span className="text-[10px] text-white/50">
              {matched.length} 종목
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {matched.length === 0 ? (
            <p className="text-xs opacity-60">
              관심·추천 종목 중 "{sectorName}" 섹터에 속한 종목이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {matched.map(stock => (
                <li key={stock.code} className="flex items-center justify-between py-2 text-[12px]">
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold truncate">{stock.name}</span>
                      <span className="text-white/40 text-[10px] font-num shrink-0">{stock.code}</span>
                    </div>
                    {stock.relatedSectors && stock.relatedSectors.length > 0 && (
                      <span className="text-[9px] text-white/50 truncate">
                        {stock.relatedSectors.join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {typeof stock.currentPrice === 'number' && stock.currentPrice > 0 && (
                      <span className="font-num text-white/80">
                        {stock.currentPrice.toLocaleString('ko-KR')}
                      </span>
                    )}
                    <span className={cn(
                      'text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap',
                      stock.type === 'STRONG_BUY' ? 'bg-violet-500/20 border-violet-500/40 text-violet-200' :
                      stock.type === 'BUY' ? 'bg-green-500/20 border-green-500/40 text-green-200' :
                      stock.type === 'STRONG_SELL' || stock.type === 'SELL' ? 'bg-red-500/20 border-red-500/40 text-red-200' :
                      'bg-white/5 border-white/10 text-white/60',
                    )}>
                      {stock.type}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
