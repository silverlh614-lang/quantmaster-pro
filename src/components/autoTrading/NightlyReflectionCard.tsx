// @responsibility 어젯밤 nightlyReflection 학습 결과 카드 — Pro 모드 전용 (ADR-0047 PR-Z5)

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, AlertTriangle, FlaskConical, Activity } from 'lucide-react';
import { Section } from '../../ui/section';
import { cn } from '../../ui/cn';
import {
  fetchLearningStatus,
  type LearningStatusSnapshot,
  type DailyVerdict,
} from '../../api/learningClient';

const VERDICT_ICON: Record<DailyVerdict, string> = {
  GOOD_DAY: '🟢',
  MIXED:    '🟡',
  BAD_DAY:  '🔴',
  SILENT:   '⚪',
};

const VERDICT_LABEL: Record<DailyVerdict, string> = {
  GOOD_DAY: '좋은 하루',
  MIXED:    '혼재',
  BAD_DAY:  '안 좋은 하루',
  SILENT:   '무발생일',
};

const VERDICT_TEXT_COLOR: Record<DailyVerdict, string> = {
  GOOD_DAY: 'text-emerald-300',
  MIXED:    'text-amber-300',
  BAD_DAY:  'text-red-300',
  SILENT:   'text-zinc-400',
};

function StatBox({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={cn('rounded-lg px-3 py-2', accent ? 'bg-amber-500/10 border border-amber-400/20' : 'bg-black/20')}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function BiasRow({ bias, avg }: { bias: string; avg?: number }) {
  const score = typeof avg === 'number' && Number.isFinite(avg) ? avg : null;
  const tone =
    score === null ? 'text-zinc-500'
    : score >= 0.7 ? 'text-red-300'
    : score >= 0.5 ? 'text-amber-300'
    : 'text-zinc-300';
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span className="text-zinc-300">{bias}</span>
      <span className={cn('font-mono', tone)}>
        {score === null ? 'n/a' : score.toFixed(2)}
      </span>
    </div>
  );
}

interface ContentProps { snapshot: LearningStatusSnapshot }

function ReflectionPresent({ snapshot }: ContentProps) {
  const last = snapshot.lastReflection!;  // 호출자에서 null 체크
  const verdict = last.dailyVerdict;
  const showMissingWarn = snapshot.consecutiveMissingDays >= 3;
  const biasTop3 = snapshot.biasHeatmap7dAvg.slice(0, 3);

  return (
    <div data-testid="nightly-reflection-card" data-verdict={verdict}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-bold text-zinc-100">어젯밤 자기 학습</span>
          <span className={cn('text-xs font-semibold', VERDICT_TEXT_COLOR[verdict])}>
            {VERDICT_ICON[verdict]} {VERDICT_LABEL[verdict]}
          </span>
        </div>
        <span className="text-[10px] text-zinc-500">{last.date} · 모드 {last.mode ?? 'n/a'}</span>
      </div>

      {last.narrativePreview && (
        <div className="rounded-lg bg-black/20 px-3 py-2 mb-3 text-sm text-zinc-200 italic">
          “{last.narrativePreview}{last.narrativeLength > last.narrativePreview.length ? '…' : ''}”
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <StatBox label="배운 점" value={last.keyLessonsCount} />
        <StatBox label="내일 조정" value={last.tomorrowAdjustmentsCount} accent={last.tomorrowAdjustmentsCount > 0} />
        <StatBox label="5-Why" value={last.fiveWhyCount} />
        <StatBox label="활성 실험" value={snapshot.experimentProposalsActive.length} accent={snapshot.experimentProposalsActive.length > 0} />
      </div>

      {biasTop3.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">7일 편향 Top {biasTop3.length}</div>
          <div className="rounded-lg bg-black/20 px-3 py-2 space-y-0.5">
            {biasTop3.map((b) => <BiasRow key={b.bias} bias={b.bias} avg={b.avg} />)}
          </div>
        </div>
      )}

      {snapshot.experimentProposalsActive.length > 0 && (
        <div className="rounded-lg bg-violet-500/10 border border-violet-400/30 px-3 py-2 mb-3 text-xs text-violet-200">
          <FlaskConical className="inline h-3 w-3 mr-1" />
          활성 실험 제안 {snapshot.experimentProposalsActive.length}건 — 텔레그램 <code className="font-mono">/learning_status</code> 에서 상세 확인
        </div>
      )}

      {showMissingWarn && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-400/30 px-3 py-2 mb-3 text-xs text-amber-200">
          <AlertTriangle className="inline h-3 w-3 mr-1" />
          ⚠️ Reflection {snapshot.consecutiveMissingDays}일 연속 누락 — Gemini 예산 모드 {snapshot.reflectionBudget.mode} 확인
        </div>
      )}

      <div className="text-[10px] text-zinc-500">
        상세 분석은 텔레그램 <code className="font-mono">/learning_status</code> · <code className="font-mono">/learning_history 7</code>
      </div>
    </div>
  );
}

function ReflectionAbsent({ snapshot }: ContentProps) {
  return (
    <div data-testid="nightly-reflection-card" data-verdict="ABSENT">
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="h-4 w-4 text-zinc-400" />
        <span className="text-sm font-bold text-zinc-300">어젯밤 자기 학습 — 부재</span>
      </div>
      <div className="text-sm text-zinc-400 mb-2">
        직전 30일 내 reflection 기록이 없습니다.
      </div>
      <div className="text-xs text-zinc-500 mb-3">
        Gemini 예산 모드: <span className="text-zinc-300 font-mono">{snapshot.reflectionBudget.mode}</span>
        {snapshot.consecutiveMissingDays >= 3 && ` · 누락 ${snapshot.consecutiveMissingDays}일`}
      </div>
      {snapshot.diagnostics.warnings.length > 0 && (
        <ul className="text-xs text-amber-200 space-y-0.5">
          {snapshot.diagnostics.warnings.slice(0, 3).map((w, i) => (
            <li key={i}>⚠️ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NightlyReflectionCard() {
  const { data, isLoading, isError } = useQuery<LearningStatusSnapshot>({
    queryKey: ['learning-status'],
    queryFn: fetchLearningStatus,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 2,
  });

  if (isLoading && !data) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4 animate-pulse" />
          <span>학습 결과 로딩 중…</span>
        </div>
      </Section>
    );
  }

  if (isError || !data) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4" />
          <span>학습 데이터를 불러올 수 없습니다 — 5분 뒤 자동 재시도.</span>
        </div>
      </Section>
    );
  }

  return (
    <Section>
      {data.lastReflection
        ? <ReflectionPresent snapshot={data} />
        : <ReflectionAbsent snapshot={data} />
      }
    </Section>
  );
}
