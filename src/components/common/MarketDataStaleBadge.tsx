/**
 * @responsibility 시장 지표 stale 필드 배지 — X-Field-Stale 헤더 시각화 (ADR-0069)
 *
 * useMarketStore.staleFields 를 직접 read 해서 빈 배열이면 미렌더, ≥1 이면 amber 배지.
 * 호버/클릭 시 stale 필드 이름 목록 노출. 자동매매 진입 차단 (ADR-0068) 와 별개의
 * "데이터 신선도 인지" UI — 사용자가 macroState/market-indicators 의 stale 상태를
 * 화면에서 즉시 확인.
 *
 * 배치 권장 위치:
 *   - MarketOverviewHeader (StatusBanner / MarketRegimeBanner 인접)
 *   - MarketDashboard 헤더
 *
 * 화면 출력 예: "⚠️ 시장 데이터 3개 stale" (호버 → vix, us10yYield, kospi)
 */
import { useMemo, useState } from 'react';
import { useMarketStore } from '../../stores';

/** 필드 이름 한국어 라벨 매핑 — UI 가독성. */
const FIELD_LABELS: Record<string, string> = {
  vix: 'VIX',
  us10yYield: '미국 10Y',
  usShortRate: '미국 단기금리',
  samsungIri: '삼성 IRI',
  vkospi: 'VKOSPI',
  vkospiDayChange: 'VKOSPI 당일',
  vkospi5dTrend: 'VKOSPI 5일',
  kospi: 'KOSPI',
  kosdaq: 'KOSDAQ',
  ewyReturn: 'EWY 수익률',
  mtumReturn: 'MTUM 수익률',
};

function labelOf(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export interface MarketDataStaleBadgeProps {
  /** 시각 표시 위치 (compact: inline / full: block). 기본 compact. */
  variant?: 'compact' | 'full';
  className?: string;
}

export function MarketDataStaleBadge({ variant = 'compact', className = '' }: MarketDataStaleBadgeProps) {
  const staleFields = useMarketStore((s) => s.staleFields);
  const [expanded, setExpanded] = useState(false);

  const labelText = useMemo(() => {
    if (staleFields.length === 0) return '';
    return staleFields.map(labelOf).join(', ');
  }, [staleFields]);

  if (staleFields.length === 0) return null;

  const baseClasses =
    variant === 'compact'
      ? 'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md font-medium'
      : 'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg font-medium';

  const colorClasses = 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700';

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className={`${baseClasses} ${colorClasses} ${className}`}
      title={`stale 필드: ${labelText}`}
      data-testid="market-data-stale-badge"
      data-stale-count={staleFields.length}
      aria-label={`시장 데이터 ${staleFields.length}개 항목이 stale 상태`}
    >
      <span aria-hidden>⚠️</span>
      <span>시장 데이터 {staleFields.length}개 stale</span>
      {expanded && (
        <span className="ml-1 text-amber-700 dark:text-amber-300">({labelText})</span>
      )}
    </button>
  );
}
