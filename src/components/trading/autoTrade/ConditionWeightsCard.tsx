import React from 'react';
import { Settings2 } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import { Badge } from '../../../ui/badge';
import type { ConditionWeightsDebug } from '../../../api';
import { CONDITION_LABELS } from './constants';

interface Props { debug: ConditionWeightsDebug; }

export function ConditionWeightsCard({ debug }: Props) {
  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-bold text-theme-text">자동매매 진입 조건 설정 현황</span>
        {debug.recentRecordsCount > 0 && (
          <span className="text-micro ml-auto">
            최근 30일 데이터 {debug.recentRecordsCount}건 ({debug.period.from} ~ {debug.period.to})
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {Object.entries(debug.globalWeights)
          .sort(([, a], [, b]) => b - a)
          .map(([key, weight]) => {
            const label = CONDITION_LABELS[key] ?? key;
            const defaultW = debug.defaults[key] ?? 1.0;
            const stat = debug.conditionStats30d[key];
            const isModified = Math.abs(weight - defaultW) > 0.01;
            return (
              <div key={key} className="flex items-center gap-2 py-1.5 border-b border-theme-border/10 last:border-0">
                <span className="flex-1 text-xs text-theme-text truncate">{label}</span>
                <Badge variant={weight >= 1.2 ? 'success' : weight <= 0.5 ? 'danger' : 'default'} size="sm">
                  가중치 {weight.toFixed(1)}{isModified ? ` (기본 ${defaultW.toFixed(1)})` : ''}
                </Badge>
                {stat && stat.totalAppearances > 0 && (
                  <span className={cn('text-[9px] font-bold', stat.hitRate >= 50 ? 'text-green-400' : 'text-red-400')}>
                    적중 {stat.hitRate}%
                  </span>
                )}
              </div>
            );
          })}
      </div>
      <div className="mt-3 rounded-lg bg-white/5 p-2.5 text-micro text-theme-text-muted leading-relaxed">
        <strong className="text-theme-text">진입 판정 기준:</strong>{' '}
        Gate 점수 ≥ 7 → STRONG (12% 포지션) · ≥ 5 → NORMAL (8%) · &lt; 5 → SKIP.
        MTAS(다중시간프레임) ≤ 3이면 진입 금지.
        가중치는 30일 적중률 기반으로 자동 조정됩니다.
      </div>
    </Card>
  );
}
