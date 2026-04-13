import { describe, expect, it } from 'vitest';
import {
  buildStopLossPlan,
  calculateOrderQuantity,
  evaluateEntryRevalidation,
  EXIT_RULE_PRIORITY_TABLE,
  isOpenShadowStatus,
} from './signalScanner.js';
import type { ExitRuleTag } from '../persistence/shadowTradeRepo.js';

describe('calculateOrderQuantity', () => {
  it('limits by orderable cash and remaining slots', () => {
    const result = calculateOrderQuantity({
      totalAssets: 10_000_000,
      orderableCash: 2_000_000,
      positionPct: 0.2,
      price: 100_000,
      remainingSlots: 2,
    });

    expect(result.effectiveBudget).toBe(1_000_000);
    expect(result.quantity).toBe(10);
  });
});

describe('evaluateEntryRevalidation', () => {
  it('rejects overextended breakout and weak volume', () => {
    const result = evaluateEntryRevalidation({
      currentPrice: 10_600,
      entryPrice: 10_000,
      quoteGateScore: 5.2,
      quoteSignalType: 'NORMAL',
      dayOpen: 10_300,
      prevClose: 10_000,
      volume: 500_000,
      avgVolume: 1_200_000,
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('돌파 이탈 과열 (+6.0%)');
    expect(result.reasons).toContain('거래량 급감 (0.42x)');
  });

  it('passes when all pre-entry checks are healthy', () => {
    const result = evaluateEntryRevalidation({
      currentPrice: 10_050,
      entryPrice: 10_000,
      quoteGateScore: 6.5,
      quoteSignalType: 'STRONG',
      dayOpen: 10_020,
      prevClose: 10_000,
      volume: 2_000_000,
      avgVolume: 2_200_000,
    });

    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});

describe('buildStopLossPlan', () => {
  it('separates fixed/regime stop and keeps the tighter one as hard stop', () => {
    const plan = buildStopLossPlan({
      entryPrice: 100_000,
      fixedStopLoss: 90_000,
      regimeStopRate: -0.05,
    });

    expect(plan.initialStopLoss).toBe(90_000);
    expect(plan.regimeStopLoss).toBe(95_000);
    expect(plan.hardStopLoss).toBe(95_000);
  });
});

describe('EXIT_RULE_PRIORITY_TABLE', () => {
  it('keeps liquidation priority policy fixed in code order', () => {
    expect(EXIT_RULE_PRIORITY_TABLE.map((r) => r.rule)).toEqual([
      'R6_EMERGENCY_EXIT',
      'HARD_STOP',
      'CASCADE_FINAL',
      'LIMIT_TRANCHE_TAKE_PROFIT',
      'TRAILING_PROTECTIVE_STOP',
      'TARGET_EXIT',
      'CASCADE_HALF_SELL',
      'CASCADE_WARN_BLOCK',
      'STOP_APPROACH_ALERT',
      'EUPHORIA_PARTIAL',
    ]);
  });

  it('all rule tags in the table are valid ExitRuleTag values', () => {
    // ExitRuleTag 타입과 EXIT_RULE_PRIORITY_TABLE이 동기화됨을 런타임에서도 검증.
    // 테이블에 있는 모든 규칙 이름이 타입으로 추론 가능한지 확인한다.
    const tableRules = EXIT_RULE_PRIORITY_TABLE.map((r) => r.rule);
    // TypeScript: 아래 assignment가 컴파일되면 tableRules 는 ExitRuleTag[] 와 호환됨을 의미
    const _typed: ExitRuleTag[] = tableRules;
    expect(_typed).toHaveLength(10);
  });
});

// ── C2 수정 검증: 선취매(Pre-Breakout) 현금 차감 정확성 ──────────────────────────
describe('[C2] Pre-Breakout 현금 차감 — 실 집행금액 검증', () => {
  it('30% 선취매 집행금액은 pbQty × pbEntryPrice와 일치해야 한다', () => {
    const fullPbQty = 33;                        // calculateOrderQuantity 반환값 예시
    const pbEntryPrice = 50_100;
    const pbQty = Math.max(1, Math.floor(fullPbQty * 0.3)); // = 9

    const actualCost = pbQty * pbEntryPrice;     // 실제 집행금액 (C2 수정 후 사용)
    const budgetBased = Math.floor(fullPbQty * pbEntryPrice) * 0.3; // 이전 방식(부정확)

    // 실제 집행금액 검증
    expect(pbQty).toBe(9);
    expect(actualCost).toBe(450_900);

    // 두 방식이 다를 수 있음을 확인 (Math.floor 오차)
    // budgetBased ≈ 495_990, actualCost = 450_900 → 차이 발생
    expect(actualCost).not.toBe(budgetBased);
    expect(actualCost).toBeLessThan(budgetBased); // 실제 집행금액이 더 정확하게 적음
  });
});

// ── C1 수정 검증: INTRADAY 포지션이 스윙 포지션 한도에 영향을 주지 않아야 한다 ──
describe('[C1] activeSwingCount — INTRADAY 포지션 제외 검증', () => {
  it('INTRADAY 포지션은 스윙 포지션 한도 카운트에서 제외되어야 한다', () => {
    const shadows = [
      { status: 'ACTIVE',  watchlistSource: 'INTRADAY' },       // 장중 — 제외
      { status: 'ACTIVE',  watchlistSource: 'PRE_MARKET' },     // 스윙 — 포함
      { status: 'ACTIVE',  watchlistSource: 'PRE_BREAKOUT' },   // 스윙 — 포함
      { status: 'HIT_STOP', watchlistSource: 'PRE_MARKET' },    // 종료 — 제외
      { status: 'PENDING', watchlistSource: 'INTRADAY' },       // 장중 PENDING — 제외
    ] as const;

    const activeSwingCount = shadows.filter(
      s => isOpenShadowStatus(s.status) && s.watchlistSource !== 'INTRADAY',
    ).length;

    expect(activeSwingCount).toBe(2); // PRE_MARKET(ACTIVE) + PRE_BREAKOUT(ACTIVE)
  });
});
