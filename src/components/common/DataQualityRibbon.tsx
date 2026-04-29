// @responsibility 페이지 상단 누적 데이터 신뢰도 띠 — 5-tier 분포 ambient 노출 (ADR-0096 PR-Phase-B)

/**
 * 사용자 분석 #5 직접 구현 — DataQualityBadge 가 *개별 필드 단위* 라 페이지 전체
 * 신뢰도를 한눈에 못 보는 갭 해소. 페이지 상단(MarketOverviewHeader 등) 에 얇은 가로 띠
 * 추가해 *모든 표시 필드의 5-tier 누적 분포* 를 노출.
 *
 * 띠의 색상이 페이지 전체 데이터 신뢰도를 ambient 하게 전달:
 * - 추정값 ≥ 50% → 빨강 (운영 위험)
 * - 추정값 ≥ 30% → 노랑 (경고)
 * - 그 외 → 녹색 (양호)
 *
 * 사용자가 매번 개별 배지를 안 봐도 페이지 신뢰도를 무의식적으로 감지.
 * Blueprint 원칙 10번 "시스템 신뢰도를 UI 에서 숨기지 않는다" 의 가벼운 구현.
 *
 * 침습성 낮음 — CSS 변수 안 건드림, 페이지 상단 띠 1줄만.
 */
import type { ReactElement } from 'react';
import { cn } from '../../ui/cn';
import { useUILang } from '../../hooks/useUILang';
import { useUIVerbosity } from '../../hooks/useUIVerbosity';
import type { DataQualityCount } from '../../types/ui';

interface DataQualityRibbonProps {
  /** 페이지에 표시되는 모든 필드의 5-tier 카운트 배열 */
  counts: DataQualityCount[];
  className?: string;
  /** 띠 높이 (px). 기본 3px. */
  height?: number;
  /**
   * Verbosity 분기 강제 override — props 명시 시 useUIVerbosity 무시 (테스트/특수 케이스).
   * ADR-0103 PR-Verbose-Wiring-3 — minimal/balanced 시 미렌더, verbose 한정.
   */
  forceShow?: boolean;
}

/**
 * 누적 비율 계산 결과 (순수 함수, 단위 테스트 가능).
 *
 * 5 카테고리 모두 합산 → 비율 산출. delayed/manual 옵셔널 처리.
 * 빈 입력 / 모든 카운트 0 → empty=true 반환 (UI 가 placeholder 처리).
 */
export interface RibbonRatios {
  empty: boolean;
  total: number;
  /** computed/total — VERIFIED 비율 */
  verifiedPct: number;
  /** api/total — EXTERNAL 비율 */
  externalPct: number;
  /** delayed/total */
  delayedPct: number;
  /** aiInferred/total — ESTIMATED 비율 */
  estimatedPct: number;
  /** manual/total */
  manualPct: number;
  /** 종합 grade — verifiedPct ≥ 0.6 GOOD / ≥ 0.4 OK / 그 외 WARN */
  grade: 'GOOD' | 'OK' | 'WARN';
}

const ESTIMATED_WARN_THRESHOLD = 0.30; // 추정 ≥ 30% → 노랑
const ESTIMATED_DANGER_THRESHOLD = 0.50; // 추정 ≥ 50% → 빨강

export function computeRibbonRatios(counts: DataQualityCount[]): RibbonRatios {
  if (counts.length === 0) {
    return {
      empty: true, total: 0,
      verifiedPct: 0, externalPct: 0, delayedPct: 0, estimatedPct: 0, manualPct: 0,
      grade: 'WARN',
    };
  }

  let computed = 0, api = 0, aiInferred = 0, delayed = 0, manual = 0;
  for (const c of counts) {
    computed += c.computed;
    api += c.api;
    aiInferred += c.aiInferred;
    delayed += c.delayed ?? 0;
    manual += c.manual ?? 0;
  }
  const total = computed + api + aiInferred + delayed + manual;

  if (total === 0) {
    return {
      empty: true, total: 0,
      verifiedPct: 0, externalPct: 0, delayedPct: 0, estimatedPct: 0, manualPct: 0,
      grade: 'WARN',
    };
  }

  const verifiedPct = computed / total;
  const externalPct = api / total;
  const delayedPct = delayed / total;
  const estimatedPct = aiInferred / total;
  const manualPct = manual / total;

  // grade — 추정값 비율 기반 (추정 많을수록 위험)
  let grade: RibbonRatios['grade'];
  if (estimatedPct >= ESTIMATED_DANGER_THRESHOLD) grade = 'WARN';
  else if (estimatedPct >= ESTIMATED_WARN_THRESHOLD) grade = 'OK';
  else grade = 'GOOD';

  return { empty: false, total, verifiedPct, externalPct, delayedPct, estimatedPct, manualPct, grade };
}

const SEGMENT_COLORS = {
  verified: 'bg-emerald-500',
  external: 'bg-cyan-500',
  delayed: 'bg-slate-400',
  estimated: 'bg-amber-500',
  manual: 'bg-violet-500',
};

const GRADE_LABEL = {
  GOOD: '신뢰도 양호',
  OK: '신뢰도 주의',
  WARN: '신뢰도 경계',
};

export function DataQualityRibbon({ counts, className, height = 3, forceShow }: DataQualityRibbonProps): ReactElement | null {
  // ADR-0103 PR-Verbose-Wiring-3: shouldShow('data-quality-ribbon') 분기 — verbose 한정 렌더 (사용자 #12 매트릭스)
  const v = useUIVerbosity();
  const shouldRender = forceShow !== undefined ? forceShow : v.shouldShow('data-quality-ribbon');
  if (!shouldRender) return null;

  const t = useUILang();
  const ratios = computeRibbonRatios(counts);

  if (ratios.empty) {
    return (
      <div
        className={cn('w-full bg-zinc-800/50 border-y border-white/5', className)}
        style={{ height: `${height}px` }}
        role="img"
        aria-label="데이터 품질 띠 — 데이터 없음"
        data-quality-ribbon-empty="true"
      />
    );
  }

  const segments: { pct: number; color: string; label: string; key: string }[] = [
    { pct: ratios.verifiedPct, color: SEGMENT_COLORS.verified, label: t.tier('VERIFIED'), key: 'verified' },
    { pct: ratios.externalPct, color: SEGMENT_COLORS.external, label: t.tier('EXTERNAL'), key: 'external' },
    { pct: ratios.delayedPct, color: SEGMENT_COLORS.delayed, label: t.tier('DELAYED'), key: 'delayed' },
    { pct: ratios.estimatedPct, color: SEGMENT_COLORS.estimated, label: t.tier('ESTIMATED'), key: 'estimated' },
    { pct: ratios.manualPct, color: SEGMENT_COLORS.manual, label: t.tier('MANUAL'), key: 'manual' },
  ];

  const ariaLabel = `데이터 품질 띠: ${GRADE_LABEL[ratios.grade]} (${ratios.total} 항목, ` +
    segments
      .filter(s => s.pct > 0)
      .map(s => `${s.label} ${Math.round(s.pct * 100)}%`)
      .join(', ') + ')';

  return (
    <div
      className={cn('w-full flex border-y border-white/5', className)}
      style={{ height: `${height}px` }}
      role="img"
      aria-label={ariaLabel}
      title={ariaLabel}
      data-quality-ribbon-grade={ratios.grade}
    >
      {segments.map(s => (
        s.pct > 0 ? (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${s.pct * 100}%` }}
            data-quality-segment={s.key}
            data-quality-segment-pct={Math.round(s.pct * 100)}
            aria-hidden
          />
        ) : null
      ))}
    </div>
  );
}
