// @responsibility AutoTradePage 최상단 단일 결정 카드 — 6 case 우선순위 + VOID 모드 가운데 배치 (ADR-0046 PR-Z4)

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Compass, Eye, ShieldAlert, ListChecks, Activity } from 'lucide-react';
import { Section } from '../../ui/section';
import { cn } from '../../ui/cn';
import { fetchAccountSurvival, type SurvivalSnapshot } from '../../api/survivalClient';
import { fetchDecisionInputs, type DecisionInputs } from '../../api/decisionClient';
import {
  resolveOneDecision,
  type DecisionRecommendation,
  type DecisionTier,
  type DecisionCaseId,
} from '../../utils/oneDecisionResolver';
import type { PositionItem } from '../../services/autoTrading/autoTradingTypes';

interface TodayOneDecisionCardProps {
  positions: PositionItem[];
}

const TIER_STYLE: Record<DecisionTier, { pill: string; ring: string; head: string; bar: string }> = {
  OK:        { pill: 'bg-emerald-500/10 border-emerald-400/30', ring: 'ring-emerald-400/20', head: 'text-emerald-200', bar: 'bg-emerald-400' },
  WARN:      { pill: 'bg-amber-500/10 border-amber-400/30',     ring: 'ring-amber-400/25',  head: 'text-amber-200',  bar: 'bg-amber-400' },
  CRITICAL:  { pill: 'bg-red-500/10 border-red-400/30',         ring: 'ring-red-400/30',    head: 'text-red-200',    bar: 'bg-red-500 animate-pulse' },
  EMERGENCY: { pill: 'bg-black/40 border-red-400/40',           ring: 'ring-red-500/50',    head: 'text-red-100',    bar: 'bg-black animate-pulse' },
  VOID:      { pill: 'bg-slate-700/20 border-slate-500/30',     ring: 'ring-slate-500/25',  head: 'text-slate-200',  bar: 'bg-slate-400' },
};

const CASE_ICON: Record<DecisionCaseId, React.ReactNode> = {
  EMERGENCY_STOP:        <ShieldAlert className="h-4 w-4" />,
  DAILY_LOSS_EMERGENCY:  <ShieldAlert className="h-4 w-4" />,
  INVALIDATED_POSITIONS: <ListChecks className="h-4 w-4" />,
  ACCOUNT_CRITICAL:      <ShieldAlert className="h-4 w-4" />,
  PENDING_APPROVALS:     <ListChecks className="h-4 w-4" />,
  VOID:                  <Eye className="h-4 w-4" />,
  MONITORING:            <Compass className="h-4 w-4" />,
};

function VoidView({ rec }: { rec: DecisionRecommendation }) {
  const style = TIER_STYLE.VOID;
  return (
    <div
      data-testid="today-one-decision-card"
      data-case={rec.caseId}
      data-tier={rec.tier}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'rounded-2xl border ring-1 px-6 py-10',
        style.pill, style.ring,
      )}
    >
      <div className="text-5xl mb-3" aria-hidden>🌑</div>
      <div className={cn('text-xl font-bold mb-2', style.head)}>{rec.headline}</div>
      <div className="text-sm text-slate-300 mb-1">{rec.detail}</div>
      <div className="text-xs text-slate-400 italic mb-4">— SYSTEMATIC ALPHA HUNTER</div>
      <div className="text-sm text-slate-200 mb-3">권장 액션: {rec.suggestedAction}</div>
      {rec.voidChecks && (
        <ul className="text-[11px] text-slate-400 space-y-0.5 mt-2">
          {rec.voidChecks.map((c) => (
            <li key={c.key}>
              ✓ {c.label}: <span className="text-slate-300">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StandardView({ rec }: { rec: DecisionRecommendation }) {
  const style = TIER_STYLE[rec.tier];
  return (
    <div
      data-testid="today-one-decision-card"
      data-case={rec.caseId}
      data-tier={rec.tier}
      className={cn('rounded-xl border ring-1 px-4 py-3', style.pill, style.ring)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={style.head}>{CASE_ICON[rec.caseId]}</span>
          <span className={cn('text-sm font-bold', style.head)}>오늘의 단 하나의 결정</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">자동 갱신 · 60초</span>
      </div>
      <div className={cn('mt-2 text-base font-semibold', style.head)}>{rec.headline}</div>
      <div className="text-sm text-zinc-300 mt-1">{rec.detail}</div>
      <div className="mt-3 px-3 py-2 rounded-lg bg-black/20 text-xs text-zinc-200">
        <span className="text-zinc-500 mr-2">권장 액션:</span>
        {rec.suggestedAction}
      </div>
    </div>
  );
}

export function TodayOneDecisionCard({ positions }: TodayOneDecisionCardProps) {
  const survivalQuery = useQuery<SurvivalSnapshot>({
    queryKey: ['account-survival'],
    queryFn: fetchAccountSurvival,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });
  const inputsQuery = useQuery<DecisionInputs>({
    queryKey: ['decision-inputs'],
    queryFn: fetchDecisionInputs,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  const isLoading = survivalQuery.isLoading || inputsQuery.isLoading;
  const isError = survivalQuery.isError || inputsQuery.isError;

  if (isLoading && !survivalQuery.data && !inputsQuery.data) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4 animate-pulse" />
          <span>오늘의 결정 평가 중…</span>
        </div>
      </Section>
    );
  }

  if (isError && !survivalQuery.data && !inputsQuery.data) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4" />
          <span>의사결정 데이터를 불러올 수 없습니다 — 60초 뒤 자동 재시도.</span>
        </div>
      </Section>
    );
  }

  const rec = resolveOneDecision({
    survival: survivalQuery.data ?? null,
    positions,
    inputs: inputsQuery.data ?? null,
  });

  return (
    <Section>
      {rec.tier === 'VOID' ? <VoidView rec={rec} /> : <StandardView rec={rec} />}
    </Section>
  );
}
