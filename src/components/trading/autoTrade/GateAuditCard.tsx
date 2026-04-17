import React from 'react';
import { BarChart3, Info } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import type { GateAuditData } from '../../../api';
import { CONDITION_LABELS, GATE_TOOLTIPS } from './constants';

interface Props { audit: GateAuditData; }

export function GateAuditCard({ audit }: Props) {
  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-bold text-theme-text">Gate 조건 통과율 히트맵</span>
        <span className="ml-auto flex items-center gap-1.5">
          {Object.entries(GATE_TOOLTIPS).map(([gate, desc]) => (
            <span
              key={gate}
              title={desc}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/5 text-theme-text-muted cursor-help hover:bg-white/10 transition-colors"
            >
              <Info className="w-3 h-3" />G{gate}
            </span>
          ))}
        </span>
      </div>
      <div className="space-y-2">
        {Object.entries(audit)
          .sort(([, a], [, b]) => {
            const rateA = a.passed + a.failed > 0 ? a.passed / (a.passed + a.failed) : 0;
            const rateB = b.passed + b.failed > 0 ? b.passed / (b.passed + b.failed) : 0;
            return rateA - rateB; // 통과율 낮은 순 (가장 타이트한 조건 먼저)
          })
          .map(([key, stats]) => {
            const total = stats.passed + stats.failed;
            const rate = total > 0 ? (stats.passed / total) * 100 : 0;
            const barColor = rate >= 60 ? 'bg-green-500' : rate >= 30 ? 'bg-amber-500' : 'bg-red-500';
            const label = CONDITION_LABELS[key] ?? key;
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-theme-text font-bold">{label}</span>
                  <span className="text-theme-text-muted">
                    {rate.toFixed(0)}% ({stats.passed}/{total})
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', barColor)}
                    style={{ width: `${rate}%` }}
                  />
                </div>
              </div>
            );
          })}
      </div>
    </Card>
  );
}
