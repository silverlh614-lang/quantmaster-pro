// @responsibility ExitEngine rule 단위 테스트용 mock factory + ctx builder 공용 헬퍼
/**
 * __tests__/_testHelpers.ts — exit rule 단위 테스트 공용 헬퍼 (ADR-0028 §M5 준비).
 *
 * 각 rule.test.ts 는 자신만의 vi.mock() 블록을 선언하지만 (vitest 호이스팅 규칙),
 * 다음 두 파일 수준 헬퍼는 공유한다:
 *   - makeMockShadow: ServerShadowTrade 기본값 + override
 *   - makeMockCtx:    ExitContext 기본값 + override (returnPct 자동 계산)
 *
 * 이 파일 자체는 테스트가 아니므로 vitest 가 자동 발견하지 않도록 .test.ts 확장자
 * 사용 금지. _testHelpers.ts 파일명 prefix 로 vi 자동 매칭에서 제외.
 */

import type { ServerShadowTrade } from '../../../../persistence/shadowTradeRepo.js';
import type { RegimeLevel } from '../../../../../src/types/core.js';
import type { ExitContext } from '../../types.js';

/**
 * 테스트용 ServerShadowTrade 기본값.
 * - shadowEntryPrice: 100, quantity: 100, originalQuantity: 100
 * - stopLoss: 90 (-10%), targetPrice: 120 (+20%)
 * - status: 'ACTIVE', mode: 'SHADOW' (KIS 가상 체결로 reserveSell 가 SHADOW 분기)
 * - fills: [] (BUY fill 백필은 orchestrator 책임 — rule 단위 테스트에는 불필요)
 *
 * override 인자로 임의 필드 덮어쓰기 가능. PR-19 attribution 에 필요한 entryRegime
 * 같은 메타도 자유롭게 override 한다.
 */
export function makeMockShadow(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id:               'TEST-SHADOW-1',
    stockCode:        '005930',
    stockName:        '삼성전자',
    signalTime:       '2026-04-26T00:00:00.000Z',
    signalPrice:      100,
    shadowEntryPrice: 100,
    quantity:         100,
    originalQuantity: 100,
    stopLoss:         90,
    targetPrice:      120,
    status:           'ACTIVE',
    mode:             'SHADOW',
    entryRegime:      'R2_BULL',
    fills:            [],
    ...overrides,
  };
}

/**
 * 테스트용 ExitContext 기본값.
 * - returnPct: shadow.shadowEntryPrice 와 currentPrice 로부터 자동 계산 (override 가능)
 * - currentRegime: 'R2_BULL' 기본
 * - hardStopLoss: shadow.hardStopLoss ?? shadow.stopLoss
 *
 * 예: makeMockCtx({ shadow: makeMockShadow({ stopLoss: 50 }), currentPrice: 50 })
 *     → returnPct = -50, hardStopLoss = 50.
 */
export function makeMockCtx(overrides: Partial<ExitContext> = {}): ExitContext {
  const shadow = overrides.shadow ?? makeMockShadow();
  const currentPrice = overrides.currentPrice ?? shadow.shadowEntryPrice;
  const returnPct = overrides.returnPct ?? ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
  return {
    shadow,
    currentPrice,
    returnPct,
    currentRegime:    overrides.currentRegime ?? ('R2_BULL' as RegimeLevel),
    initialStopLoss:  overrides.initialStopLoss ?? (shadow.initialStopLoss ?? shadow.stopLoss),
    regimeStopLoss:   overrides.regimeStopLoss ?? (shadow.regimeStopLoss ?? shadow.stopLoss),
    hardStopLoss:     overrides.hardStopLoss ?? (shadow.hardStopLoss ?? shadow.stopLoss),
    resolvedNow:      overrides.resolvedNow ?? new Set<string>(),
  };
}

/**
 * SHADOW 모드 SellOrderResult — placeKisSellOrder mock 의 기본 반환.
 * SHADOW 분기에서 reserveSell 이 즉시 CONFIRMED 로 fill 을 기록하도록 한다.
 */
export const SHADOW_OK_RESULT = { ordNo: null, placed: false, outcome: 'SHADOW_ONLY' as const };

/**
 * LIVE 주문 접수 실패 SellOrderResult — FAILED 분기 회귀 테스트용.
 * reserveSell 이 'FAILED' kind 를 반환해 호출자가 dedupe 플래그 롤백을 수행하는지 검증.
 */
export const LIVE_FAILED_RESULT = {
  ordNo: null, placed: false,
  outcome: 'LIVE_FAILED' as const,
  failureReason: 'KIS_ORDER_REJECTED_TEST',
};

/**
 * LIVE 주문 접수 성공 SellOrderResult — PROVISIONAL fill + addSellOrder 호출 검증용.
 */
export function makeLiveOrderedResult(ordNo = 'ORDER-TEST-1') {
  return { ordNo, placed: true, outcome: 'LIVE_ORDERED' as const };
}
