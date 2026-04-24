/**
 * @responsibility 장외 시 "마지막 종가 · 다음 개장" 배너 — 정보 불일치 맥락 명시
 */
import type { ReactElement } from 'react';
import { Clock } from 'lucide-react';
import {
  classifySymbol,
  isMarketOpenFor,
  nextOpenAtFor,
  formatNextOpenKst,
  isKstWeekend,
} from '../../utils/marketTime';

interface OffHoursBannerProps {
  /** 기준 심볼 — 없으면 '^KS11' (KRX 디폴트). */
  symbol?: string;
  /** 추가 CSS class */
  className?: string;
}

/**
 * 장중이면 null 을 반환(렌더 안 함). 장외엔 다음 개장 시각 + 주말/평일 맥락 표시.
 * 현재가 0/공란 대신 "마지막 종가" 라는 맥락을 사용자에게 전달하는 역할.
 */
export function OffHoursBanner({ symbol = '^KS11', className = '' }: OffHoursBannerProps): ReactElement | null {
  const now = new Date();
  if (isMarketOpenFor(symbol, now)) return null;

  const market = classifySymbol(symbol);

  let nextOpenLabel: string;
  try {
    nextOpenLabel = formatNextOpenKst(nextOpenAtFor(symbol, now));
  } catch {
    nextOpenLabel = '—';
  }

  const phaseLabel = isKstWeekend(now) ? '주말 장외' : '장외';
  const marketLabel = market === 'KRX' ? 'KRX' : market === 'NYSE' ? 'NYSE' : 'TSE';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs ${className}`}>
      <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span className="text-amber-200/80">
        <b className="text-amber-200">{marketLabel} {phaseLabel}</b>
        <span className="mx-1 text-amber-200/40">·</span>
        표시값은 <b>마지막 종가 기준</b>
        <span className="mx-1 text-amber-200/40">·</span>
        다음 개장 <b>{nextOpenLabel}</b>
      </span>
    </div>
  );
}
