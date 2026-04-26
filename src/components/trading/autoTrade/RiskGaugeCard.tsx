// @responsibility trading 영역 RiskGaugeCard 컴포넌트
import React from 'react';
import { Shield } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';

export interface RiskGauge {
  exposureRate: number;
  cashRate: number;
  maxLoss: number;
}

interface Props {
  gauge: RiskGauge;
  totalAsset: number;
}

export function RiskGaugeCard({ gauge, totalAsset }: Props) {
  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-red-400" />
        <span className="text-sm font-bold text-theme-text">포지션 리스크 게이지</span>
      </div>
      <div className="space-y-4">
        {/* 총 익스포저 */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-theme-text font-bold">총 익스포저</span>
            <span className={cn('font-bold font-num', gauge.exposureRate > 80 ? 'text-red-400' : gauge.exposureRate > 60 ? 'text-amber-400' : 'text-green-400')}>
              {gauge.exposureRate.toFixed(1)}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-white/5 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', gauge.exposureRate > 80 ? 'bg-red-500' : gauge.exposureRate > 60 ? 'bg-amber-500' : 'bg-green-500')}
              style={{ width: `${Math.min(gauge.exposureRate, 100)}%` }}
            />
          </div>
        </div>
        {/* 최대 예상 손실 */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-theme-text font-bold">최대 예상 손실</span>
            <span className="text-red-400 font-bold font-num">-{Math.round(gauge.maxLoss).toLocaleString()}원</span>
          </div>
          <div className="h-3 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-red-500 transition-all"
              style={{ width: `${Math.min((gauge.maxLoss / Math.max(totalAsset, 1)) * 100, 100)}%` }}
            />
          </div>
        </div>
        {/* 남은 투자여력 */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-theme-text font-bold">남은 투자여력</span>
            <span className="text-blue-400 font-bold font-num">{gauge.cashRate.toFixed(1)}%</span>
          </div>
          <div className="h-3 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.min(gauge.cashRate, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
