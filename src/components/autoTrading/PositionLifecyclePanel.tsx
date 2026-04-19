import React from 'react';
import { Briefcase } from 'lucide-react';
import { Section } from '../../ui/section';
import { EmptyState } from '../../ui/empty-state';
import { TrendIndicator } from '../../ui/trend-indicator';
import type { PositionItem } from '../../services/autoTrading/autoTradingTypes';
import { LifecycleStageGauge } from './LifecycleStageGauge';

interface PositionLifecyclePanelProps {
  positions: PositionItem[];
}

export function PositionLifecyclePanel({ positions }: PositionLifecyclePanelProps) {
  return (
    <Section title="활성 포지션 포트폴리오" subtitle="Active Position Lifecycle">
      {positions.length === 0 ? (
        <EmptyState
          variant="minimal"
          icon={<Briefcase className="h-6 w-6" />}
          title="현재 보유 포지션이 없습니다"
          description="엔진이 신호를 감지하면 이 자리에 생애주기 카드가 나타납니다."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {positions.map((position) => (
            <div key={position.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-white">
                    {position.name} ({position.symbol})
                  </div>
                  <div className="mt-1 text-xs text-white/50">진입시각: {position.enteredAt}</div>
                </div>

                <span
                  className={`rounded-full px-3 py-1 text-xs ${
                    position.status === 'HOLD'
                      ? 'bg-blue-500/15 text-blue-300'
                      : position.status === 'REDUCE'
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-red-500/15 text-red-300'
                  }`}
                >
                  {position.status}
                </span>
              </div>

              {/* Phase 4: 5단계 생애주기 진행바 ─────────────────────── */}
              <div className="mt-4">
                <LifecycleStageGauge
                  stage={position.stage ?? 'HOLD'}
                  breachedConditions={position.breachedConditions}
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-xs text-white/50">평균단가</div>
                  <div className="mt-1 text-white">{position.avgPrice.toLocaleString()}원</div>
                </div>
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-xs text-white/50">현재가</div>
                  <div className="mt-1 text-white">{position.currentPrice.toLocaleString()}원</div>
                </div>
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-xs text-white/50">수익률</div>
                  <div className="mt-1">
                    <TrendIndicator value={position.pnlPct} size="md" />
                  </div>
                </div>
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-xs text-white/50">수량</div>
                  <div className="mt-1 text-white">{position.quantity}</div>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="text-white/80">
                  <span className="text-white/50">진입 근거:</span> {position.entryReason}
                </div>
                <div className="text-white/80">
                  <span className="text-white/50">손절가:</span>{' '}
                  {position.stopLossPrice?.toLocaleString() ?? '-'}
                </div>
                <div className="text-white/80">
                  <span className="text-white/50">1차 목표가:</span>{' '}
                  {position.targetPrice1?.toLocaleString() ?? '-'}
                </div>
                <div className="text-white/80">
                  <span className="text-white/50">2차 목표가:</span>{' '}
                  {position.targetPrice2?.toLocaleString() ?? '-'}
                </div>
                <div className="text-white/80">
                  <span className="text-white/50">트레일링 스탑:</span>{' '}
                  {position.trailingStopEnabled ? '활성' : '비활성'}
                </div>
                {position.warningMessage && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                    {position.warningMessage}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
