// @responsibility sector 영역 SectorRotationPanel 컴포넌트
/**
 * Idea 4: Sector Rotation Heat Bar (Side Panel)
 * Shows sector strength as horizontal bar chart with color-coded intensity.
 */
import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../ui/cn';
import { useRecommendationStore } from '../../stores';

interface SectorStrength {
  name: string;
  strength: number; // -100 to 100
  stockCount: number;
}

export function SectorRotationPanel() {
  const { recommendations } = useRecommendationStore();

  // Compute sector strengths from recommendations
  const sectorMap = new Map<string, { total: number; count: number }>();
  (recommendations || []).forEach((stock) => {
    const sectors = stock.relatedSectors || [];
    sectors.forEach((sector: string) => {
      const existing = sectorMap.get(sector) || { total: 0, count: 0 };
      // Use conviction score or gate score as strength proxy
      const score = stock.aiConvictionScore?.totalScore ?? stock.confidenceScore ?? 50;
      const direction = (stock.type === 'STRONG_BUY' || stock.type === 'BUY') ? 1 : (stock.type === 'SELL' || stock.type === 'STRONG_SELL') ? -1 : 0;
      existing.total += score * (direction || 0.5);
      existing.count += 1;
      sectorMap.set(sector, existing);
    });
  });

  const sectors: SectorStrength[] = Array.from(sectorMap.entries())
    .map(([name, { total, count }]) => ({
      name,
      strength: Math.round(total / count),
      stockCount: count,
    }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10);

  if (sectors.length === 0) return null;

  const maxAbs = Math.max(...sectors.map(s => Math.abs(s.strength)), 1);

  return (
    <div className="glass-3d rounded-2xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-4 rounded-full bg-orange-500" />
        <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-[0.2em]">
          섹터 로테이션
        </span>
      </div>

      <div className="space-y-2.5">
        {sectors.map((sector) => {
          const isPositive = sector.strength >= 0;
          const barWidth = Math.max(Math.abs(sector.strength) / maxAbs * 100, 8);
          return (
            <div key={sector.name} className="group/sector">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-theme-text-secondary truncate max-w-[120px]">
                  {sector.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black text-theme-text-muted font-num">
                    {sector.stockCount}종목
                  </span>
                  <span className={cn(
                    'text-[10px] font-black font-num',
                    isPositive ? 'text-green-400' : 'text-red-400'
                  )}>
                    {isPositive ? '+' : ''}{sector.strength}
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div
                  className={cn(
                    'sector-bar h-full rounded-full',
                    isPositive
                      ? 'bg-gradient-to-r from-green-500/60 to-green-400'
                      : 'bg-gradient-to-r from-red-400 to-red-500/60'
                  )}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
