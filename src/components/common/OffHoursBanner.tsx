/**
 * @responsibility 장외/주말/공휴일 배너 — MarketDataMode 5분류 메시지 (ADR-0016 PR-37)
 */
import type { ReactElement } from 'react';
import { Clock } from 'lucide-react';
import {
  classifySymbol,
  isMarketOpenFor,
  nextOpenAtFor,
  formatNextOpenKst,
} from '../../utils/marketTime';
import { useMarketMode } from '../../hooks/useMarketMode';

interface OffHoursBannerProps {
  /** 기준 심볼 — 없으면 '^KS11' (KRX 디폴트). */
  symbol?: string;
  /** 추가 CSS class */
  className?: string;
}

/**
 * 장중이면 null 을 반환(렌더 안 함). 장외엔 다음 개장 시각 + 시장모드 5분류 라벨 표시.
 *
 * MarketDataMode (서버 SSOT 와 동기 사본):
 * - LIVE_TRADING_DAY: 표시 안 함
 * - AFTER_MARKET   : "KRX 장외" (파랑 톤)
 * - WEEKEND_CACHE  : "주말 — 직전 거래일 데이터"
 * - HOLIDAY_CACHE  : "공휴일 — 캐시 데이터" (현 phase 미감지)
 * - DEGRADED       : "외부 소스 다중 실패" (다른 컴포넌트가 override 하여 사용)
 */
export function OffHoursBanner({ symbol = '^KS11', className = '' }: OffHoursBannerProps): ReactElement | null {
  const now = new Date();
  const mode = useMarketMode();
  if (isMarketOpenFor(symbol, now)) return null;
  const market = classifySymbol(symbol);

  let nextOpenLabel: string;
  try {
    nextOpenLabel = formatNextOpenKst(nextOpenAtFor(symbol, now));
  } catch {
    nextOpenLabel = '—';
  }

  const phaseLabel = (() => {
    if (mode === 'WEEKEND_CACHE') return '주말 — 직전 거래일 데이터';
    if (mode === 'HOLIDAY_CACHE') return '공휴일 — 캐시 데이터';
    return '장외 — 마지막 종가 기준';
  })();
  const marketLabel = market === 'KRX' ? 'KRX' : market === 'NYSE' ? 'NYSE' : 'TSE';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs ${className}`}>
      <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span className="text-amber-200/80">
        <b className="text-amber-200">{marketLabel} {phaseLabel}</b>
        <span className="mx-1 text-amber-200/40">·</span>
        다음 개장 <b>{nextOpenLabel}</b>
      </span>
    </div>
  );
}
