import React from 'react';
import { Section } from '../../ui/section';
import type { RiskRuleState } from '../../services/autoTrading/autoTradingTypes';

interface RiskControlPanelProps {
  rules: RiskRuleState[];
}

export function RiskControlPanel({ rules }: RiskControlPanelProps) {
  return (
    <Section title="리스크 제어 패널" subtitle="Risk Control Panel">
      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
            리스크 규칙이 없습니다.
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className={`rounded-xl border p-4 ${
                rule.triggered
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">{rule.name}</div>
                  <div className="mt-1 text-xs text-white/60">{rule.message ?? '-'}</div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      rule.enabled
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-500/15 text-slate-300'
                    }`}
                  >
                    {rule.enabled ? '활성' : '비활성'}
                  </span>

                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      rule.triggered
                        ? 'bg-red-500/15 text-red-300'
                        : 'bg-blue-500/15 text-blue-300'
                    }`}
                  >
                    {rule.triggered ? '트리거됨' : '정상'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Section>
  );
}
