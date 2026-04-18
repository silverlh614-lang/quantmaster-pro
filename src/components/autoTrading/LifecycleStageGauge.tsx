/**
 * LifecycleStageGauge — 5단계 포지션 생애주기 인라인 진행바.
 *
 * ENTRY(sky) → HOLD(emerald) → ALERT(amber) → EXIT_PREP(orange) → FULL_EXIT(red)
 *
 * 각 단계 뱃지는 "통과(dim)" / "현재(full saturation + ring)" / "미도달(outline)"
 * 3가지 상태로 렌더된다. 현재 단계는 pulse 애니메이션으로 강조.
 * breachedConditions 가 있으면 tooltip title 로 제공 — 커서 올릴 때만 노출.
 */

import React from 'react';
import type { PositionLifecycleStage } from '../../services/autoTrading/autoTradingTypes';

const STAGE_ORDER: PositionLifecycleStage[] = ['ENTRY', 'HOLD', 'ALERT', 'EXIT_PREP', 'FULL_EXIT'];

const STAGE_LABEL: Record<PositionLifecycleStage, string> = {
  ENTRY: '진입',
  HOLD: '보유',
  ALERT: '주의',
  EXIT_PREP: '청산준비',
  FULL_EXIT: '전량청산',
};

const STAGE_SHORT: Record<PositionLifecycleStage, string> = {
  ENTRY: 'E',
  HOLD: 'H',
  ALERT: 'A',
  EXIT_PREP: 'X',
  FULL_EXIT: 'F',
};

// 단계별 톤 — 활성일 때 채도 최대 / 통과했을 땐 어둡게 / 미도달은 윤곽만
const STAGE_TONE: Record<
  PositionLifecycleStage,
  { active: string; passed: string; future: string; track: string }
> = {
  ENTRY: {
    active: 'bg-sky-500 text-white ring-sky-300/60',
    passed: 'bg-sky-500/25 text-sky-100',
    future: 'bg-white/5 text-white/30 border border-white/10',
    track: 'bg-sky-400',
  },
  HOLD: {
    active: 'bg-emerald-500 text-white ring-emerald-300/60',
    passed: 'bg-emerald-500/25 text-emerald-100',
    future: 'bg-white/5 text-white/30 border border-white/10',
    track: 'bg-emerald-400',
  },
  ALERT: {
    active: 'bg-amber-500 text-black ring-amber-300/60',
    passed: 'bg-amber-500/25 text-amber-100',
    future: 'bg-white/5 text-white/30 border border-white/10',
    track: 'bg-amber-400',
  },
  EXIT_PREP: {
    active: 'bg-orange-600 text-white ring-orange-300/60',
    passed: 'bg-orange-500/25 text-orange-100',
    future: 'bg-white/5 text-white/30 border border-white/10',
    track: 'bg-orange-500',
  },
  FULL_EXIT: {
    active: 'bg-red-600 text-white ring-red-300/60',
    passed: 'bg-red-500/25 text-red-100',
    future: 'bg-white/5 text-white/30 border border-white/10',
    track: 'bg-red-500',
  },
};

interface LifecycleStageGaugeProps {
  stage: PositionLifecycleStage;
  breachedConditions?: string[];
  /** 컴팩트 모드 — 카드 내부에서 공간 절약용 (라벨 숨김). */
  compact?: boolean;
}

export function LifecycleStageGauge({ stage, breachedConditions, compact }: LifecycleStageGaugeProps) {
  const currentIndex = STAGE_ORDER.indexOf(stage);
  const tooltip = breachedConditions?.length
    ? `이탈 조건:\n  • ${breachedConditions.join('\n  • ')}`
    : `현재 단계: ${STAGE_LABEL[stage]}`;

  return (
    <div className="space-y-1.5" title={tooltip}>
      {!compact && (
        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.15em] text-white/50">
          <span>Position Lifecycle</span>
          <span className={currentIndex >= 2 ? 'text-amber-300' : 'text-emerald-300'}>
            {STAGE_LABEL[stage]}
          </span>
        </div>
      )}

      <div className="flex items-center gap-0.5">
        {STAGE_ORDER.map((s, i) => {
          const tone = STAGE_TONE[s];
          const isCurrent = i === currentIndex;
          const isPassed = i < currentIndex;
          const classes = isCurrent ? tone.active : isPassed ? tone.passed : tone.future;
          return (
            <React.Fragment key={s}>
              <div
                className={`flex h-6 min-w-[2rem] flex-1 items-center justify-center rounded text-[10px] font-black transition-all ${classes} ${
                  isCurrent ? 'ring-2 ring-offset-2 ring-offset-black/60 animate-pulse' : ''
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {compact ? STAGE_SHORT[s] : STAGE_LABEL[s]}
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <div
                  className={`h-[2px] w-2 ${i < currentIndex ? STAGE_TONE[STAGE_ORDER[i + 1]].track : 'bg-white/10'}`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
