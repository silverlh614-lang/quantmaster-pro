// @responsibility 가격 표시 정본 SSOT 컴포넌트 — usePriceCanon hook 기반 단일 렌더
/**
 * PriceDisplay — 모든 dashboard 가격 표시의 단일 컴포넌트.
 *
 * 산재된 stock.currentPrice 직접 렌더링(WatchlistHeader/Card/Modal 등)을 이
 * 컴포넌트로 통합. usePriceCanon hook 으로 Naver 정본 조회, 가드 단일 적용,
 * placeholder 표현 일관.
 *
 * variant:
 *   - card    : TOP 3 LEADERS / WatchlistCard 큰 가격
 *   - detail  : StockDetailModal / DeepAnalysisModal 헤더
 *   - compact : 인라인 (목록 셀)
 *
 * 자동매매 UI(src/components/autoTrading) 는 별도 도메인 — 본 컴포넌트 미사용.
 */
import React from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '../../ui/cn';
import { ConfidenceBadge } from './ConfidenceBadge';
import { usePriceCanon } from '../../hooks/usePriceCanon';

type PriceDisplayVariant = 'card' | 'detail' | 'compact';

interface PriceDisplayProps {
  /** KRX 6자리 종목 코드 (e.g., '000660'). */
  code: string | null | undefined;
  /** 표시 사이즈/스타일 variant. */
  variant?: PriceDisplayVariant;
  /** ConfidenceBadge 노출 여부 (기본 true). */
  showBadge?: boolean;
  /** 가격 좌측 trending 아이콘 노출 (card variant 기본 true). */
  showTrendIcon?: boolean;
  /**
   * fallback 가격 — Naver 실패 시 호출자가 가진 이전 KIS REALTIME 값 (있으면).
   * stock.dataSourceType==='REALTIME' 일 때만 stock.currentPrice 전달.
   * LLM 환각/Yahoo 잔재값 전달 금지.
   */
  fallbackKisPrice?: number | null;
  /** 추가 className. */
  className?: string;
}

const VARIANT_PRICE_CLASS: Record<PriceDisplayVariant, string> = {
  card: 'text-lg font-black',
  detail: 'text-2xl font-black font-num',
  compact: 'text-sm font-bold font-num',
};

const VARIANT_PLACEHOLDER_CLASS: Record<PriceDisplayVariant, string> = {
  card: 'text-lg font-black text-theme-text-muted',
  detail: 'text-2xl font-black text-theme-text-muted font-num',
  compact: 'text-sm font-bold text-theme-text-muted font-num',
};

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  code,
  variant = 'card',
  showBadge = true,
  showTrendIcon,
  fallbackKisPrice,
  className,
}) => {
  const { price, source, isFetching } = usePriceCanon(code, {
    fallbackPrice: fallbackKisPrice ?? undefined,
    fallbackSource: 'REALTIME',
  });

  const trendIcon = showTrendIcon ?? variant === 'card';
  const hasPrice = price !== null && price > 0;
  // 배지 type: NAVER → 'NAVER', REALTIME → 'REALTIME', NONE → 'STALE'
  const badgeType: 'NAVER' | 'REALTIME' | 'STALE' = source === 'NAVER'
    ? 'NAVER'
    : source === 'REALTIME'
      ? 'REALTIME'
      : 'STALE';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {trendIcon && <TrendingUp className="w-4 h-4 text-green-400 shrink-0" />}
      {hasPrice ? (
        <span className={cn(VARIANT_PRICE_CLASS[variant], 'text-theme-text')}>
          ₩{(price as number).toLocaleString()}
        </span>
      ) : (
        <span
          className={VARIANT_PLACEHOLDER_CLASS[variant]}
          title={isFetching
            ? 'Naver 가격 조회 중'
            : 'KIS·Naver 가격 소스 미확보 — 자동 재시도 중'}
        >
          {isFetching ? '조회 중...' : '갱신 중...'}
        </span>
      )}
      {showBadge && <ConfidenceBadge type={badgeType} />}
    </div>
  );
};
