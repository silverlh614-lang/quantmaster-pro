/**
 * @responsibility 시장 시각·MarketDataMode 를 AutoTradeContext 5분기로 매핑하는 클라이언트 SSOT 훅
 */
import { useEffect, useState } from 'react';
import { isKstWeekend, isMarketOpen } from '../utils/marketTime';
import type { ClientMarketMode } from './useMarketMode';
import { classifyClientMarketMode } from './useMarketMode';

/**
 * AutoTrade 페이지가 컴포넌트 정렬 우선순위를 결정할 때 사용하는 5 컨텍스트.
 * ADR-0049 §2.1 표 SSOT.
 */
export type AutoTradeContext =
  | 'PRE_MARKET'
  | 'LIVE_MARKET'
  | 'POST_MARKET'
  | 'OVERNIGHT'
  | 'WEEKEND_HOLIDAY';

const PRE_MARKET_OPEN_MIN = 8 * 60 + 30; // 510 — KST 08:30
const MARKET_OPEN_MIN = 9 * 60;          // 540 — KST 09:00
const MARKET_CLOSE_MIN = 15 * 60 + 30;   // 930 — KST 15:30
const POST_MARKET_END_MIN = 16 * 60;     // 960 — KST 16:00

/**
 * KST 분 단위 시각 (0~1439). UTC Date 를 9시간 shift 후 시·분만 추출.
 */
function kstMinutes(now: Date): number {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/**
 * MarketDataMode + KST 시각 → AutoTradeContext 매핑 (순수 함수, 테스트 가능).
 *
 * ADR-0049 §2.2 표:
 * - LIVE_TRADING_DAY (`isMarketOpen=true`) → 09:00~15:30 인 LIVE_MARKET. 15:30~16:00 은 POST_MARKET 이지만
 *   `isMarketOpen` 자체가 09:00 ≤ t < 15:30 이므로 POST_MARKET 분기는 별도 시각 검사가 필요.
 * - AFTER_MARKET 분기에서 KST 08:30~08:59 는 PRE_MARKET 으로 승격 (장 시작 직전 워치리스트 우선).
 * - WEEKEND_CACHE / HOLIDAY_CACHE → WEEKEND_HOLIDAY.
 * - DEGRADED → LIVE_MARKET (안전 fallback — 모니터링 우선).
 */
export function classifyAutoTradeContext(
  mode: ClientMarketMode,
  now: Date = new Date(),
): AutoTradeContext {
  if (mode === 'WEEKEND_CACHE' || mode === 'HOLIDAY_CACHE') return 'WEEKEND_HOLIDAY';
  if (mode === 'DEGRADED') return 'LIVE_MARKET';
  // 평일 분기 (LIVE_TRADING_DAY 또는 AFTER_MARKET)
  const mins = kstMinutes(now);
  // 주말 시각이 잘못 들어왔을 때 안전망
  if (isKstWeekend(now)) return 'WEEKEND_HOLIDAY';
  if (mins >= MARKET_OPEN_MIN && mins < MARKET_CLOSE_MIN) return 'LIVE_MARKET';
  if (mins >= MARKET_CLOSE_MIN && mins < POST_MARKET_END_MIN) return 'POST_MARKET';
  if (mins >= PRE_MARKET_OPEN_MIN && mins < MARKET_OPEN_MIN) return 'PRE_MARKET';
  return 'OVERNIGHT';
}

/**
 * `now` 만으로 AutoTradeContext 를 즉시 계산 (mode 도 내부에서 도출).
 * 컴포넌트가 mode 와 context 를 동시에 필요로 하지 않으면 본 함수 사용 권장.
 */
export function classifyAutoTradeContextFromNow(now: Date = new Date()): AutoTradeContext {
  // 휴장 분기는 `isMarketOpen=false` 이므로 classifyClientMarketMode 가 AFTER_MARKET / WEEKEND_CACHE 로 분기.
  const mode = classifyClientMarketMode(now);
  return classifyAutoTradeContext(mode, now);
}

// 테스트 결정성 보장용 export — 프로덕션 코드에서 직접 호출 금지.
export const __MARKET_OPEN_GUARD__ = isMarketOpen;

/**
 * 1분 polling 으로 컨텍스트 변경(08:30 / 09:00 / 15:30 / 16:00) 자동 반영.
 * 컴포넌트 unmount 시 interval 해제.
 */
export function useAutoTradeContext(): AutoTradeContext {
  const [ctx, setCtx] = useState<AutoTradeContext>(() => classifyAutoTradeContextFromNow());
  useEffect(() => {
    const id = setInterval(() => setCtx(classifyAutoTradeContextFromNow()), 60_000);
    return () => clearInterval(id);
  }, []);
  return ctx;
}
