// @responsibility 종목 카드 데이터 품질 카운트 배지 — 5-tier 격상 (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL, ADR-0028 §3 + ADR-0095)

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { DataQualityCount, DataQualityTier } from '../../types/ui';
import { useUILang } from '../../hooks/useUILang';
import { useUIVerbosity } from '../../hooks/useUIVerbosity';

interface DataQualityBadgeProps {
  count: DataQualityCount;
  /** 컴팩트 모드 (카드용 한 줄). 기본 true. */
  compact?: boolean;
  className?: string;
  /**
   * Verbosity 분기 강제 override — props 명시 시 useUIVerbosity 무시 (테스트/특수 케이스).
   * ADR-0109 PR-Verbose-Wiring-4 — minimal 시 미렌더, balanced/verbose 렌더.
   */
  forceShow?: boolean;
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
 * 종목 카드의 27+1 조건 데이터 품질을 한 줄로 노출 (5-tier 격상, ADR-0095).
 * - compact (기본): "🟢 18 🟡 6 🔴 3 ⏳ 2 ✏️ 1" 한 줄. delayed/manual 카운트 0 시 자동 생략.
 * - !compact: 5 줄 풀 표시 + tier 색상 띠
 *
 * `sourceMetaAvailable=false` 일 때 ? 아이콘으로 휴리스틱 fallback 명시.
 * 서버 sourceTier 메타가 들어오면 ? 사라짐 + delayed/manual 정확 분류.
 *
 * 라벨은 UI_LANG.tier (ADR-0094 SSOT) 사용 — 향후 KO/EN 토글 시 자동 격상.
 */
export function DataQualityBadge({ count, compact = true, className, forceShow }: DataQualityBadgeProps) {
  // ADR-0109 PR-Verbose-Wiring-4: shouldShow('data-quality') 분기 — minimal 시 미렌더, balanced/verbose 렌더
  const verbosityState = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : verbosityState.shouldShow('data-quality');
  if (!shouldRender) return null;
  const t = useUILang();
  const { computed, api, aiInferred, delayed = 0, manual = 0, total, tier, sourceMetaAvailable } = count;

  if (total === 0) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap',
          'bg-gray-800 text-gray-400 border border-white/[0.07]', className)}
        title="데이터 항목 평가 결과 없음"
      >
        데이터 부족
      </span>
    );
  }

  const fallbackTitle = sourceMetaAvailable
    ? `데이터 품질: ${TIER_LABEL[tier]} (서버 메타 기반)`
    : `데이터 품질: ${TIER_LABEL[tier]} — 클라이언트 휴리스틱 분류 (ADR-0028 PR-A fallback)`;

  // 5-tier 라벨 — UI_LANG.tier SSOT 사용 (ADR-0094)
  const labels = {
    verified: t.tier('VERIFIED'),
    external: t.tier('EXTERNAL'),
    delayed: t.tier('DELAYED'),
    estimated: t.tier('ESTIMATED'),
    manual: t.tier('MANUAL'),
  };

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
        aria-label={`데이터 품질 ${TIER_LABEL[tier]}: ${labels.verified} ${computed}, ${labels.external} ${api}, ${labels.estimated} ${aiInferred}${delayed > 0 ? `, ${labels.delayed} ${delayed}` : ''}${manual > 0 ? `, ${labels.manual} ${manual}` : ''}`}
      >
        <span aria-hidden>🟢</span><span className="font-num">{computed}</span>
        <span className="opacity-40">·</span>
        <span aria-hidden>🟡</span><span className="font-num">{api}</span>
        <span className="opacity-40">·</span>
        <span aria-hidden>🔴</span><span className="font-num">{aiInferred}</span>
        {delayed > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span aria-hidden>⏳</span><span className="font-num">{delayed}</span>
          </>
        )}
        {manual > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span aria-hidden>✏️</span><span className="font-num">{manual}</span>
          </>
        )}
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
        <span className="text-[10px] font-semibold tracking-tight opacity-70">데이터 품질</span>
        <span className="text-[10px] font-black">{TIER_LABEL[tier]}</span>
      </div>
      <ul className="space-y-0.5 font-num">
        <li className="flex justify-between">
          <span><span aria-hidden>🟢</span> {labels.verified}</span>
          <span className="font-black">{computed}</span>
        </li>
        <li className="flex justify-between">
          <span><span aria-hidden>🟡</span> {labels.external}</span>
          <span className="font-black">{api}</span>
        </li>
        <li className="flex justify-between">
          <span><span aria-hidden>🔴</span> {labels.estimated}</span>
          <span className="font-black">{aiInferred}</span>
        </li>
        {delayed > 0 && (
          <li className="flex justify-between">
            <span><span aria-hidden>⏳</span> {labels.delayed}</span>
            <span className="font-black">{delayed}</span>
          </li>
        )}
        {manual > 0 && (
          <li className="flex justify-between">
            <span><span aria-hidden>✏️</span> {labels.manual}</span>
            <span className="font-black">{manual}</span>
          </li>
        )}
        <li className="flex justify-between border-t border-white/[0.07] pt-0.5 opacity-70">
          <span>합계</span>
          <span className="font-black">{total}</span>
        </li>
      </ul>
      {!sourceMetaAvailable && (
        <p className="mt-1 text-[9px] opacity-60 leading-snug flex items-start gap-1">
          <HelpCircle className="w-2.5 h-2.5 mt-0.5 shrink-0" aria-hidden />
          <span>휴리스틱 분류 — 서버 5-tier 메타 도입 시 정확도 격상</span>
        </p>
      )}
    </div>
  );
}
