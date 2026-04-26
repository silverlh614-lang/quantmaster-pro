// @responsibility trading 영역 RecommendationStatsCard 컴포넌트
import React from 'react';
import { Activity } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import type { RecommendationStats } from '../../../api';

interface Props { stats: RecommendationStats; }

export function RecommendationStatsCard({ stats }: Props) {
  const t = stats.trades;
  const tradeCount = t?.total ?? 0;
  const recCount = stats.total ?? 0;
  if (tradeCount === 0 && recCount === 0) return null;

  const month = t?.month ?? stats.month;
  const winRate = tradeCount > 0 ? (t!.winRate ?? 0) : (stats.winRate ?? 0);
  const avgReturn = tradeCount > 0 ? (t!.avgReturnPct ?? 0) : (stats.avgReturn ?? 0);
  const displayCount = tradeCount > 0 ? tradeCount : recCount;

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-amber-400" />
        <span className="text-micro">서버 자기학습 통계 ({month})</span>
        {tradeCount > 0 && t && (
          <span className="text-micro ml-auto">
            월 누적 {t.totalRealizedPnl >= 0 ? '+' : ''}{t.totalRealizedPnl.toLocaleString()}원
            · {t.totalReturnPct >= 0 ? '+' : ''}{t.totalReturnPct.toFixed(2)}% (1억 기준)
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-center">
        <div>
          <p className="text-micro">결산 건수</p>
          <p className="text-lg font-black text-theme-text mt-1">{displayCount}</p>
        </div>
        <div>
          <p className="text-micro">WIN률</p>
          <p className="text-lg font-black text-green-400 mt-1">{winRate.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-micro">평균 수익</p>
          <p className={cn('text-lg font-black mt-1', avgReturn >= 0 ? 'text-green-400' : 'text-red-400')}>{avgReturn.toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-micro">STRONG_BUY</p>
          <p className="text-lg font-black text-amber-400 mt-1">{(stats.strongBuyWinRate ?? 0).toFixed(1)}%</p>
        </div>
      </div>
    </Card>
  );
}
