// @responsibility WatchlistCard 임베드용 압축 Gate 0/1/2/3 통과 표 (ADR-0028 §4)

import React from 'react';
import { Check, X, AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '../../ui/cn';
import type {
  GateCardSummary,
  GateLineSummary,
  OverallVerdict,
} from '../../types/ui';

interface GateStatusCardProps {
  summary: GateCardSummary;
  /** 클릭 시 풀 디테일(StockDetailModal) 열기 콜백. 미지정 시 호버 비활성. */
  onExpand?: () => void;
  className?: string;
}

const VERDICT_STYLE: Record<OverallVerdict, { label: string; chip: string }> = {
  STRONG_BUY: { label: 'STRONG BUY', chip: 'bg-violet-500/20 border-violet-500/40 text-violet-200' },
  BUY:        { label: 'BUY',        chip: 'bg-green-500/20  border-green-500/40  text-green-200'  },
  HOLD:       { label: 'HOLD',       chip: 'bg-amber-500/20  border-amber-500/40  text-amber-200'  },
  CAUTION:    { label: 'CAUTION',    chip: 'bg-orange-500/20 border-orange-500/40 text-orange-200' },
  AVOID:      { label: 'AVOID',      chip: 'bg-red-500/20    border-red-500/40    text-red-200'    },
};

function gateLine(label: string, line: GateLineSummary | null, isBoolean = false, passed = false) {
  if (isBoolean) {
    const ok = passed;
    return (
      <li className="flex items-center justify-between text-[11px]">
        <span className="opacity-80 font-bold">{label}</span>
        <span className={cn(
          'flex items-center gap-1 font-num font-black',
          ok ? 'text-green-300' : 'text-red-300',
        )}>
          {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
          {ok ? 'PASS' : 'FAIL'}
        </span>
      </li>
    );
  }
  if (!line) return null;
  const isFullPass = line.verdict === 'PASS';
  const isPartial = !isFullPass && line.passed > 0;
  const Icon = isFullPass ? Check : isPartial ? AlertTriangle : X;
  const colorCls = isFullPass ? 'text-green-300' : isPartial ? 'text-amber-300' : 'text-red-300';
  return (
    <li className="flex items-center justify-between text-[11px]">
      <span className="opacity-80 font-bold">{label}</span>
      <span className={cn('flex items-center gap-1 font-num font-black', colorCls)}>
        <Icon className="w-3 h-3" />
        {line.passed}/{line.required} {line.verdict}
      </span>
    </li>
  );
}

/**
 * 카드 임베드용 압축 read-only Gate 통과 표.
 *
 * 렌더 (사용자 원안):
 *   Gate 0: ✅ PASS
 *   Gate 1: ✅ 5/5 PASS
 *   Gate 2: 🟡 8/12 FAIL (필요 9)  ← 부분 통과는 노란 경고
 *   Gate 3: ❌ 4/10 FAIL
 *   종합: HOLD
 *
 * GateStatusWidget 와 별도 — expand 토글 없는 read-only 카드 (ADR-0028 §4).
 */
export function GateStatusCard({ summary, onExpand, className }: GateStatusCardProps) {
  const { gate0Passed, gate1, gate2, gate3, overallVerdict } = summary;
  const v = VERDICT_STYLE[overallVerdict];
  const interactive = typeof onExpand === 'function';

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-2', className)}
      role="region"
      aria-label={`Gate 0~3 통과 요약 — ${v.label}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Gate 0~3</span>
        <span className={cn(
          'text-[10px] font-black px-1.5 py-0.5 rounded border whitespace-nowrap',
          v.chip,
        )}>
          {v.label}
        </span>
      </div>

      <ul className="space-y-1">
        {gateLine('Gate 0', null, true, gate0Passed)}
        {gateLine('Gate 1', gate1)}
        {gateLine('Gate 2', gate2)}
        {gateLine('Gate 3', gate3)}
      </ul>

      {interactive && (
        <button
          type="button"
          onClick={onExpand}
          className="mt-1.5 w-full flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors"
          aria-label="풀 디테일 보기"
        >
          상세 분석 <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── 헬퍼: StockRecommendation → GateCardSummary ─────────────────────────────

import type { StockRecommendation } from '../../services/stockService';
import {
  GATE1_IDS, GATE2_IDS, GATE3_IDS,
  GATE1_REQUIRED, GATE2_REQUIRED, GATE3_REQUIRED,
  CONDITION_PASS_THRESHOLD,
} from '../../constants/gateConfig';
import { CONDITION_ID_TO_CHECKLIST_KEY } from '../../types/core';
import type { ConditionId } from '../../types/core';

function conditionPasses(stock: StockRecommendation, id: ConditionId): boolean {
  const key = CONDITION_ID_TO_CHECKLIST_KEY[id];
  if (!key) return false;
  const value = stock.checklist[key as keyof typeof stock.checklist];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return value >= CONDITION_PASS_THRESHOLD;
}

function buildLine(passed: number, required: number): GateLineSummary {
  return {
    passed,
    required,
    verdict: passed >= required ? 'PASS' : 'FAIL',
  };
}

/**
 * `StockRecommendation` 1건에서 `GateCardSummary` 를 빌드한다.
 * gate0Passed 는 ADR-0028 §4 단순화에 따라 `gateEvaluation.gate1Passed` 또는
 * `gateEvaluation.isPassed` 를 alias 로 사용한다.
 */
export function buildGateCardSummary(stock: StockRecommendation): GateCardSummary {
  const passedG1 = GATE1_IDS.filter(id => conditionPasses(stock, id)).length;
  const passedG2 = GATE2_IDS.filter(id => conditionPasses(stock, id)).length;
  const passedG3 = GATE3_IDS.filter(id => conditionPasses(stock, id)).length;

  const gate1 = buildLine(passedG1, GATE1_REQUIRED);
  const gate2 = buildLine(passedG2, GATE2_REQUIRED);
  const gate3 = buildLine(passedG3, GATE3_REQUIRED);

  const evalGate = stock.gateEvaluation;
  const gate0Passed = Boolean(evalGate?.gate1Passed ?? evalGate?.isPassed);

  const passCount =
    (gate0Passed ? 1 : 0) +
    (gate1.verdict === 'PASS' ? 1 : 0) +
    (gate2.verdict === 'PASS' ? 1 : 0) +
    (gate3.verdict === 'PASS' ? 1 : 0);

  const overallVerdict: OverallVerdict =
    passCount === 4 ? 'STRONG_BUY' :
    passCount === 3 ? 'BUY' :
    passCount === 2 ? 'HOLD' :
    passCount === 1 ? 'CAUTION' : 'AVOID';

  return { gate0Passed, gate1, gate2, gate3, overallVerdict };
}
