// @responsibility 종목 카드 데이터 품질 카운트 배지 — 실계산/API/AI추정 3분류 (ADR-0018 §3)

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { DataQualityCount, DataQualityTier } from '../../types/ui';

interface DataQualityBadgeProps {
  count: DataQualityCount;
  /** 컴팩트 모드 (카드용 한 줄). 기본 true. */
  compact?: boolean;
  className?: string;
}

const TIER_STYLE: Record<DataQualityTier, string> = {
  HIGH: 'bg-green-900/40 border-green-500/30 text-green-200',
  MEDIUM: 'bg-amber-900/40 border-amber-500/30 text-amber-200',
  LOW: 'bg-red-900/40 border-red-500/30 text-red-200',
};

const TIER_LABEL: Record<DataQualityTier, string> = {
  HIGH: '품질 상',
  MEDIUM: '품질 중',
  LOW: '품질 하',
};

/**
 * 종목 카드의 27+1 조건 데이터 품질을 한 줄로 노출.
 * - compact (기본): "🟢 18 🟡 6 🔴 3" 한 줄 + 작은 ? (fallback 안내)
 * - !compact: 3 줄 풀 표시 + tier 색상 띠
 *
 * `sourceMetaAvailable=false` 일 때 ? 아이콘으로 휴리스틱 fallback 명시.
 * PR-B 에서 서버 sourceTier 메타가 들어오면 ? 사라짐.
 */
export function DataQualityBadge({ count, compact = true, className }: DataQualityBadgeProps) {
  const { computed, api, aiInferred, total, tier, sourceMetaAvailable } = count;

  if (total === 0) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap',
          'bg-gray-800 text-gray-400 border border-white/10', className)}
        title="데이터 항목 평가 결과 없음"
      >
        데이터 부족
      </span>
    );
  }

  const fallbackTitle = sourceMetaAvailable
    ? `데이터 품질: ${TIER_LABEL[tier]} (서버 메타 기반)`
    : `데이터 품질: ${TIER_LABEL[tier]} — 클라이언트 휴리스틱 분류 (ADR-0018 PR-A fallback)`;

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap border',
          TIER_STYLE[tier],
          className,
        )}
        title={fallbackTitle}
        role="img"
        aria-label={`데이터 품질 ${TIER_LABEL[tier]}: 실계산 ${computed}, API ${api}, AI추정 ${aiInferred}`}
      >
        <span aria-hidden>🟢</span><span className="font-num">{computed}</span>
        <span className="opacity-40">·</span>
        <span aria-hidden>🟡</span><span className="font-num">{api}</span>
        <span className="opacity-40">·</span>
        <span aria-hidden>🔴</span><span className="font-num">{aiInferred}</span>
        {!sourceMetaAvailable && (
          <HelpCircle className="w-2.5 h-2.5 opacity-50" aria-hidden />
        )}
      </span>
    );
  }

  return (
    <div
      className={cn('rounded border p-2 text-[11px]', TIER_STYLE[tier], className)}
      title={fallbackTitle}
      role="region"
      aria-label="데이터 품질"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-black uppercase tracking-widest opacity-70">데이터 품질</span>
        <span className="text-[10px] font-black">{TIER_LABEL[tier]}</span>
      </div>
      <ul className="space-y-0.5 font-num">
        <li className="flex justify-between">
          <span><span aria-hidden>🟢</span> 실계산</span>
          <span className="font-black">{computed}</span>
        </li>
        <li className="flex justify-between">
          <span><span aria-hidden>🟡</span> API</span>
          <span className="font-black">{api}</span>
        </li>
        <li className="flex justify-between">
          <span><span aria-hidden>🔴</span> AI 추정</span>
          <span className="font-black">{aiInferred}</span>
        </li>
        <li className="flex justify-between border-t border-white/10 pt-0.5 opacity-70">
          <span>합계</span>
          <span className="font-black">{total}</span>
        </li>
      </ul>
      {!sourceMetaAvailable && (
        <p className="mt-1 text-[9px] opacity-60 leading-snug flex items-start gap-1">
          <HelpCircle className="w-2.5 h-2.5 mt-0.5 shrink-0" aria-hidden />
          <span>휴리스틱 분류 — 서버 메타 도입 시 정확도 격상</span>
        </p>
      )}
    </div>
  );
}
