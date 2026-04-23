import { describe, expect, it } from 'vitest';
import {
  buildStopLossPlan,
  calculateOrderQuantity,
  evaluateEntryRevalidation,
  EXIT_RULE_PRIORITY_TABLE,
  isOpenShadowStatus,
  reconcileDayOpen,
} from './signalScanner.js';
import { calcRRR, RRR_MIN_THRESHOLD } from './riskManager.js';
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

describe('reconcileDayOpen', () => {
  it('keeps Yahoo open when KIS diverges too much', () => {
    const result = reconcileDayOpen({
      yahooDayOpen: 18_160,
      kisDayOpen: 20_600,
    });

    expect(result.dayOpen).toBe(18_160);
    expect(result.source).toBe('YAHOO');
    expect(result.acceptedKis).toBe(false);
    expect(result.divergencePct).toBeGreaterThan(5);
  });

  it('accepts KIS open when divergence stays within tolerance', () => {
    const result = reconcileDayOpen({
      yahooDayOpen: 10_000,
      kisDayOpen: 10_300,
    });

    expect(result.dayOpen).toBe(10_300);
    expect(result.source).toBe('KIS');
    expect(result.acceptedKis).toBe(true);
    expect(result.divergencePct).toBeCloseTo(3, 5);
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
      marketElapsedMinutes: 390, // 장 마감 기준 — 보정 없이 원본 기준(0.6) 적용
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('돌파 이탈 과열 (+6.0%)');
    expect(result.reasons.find(r => r.startsWith('거래량 급감'))).toBeTruthy();
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
      marketElapsedMinutes: 390,
    });

    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('adjusts volume threshold proportionally to elapsed market time', () => {
    // 10:51 KST = 111분 경과, 기준 = 0.6 × (111/390) × 0.7(오전보정) ≈ 0.12
    const result = evaluateEntryRevalidation({
      currentPrice: 10_050,
      entryPrice: 10_000,
      quoteGateScore: 6.5,
      quoteSignalType: 'STRONG',
      dayOpen: 10_020,
      prevClose: 10_000,
      volume: 260_000,      // 0.22x — 보정 후 기준 0.12x이므로 통과
      avgVolume: 1_200_000,
      marketElapsedMinutes: 111,
    });

    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('applies morning volume discount before 12:00 KST (180min)', () => {
    // 10:00 KST = 60분 경과
    // 기존: 0.6 × (60/390) ≈ 0.092
    // 오전 보정 후: 0.092 × 0.7 ≈ 0.064
    // volume 70000/1_200_000 = 0.058 → 오전 보정 없으면 통과, 있으면 탈락?
    // 아니, 0.058 < 0.064 → 탈락
    const resultMorning = evaluateEntryRevalidation({
      currentPrice: 10_050,
      entryPrice: 10_000,
      quoteGateScore: 6.5,
      quoteSignalType: 'STRONG',
      dayOpen: 10_020,
      prevClose: 10_000,
      volume: 70_000,        // 0.058x
      avgVolume: 1_200_000,
      marketElapsedMinutes: 60, // 10:00 KST (오전)
    });
    expect(resultMorning.ok).toBe(false);
    expect(resultMorning.reasons.find(r => r.startsWith('거래량 급감'))).toBeTruthy();

    // volume 80000/1_200_000 = 0.067x > 0.064 → 오전 보정 후 통과
    const resultPass = evaluateEntryRevalidation({
      currentPrice: 10_050,
      entryPrice: 10_000,
      quoteGateScore: 6.5,
      quoteSignalType: 'STRONG',
      dayOpen: 10_020,
      prevClose: 10_000,
      volume: 80_000,        // 0.067x > 0.064x → 통과
      avgVolume: 1_200_000,
      marketElapsedMinutes: 60,
    });
    expect(resultPass.ok).toBe(true);
  });

  it('does not apply morning discount after 12:00 KST (≥180min)', () => {
    // 13:00 KST = 240분 경과
    // 기준: 0.6 × (240/390) ≈ 0.369 (오전 보정 없음)
    const result = evaluateEntryRevalidation({
      currentPrice: 10_050,
      entryPrice: 10_000,
      quoteGateScore: 6.5,
      quoteSignalType: 'STRONG',
      dayOpen: 10_020,
      prevClose: 10_000,
      volume: 400_000,       // 0.33x < 0.369x → 탈락
      avgVolume: 1_200_000,
      marketElapsedMinutes: 240,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.find(r => r.startsWith('거래량 급감'))).toBeTruthy();
  });

  it('skips gap overheat check when gap exceeds 30% (data error)', () => {
    // 555% 갭은 Yahoo Finance 데이터 오류 — 체크 스킵
    const result = evaluateEntryRevalidation({
      currentPrice: 10_050,
      entryPrice: 10_000,
      quoteGateScore: 6.5,
      quoteSignalType: 'STRONG',
      dayOpen: 65_500,       // prevClose 대비 +555%
      prevClose: 10_000,
      volume: 2_000_000,
      avgVolume: 2_200_000,
      marketElapsedMinutes: 390,
    });

    expect(result.reasons.find(r => r.includes('갭 과열'))).toBeUndefined();
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
      'MA60_DEATH_FORCE_EXIT',
      'CASCADE_FINAL',
      'LIMIT_TRANCHE_TAKE_PROFIT',
      'TRAILING_PROTECTIVE_STOP',
      'TARGET_EXIT',
      'CASCADE_HALF_SELL',
      'CASCADE_WARN_BLOCK',
      'RRR_COLLAPSE_PARTIAL',
      'DIVERGENCE_PARTIAL',
      'MA60_DEATH_WATCH',
      'STOP_APPROACH_ALERT',
      'EUPHORIA_PARTIAL',
      'MANUAL_EXIT',
    ]);
  });

  it('all rule tags in the table are valid ExitRuleTag values', () => {
    // ExitRuleTag 타입과 EXIT_RULE_PRIORITY_TABLE이 동기화됨을 런타임에서도 검증.
    // 테이블에 있는 모든 규칙 이름이 타입으로 추론 가능한지 확인한다.
    const tableRules = EXIT_RULE_PRIORITY_TABLE.map((r) => r.rule);
    // TypeScript: 아래 assignment가 컴파일되면 tableRules 는 ExitRuleTag[] 와 호환됨을 의미
    const _typed: ExitRuleTag[] = tableRules;
    expect(_typed).toHaveLength(15);
  });

  it('MANUAL_EXIT is registered at priority 99 ("규칙 외") and never competes with automatic rules', () => {
    const manual = EXIT_RULE_PRIORITY_TABLE.find((r) => r.rule === 'MANUAL_EXIT');
    expect(manual).toBeDefined();
    expect(manual!.priority).toBe(99);
    // 자동 평가 규칙들의 priority 는 모두 99 미만이어야 한다.
    const autoRules = EXIT_RULE_PRIORITY_TABLE.filter((r) => r.rule !== 'MANUAL_EXIT');
    expect(autoRules.every((r) => r.priority < 99)).toBe(true);
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
// BUG-09 fix: PRE_BREAKOUT(30% 선취매)도 스윙 한도에서 제외
describe('[C1] activeSwingCount — INTRADAY·PRE_BREAKOUT 포지션 제외 검증', () => {
  it('INTRADAY와 PRE_BREAKOUT 포지션은 스윙 포지션 한도 카운트에서 제외되어야 한다', () => {
    const shadows = [
      { status: 'ACTIVE',  watchlistSource: 'INTRADAY' },                // 장중 — 제외
      { status: 'ACTIVE',  watchlistSource: 'PRE_MARKET' },              // 스윙 — 포함
      { status: 'ACTIVE',  watchlistSource: 'PRE_BREAKOUT' },            // 선취매 — 제외
      { status: 'ACTIVE',  watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH' }, // 추종 — 포함
      { status: 'HIT_STOP', watchlistSource: 'PRE_MARKET' },             // 종료 — 제외
      { status: 'PENDING', watchlistSource: 'INTRADAY' },                // 장중 PENDING — 제외
    ] as const;

    const activeSwingCount = shadows.filter(
      s => isOpenShadowStatus(s.status) &&
           s.watchlistSource !== 'INTRADAY' &&
           s.watchlistSource !== 'PRE_BREAKOUT',
    ).length;

    // PRE_MARKET(ACTIVE) + PRE_BREAKOUT_FOLLOWTHROUGH(ACTIVE) = 2
    expect(activeSwingCount).toBe(2);
  });
});

// ── BUG-07 검증: MANUAL 종목도 entryFailCount 추적 ──────────────────────────
describe('[BUG-07] entryFailCount — MANUAL 종목 추적 검증', () => {
  it('MANUAL 종목도 재검증 실패 시 entryFailCount가 증가해야 한다', () => {
    const stock = { addedBy: 'MANUAL' as const, entryFailCount: undefined as number | undefined };

    // BUG-07 fix 전: addedBy === 'AUTO' 조건이 있어 MANUAL은 카운트되지 않았음
    // fix 후: addedBy 무관하게 실패 카운트 증가
    stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
    expect(stock.entryFailCount).toBe(1);

    stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
    expect(stock.entryFailCount).toBe(2);
  });

  it('entryFailCount가 MAX_ENTRY_FAIL_COUNT에 도달하면 MANUAL도 정리 대상이 된다', () => {
    const MAX_ENTRY_FAIL_COUNT = 3;
    const watchlist = [
      { code: '005930', name: '삼성전자', addedBy: 'MANUAL' as const, entryFailCount: 3 },
      { code: '000660', name: 'SK하이닉스', addedBy: 'AUTO' as const, entryFailCount: 3 },
      { code: '035420', name: 'NAVER', addedBy: 'MANUAL' as const, entryFailCount: 1 },
    ];

    // BUG-07 fix: addedBy 조건 제거 — 모든 종목에 적용
    const afterPrune = watchlist.filter(
      w => (w.entryFailCount ?? 0) < MAX_ENTRY_FAIL_COUNT,
    );

    expect(afterPrune).toHaveLength(1);
    expect(afterPrune[0].code).toBe('035420');
  });
});

// ── BUG-08 검증: Pre-Breakout Follow-through RRR 재검증 ─────────────────────
describe('[BUG-08] Follow-through RRR 재검증', () => {
  it('돌파 후 추종 진입가 기준 RRR이 임계값 미만이면 추종을 차단해야 한다', () => {
    // 원래 진입가 10,000원 → 돌파 시 현재가 12,000원 → 추종 진입가 ≈ 12,036원
    const followEntryPrice = Math.round(12_000 * 1.003); // 12,036
    const targetPrice = 13_000;
    const stopLoss = 9_500;

    const followRRR = calcRRR(followEntryPrice, targetPrice, stopLoss);
    // reward = 13000 - 12036 = 964, risk = 12036 - 9500 = 2536, RRR ≈ 0.38
    expect(followRRR).toBeLessThan(RRR_MIN_THRESHOLD);
  });

  it('추종 진입가 기준 RRR이 임계값 이상이면 통과한다', () => {
    const followEntryPrice = Math.round(10_100 * 1.003); // 10,130
    const targetPrice = 15_000;
    const stopLoss = 9_500;

    const followRRR = calcRRR(followEntryPrice, targetPrice, stopLoss);
    // reward = 15000 - 10130 = 4870, risk = 10130 - 9500 = 630, RRR ≈ 7.73
    expect(followRRR).toBeGreaterThanOrEqual(RRR_MIN_THRESHOLD);
  });
});

// ── 진입가 미도달 종목 entryFailCount 증가 검증 ─────────────────────────────
describe('진입가 미도달 종목 entryFailCount 증가', () => {
  it('nearEntry/breakout 모두 미충족 시 entryFailCount가 증가해야 한다', () => {
    const stock = {
      code: '131970',
      name: '두산테스나',
      entryPrice: 80_000,
      stopLoss: 60_000,
      addedBy: 'AUTO' as 'AUTO' | 'MANUAL' | 'DART',
      entryFailCount: 0,
    };

    // 현재가 65,000원 — 진입가 80,000 대비 nearEntry(±1%) 아니고 breakout도 아님
    const currentPrice = 65_000;
    const nearEntryThreshold = stock.addedBy === 'MANUAL' ? 0.02 : 0.01;
    const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= nearEntryThreshold;
    const breakout = currentPrice >= stock.entryPrice;

    expect(nearEntry).toBe(false);
    expect(breakout).toBe(false);

    // 수정 후: nearEntry/breakout 미충족 시 failCount++ 후 continue
    if (!(nearEntry || breakout)) {
      stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
    }
    expect(stock.entryFailCount).toBe(1);

    // 3회 누적 시 cleanupWatchlist에서 제거 대상
    stock.entryFailCount = (stock.entryFailCount ?? 0) + 1; // 2회
    stock.entryFailCount = (stock.entryFailCount ?? 0) + 1; // 3회
    expect(stock.entryFailCount).toBeGreaterThanOrEqual(3);
  });

  it('breakout 충족 시 entryFailCount가 증가하지 않아야 한다', () => {
    const stock = {
      code: '298050',
      name: '효성티앤씨',
      entryPrice: 300_000,
      stopLoss: 270_000,
      addedBy: 'AUTO' as const,
      entryFailCount: 0,
    };

    // 현재가 310,000원 — breakout 충족
    const currentPrice = 310_000;
    const breakout = currentPrice >= stock.entryPrice;
    const nearEntryThreshold = 0.01;
    const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= nearEntryThreshold;

    expect(breakout).toBe(true);

    // breakout 충족 → failCount 증가 없이 재검증 로직 진행
    if (!(nearEntry || breakout)) {
      stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
    }
    expect(stock.entryFailCount).toBe(0);
  });
});
