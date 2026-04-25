/**
 * @responsibility 클라이언트 시장 모드 5분류 hook — ADR-0016 PR-37 SSOT 사본
 */
import { useEffect, useState } from 'react';
import { isMarketOpen, isKstWeekend } from '../utils/marketTime';

/**
 * 서버 `MarketDataMode` 5값과 동일 의미. 절대 규칙 #3: 서버↔클라 직접 import 금지이므로
 * 클라이언트 자체 정의로 동기 사본을 둔다. ADR-0016 §2 표 참조.
 *
 * - LIVE_TRADING_DAY: 평일 09:00~15:30 KST 정규장
 * - AFTER_MARKET   : 평일 장 마감 후 ~ 다음날 09:00
 * - WEEKEND_CACHE  : 토·일
 * - HOLIDAY_CACHE  : 한국 공휴일 (현 phase 미구현 — 후속 PR 에서 캘린더 추가)
 * - DEGRADED       : Tier 1~2 모두 실패 + Tier 3+ 진입 — diagnostics 기반 override
 */
export type ClientMarketMode =
  | 'LIVE_TRADING_DAY'
  | 'AFTER_MARKET'
  | 'WEEKEND_CACHE'
  | 'HOLIDAY_CACHE'
  | 'DEGRADED';

/**
 * 시간대 기반 1차 판정. DEGRADED 는 응답 diagnostics 가 결정하므로 본 함수는
 * 시계만으로 결정 가능한 4값(LIVE_TRADING_DAY/AFTER_MARKET/WEEKEND_CACHE) 만 반환.
 * HOLIDAY_CACHE 는 캘린더 부재로 본 phase 에선 비활성 (타입만 노출).
 */
export function classifyClientMarketMode(now: Date = new Date()): ClientMarketMode {
  if (isMarketOpen(now)) return 'LIVE_TRADING_DAY';
  if (isKstWeekend(now)) return 'WEEKEND_CACHE';
  return 'AFTER_MARKET';
}

/**
 * 1분 주기 polling 으로 모드 변경(09:00 개장·15:30 마감) 자동 반영.
 * 컴포넌트 unmount 시 interval 해제.
 */
export function useMarketMode(): ClientMarketMode {
  const [mode, setMode] = useState<ClientMarketMode>(() => classifyClientMarketMode());
  useEffect(() => {
    const id = setInterval(() => setMode(classifyClientMarketMode()), 60_000);
    return () => clearInterval(id);
  }, []);
  return mode;
}
