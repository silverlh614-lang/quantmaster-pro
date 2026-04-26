// @responsibility 보유 포지션 카드 인라인 무효화 조건 미터 — 4 dot + tier 색상 + expand 상세 (ADR-0051 PR-Z3)

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { PositionItem } from '../../services/autoTrading/autoTradingTypes';
import {
  evaluateInvalidationConditions,
  type InvalidationCondition,
  type InvalidationTier,
} from '../../utils/invalidationConditions';

const TIER_STYLE: Record<InvalidationTier, { dot: string; pill: string; label: string; ring: string }> = {
  OK:       { dot: 'bg-emerald-400',   pill: 'bg-emerald-500/10 border-emerald-400/30', label: 'text-emerald-300', ring: 'ring-emerald-400/20' },
  WARN:     { dot: 'bg-amber-400',     pill: 'bg-amber-500/10 border-amber-400/30',     label: 'text-amber-300',   ring: 'ring-amber-400/20' },
  CRITICAL: { dot: 'bg-red-500 animate-pulse', pill: 'bg-red-500/10 border-red-400/30', label: 'text-red-300',     ring: 'ring-red-400/30' },
  NA:       { dot: 'bg-zinc-600',      pill: 'bg-zinc-500/10 border-zinc-500/30',     label: 'text-zinc-400',    ring: 'ring-zinc-500/20' },
};

const TIER_TEXT: Record<InvalidationTier, string> = {
  OK: '정상',
  WARN: '주의',
  CRITICAL: '재평가 권고',
  NA: '평가 불가',
};

interface InvalidationMeterProps {
  position: PositionItem;
  /** 기본 false — 초기 펼침 상태. */
  defaultExpanded?: boolean;
}

/**
 * Dot 1개 — 충족이면 tier 색상, 미충족이면 회색, NA 면 stroke-only 원.
 */
function ConditionDot({ met, tier }: { met: boolean | null; tier: InvalidationTier }) {
  if (met === null) {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full border border-zinc-600/60"
        aria-label="평가 불가"
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        met ? TIER_STYLE[tier].dot : 'bg-zinc-700',
      )}
      aria-label={met ? '충족' : '미충족'}
    />
  );
}

function ConditionRow({ c, tier }: { c: InvalidationCondition; tier: InvalidationTier }) {
  const status = c.met === null ? '— NA' : c.met ? '— 충족' : '— 미충족';
  const statusColor = c.met === null
    ? 'text-zinc-500'
    : c.met
      ? TIER_STYLE[tier].label
      : 'text-zinc-400';
  return (
    <div className="flex items-start justify-between gap-2 text-xs py-1">
      <div className="flex items-center gap-2 min-w-0">
        <ConditionDot met={c.met} tier={tier} />
        <span className="text-white/80 font-medium">{c.label}</span>
        <span className={cn('text-[10px] uppercase tracking-wider', statusColor)}>{status}</span>
      </div>
      <span className="text-white/50 truncate text-right" title={c.detail}>
        {c.detail}
      </span>
    </div>
  );
}

export function InvalidationMeter({ position, defaultExpanded = false }: InvalidationMeterProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const result = evaluateInvalidationConditions(position);
  const style = TIER_STYLE[result.tier];

  return (
    <div
      className={cn('rounded-lg border px-3 py-2 ring-1', style.pill, style.ring)}
      data-testid="invalidation-meter"
      data-tier={result.tier}
      data-met={result.metCount}
      data-evaluable={result.evaluableCount}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`invalidation-meter-detail-${position.id}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className={cn('h-3.5 w-3.5 flex-shrink-0', style.label)} />
          <span className="text-xs font-semibold text-white/80">무효화 조건</span>
          <div className="flex items-center gap-1" aria-label="조건 dots">
            {result.conditions.map((c) => (
              <ConditionDot key={c.key} met={c.met} tier={result.tier} />
            ))}
          </div>
          <span className={cn('text-xs font-mono', style.label)}>
            {result.metCount}/{result.evaluableCount}
          </span>
          <span className={cn('text-[10px] uppercase tracking-wider', style.label)}>
            {TIER_TEXT[result.tier]}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-white/40" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-white/40" />
        )}
      </button>

      {expanded && (
        <div
          id={`invalidation-meter-detail-${position.id}`}
          className="mt-2 border-t border-white/5 pt-2 space-y-1"
        >
          {result.conditions.map((c) => (
            <ConditionRow key={c.key} c={c} tier={result.tier} />
          ))}
        </div>
      )}
    </div>
  );
}
