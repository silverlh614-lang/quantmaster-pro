/**
 * @responsibility ADR-0449 — Pre-Breakout WAIT Liveness Policy 회귀 테스트.
 *
 * 검증 대상 (사용자 §"권장 테스트" 50+ 케이스):
 *   - 7-state 결정 트리 (RETRY_ELIGIBLE / PRICE_TOO_FAR / VOLUME_WEAK /
 *     GATE_RECHECK_FAILED / COOLDOWN / SHADOW_ONLY / REJECTED)
 *   - 9-value reason union 정합
 *   - increaseFailCount: false literal type 강제 (ADR-0115 보호)
 *   - waitCount / recheckFailCount 별도 카운터 분리
 *   - KIS-WS priority adjustment (ADR-0437 연동)
 *   - 우선순위 결정 (riskBlocked > quoteStale > recheckFailed > cooldown > shadowOnly > priceTooFar > volumeWeak > retryEligible)
 *   - ENV PRE_BREAKOUT_WAIT_POLICY_DISABLED 우회 (default OFF)
 *   - summarizePreBreakoutWaitDecisions 분포 합산
 *   - formatPreBreakoutWaitSummarySection /scan_blockers 출력
 *   - 정적 grep 가드 (KIS 주문 함수 import 0건 / outbound 0건 / scanDiagnostics wiring)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  evaluatePreBreakoutWait,
  computePriceDistancePct,
  summarizePreBreakoutWaitDecisions,
  formatPreBreakoutWaitSummarySection,
  isPreBreakoutWaitPolicyDisabled,
  PRE_BREAKOUT_WAIT_POLICY,
  type PreBreakoutWaitDecision,
  type PreBreakoutWaitInput,
} from './preBreakoutWaitPolicy.js';

const POLICY_PATH = resolve(__dirname, 'preBreakoutWaitPolicy.ts');
const POLICY_SRC = readFileSync(POLICY_PATH, 'utf8');
const SCAN_DIAGNOSTICS_PATH = resolve(__dirname, 'scanDiagnostics.ts');
const SCAN_DIAGNOSTICS_SRC = readFileSync(SCAN_DIAGNOSTICS_PATH, 'utf8');
const BUY_LIST_LOOP_PATH = resolve(__dirname, 'perSymbol/buyListLoop.ts');
const BUY_LIST_LOOP_SRC = readFileSync(BUY_LIST_LOOP_PATH, 'utf8');

function baseInput(over: Partial<PreBreakoutWaitInput> = {}): PreBreakoutWaitInput {
  return {
    symbol: '005930',
    name: 'Samsung',
    currentPrice: 70_000,
    entryPrice: 70_500, // 0.71% gap
    volumeRatio: 1.0,
    gate1Passed: true,
    recheckPassed: true,
    waitCount: 0,
    recheckFailCount: 0,
    shadowObservable: false,
    liveEligible: true,
    riskBlocked: false,
    quoteStale: false,
    ...over,
  };
}

describe('ADR-0449 — Group A — ENV gate (default OFF, ADR-0157 정확 비교)', () => {
  const original = process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED;
  beforeEach(() => {
    delete process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED;
    else process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = original;
  });

  it('default OFF → policy 활성', () => {
    expect(isPreBreakoutWaitPolicyDisabled()).toBe(false);
  });

  it("'true' 정확 매칭 → ENV 활성 → fallback 보수 응답", () => {
    process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = 'true';
    expect(isPreBreakoutWaitPolicyDisabled()).toBe(true);
    const d = evaluatePreBreakoutWait(baseInput());
    expect(d.state).toBe('WAIT_RETRY_ELIGIBLE');
    expect(d.reason).toBe('UNKNOWN');
    expect(d.retryAllowed).toBe(false);
    expect(d.kisWsPriorityAdjustment).toBe('KEEP');
  });

  it("'1' 거부 (ADR-0157 정확 비교 의무)", () => {
    process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = '1';
    expect(isPreBreakoutWaitPolicyDisabled()).toBe(false);
  });

  it("'TRUE' 거부 (case sensitive)", () => {
    process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = 'TRUE';
    expect(isPreBreakoutWaitPolicyDisabled()).toBe(false);
  });

  it("'yes' 거부", () => {
    process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = 'yes';
    expect(isPreBreakoutWaitPolicyDisabled()).toBe(false);
  });

  it("'false' / 빈 문자열 → OFF", () => {
    process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = 'false';
    expect(isPreBreakoutWaitPolicyDisabled()).toBe(false);
    process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = '';
    expect(isPreBreakoutWaitPolicyDisabled()).toBe(false);
  });
});

describe('ADR-0449 — Group B — PRE_BREAKOUT_WAIT_POLICY 상수 SSOT', () => {
  it('NEAR/FAR/MIN_VOLUME/MAX_WAIT/COOLDOWN 임계 정합', () => {
    expect(PRE_BREAKOUT_WAIT_POLICY.NEAR_ENTRY_DISTANCE_PCT).toBe(1.0);
    expect(PRE_BREAKOUT_WAIT_POLICY.FAR_ENTRY_DISTANCE_PCT).toBe(3.0);
    expect(PRE_BREAKOUT_WAIT_POLICY.MIN_VOLUME_RATIO).toBe(0.4);
    expect(PRE_BREAKOUT_WAIT_POLICY.MAX_WAIT_COUNT_BEFORE_COOLDOWN).toBe(3);
    expect(PRE_BREAKOUT_WAIT_POLICY.COOLDOWN_MINUTES).toBe(30);
  });

  it('Object.freeze drift 가드 — 임계값 변경 영구 차단', () => {
    expect(Object.isFrozen(PRE_BREAKOUT_WAIT_POLICY)).toBe(true);
  });
});

describe('ADR-0449 — Group C — computePriceDistancePct SSOT', () => {
  it('priceDistancePct 명시 전달 시 그대로 사용', () => {
    expect(computePriceDistancePct({ symbol: 'X', priceDistancePct: 2.5 })).toBe(2.5);
  });

  it('absolute value 강제 (음수 입력 시)', () => {
    expect(computePriceDistancePct({ symbol: 'X', priceDistancePct: -1.7 })).toBeCloseTo(1.7, 5);
  });

  it('미전달 시 currentPrice/entryPrice 자동 산출', () => {
    const d = computePriceDistancePct({ symbol: 'X', currentPrice: 990, entryPrice: 1000 });
    expect(d).toBeCloseTo(1.0, 4);
  });

  it('NaN/Infinity/0 entryPrice → 0 fallback', () => {
    expect(computePriceDistancePct({ symbol: 'X', currentPrice: 100, entryPrice: 0 })).toBe(0);
    expect(computePriceDistancePct({ symbol: 'X', currentPrice: NaN, entryPrice: 100 })).toBe(0);
    expect(computePriceDistancePct({ symbol: 'X', currentPrice: 100, entryPrice: Infinity })).toBe(0);
  });

  it('currentPrice / entryPrice 둘 다 부재 → 0', () => {
    expect(computePriceDistancePct({ symbol: 'X' })).toBe(0);
  });
});

describe('ADR-0449 — Group D — 결정 트리 우선순위 (사용자 §"결정 규칙" 정합)', () => {
  it('(2) riskBlocked → WAIT_REJECTED (우선순위 최상)', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      riskBlocked: true,
      quoteStale: true, // 동시 충족이어도 riskBlocked 우선
      recheckPassed: false,
    }));
    expect(d.state).toBe('WAIT_REJECTED');
    expect(d.reason).toBe('RISK_RULE_BLOCKED');
    expect(d.retryAllowed).toBe(false);
    expect(d.kisWsPriorityAdjustment).toBe('UNSUBSCRIBE_IF_LOW_PRIORITY');
    expect(d.shadowLearningAllowed).toBe(false);
    expect(d.counterfactualLearningAllowed).toBe(true);
    expect(d.increaseWaitCount).toBe(false);
  });

  it('(3) quoteStale → WAIT_SHADOW_ONLY (riskBlocked 없을 때)', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      quoteStale: true,
      recheckPassed: false, // 무시됨
    }));
    expect(d.state).toBe('WAIT_SHADOW_ONLY');
    expect(d.reason).toBe('STALE_QUOTE');
    expect(d.retryAllowed).toBe(false);
    expect(d.kisWsPriorityAdjustment).toBe('DOWNGRADE_TO_OBSERVE_ONLY');
  });

  it('(4) recheckPassed=false → WAIT_GATE_RECHECK_FAILED + recheckFailCount 증가', () => {
    const d = evaluatePreBreakoutWait(baseInput({ recheckPassed: false }));
    expect(d.state).toBe('WAIT_GATE_RECHECK_FAILED');
    expect(d.reason).toBe('GATE_RECHECK_FAILED');
    expect(d.retryAllowed).toBe(false);
    expect(d.increaseRecheckFailCount).toBe(true);
    expect(d.increaseWaitCount).toBe(true);
    expect(d.kisWsPriorityAdjustment).toBe('DOWNGRADE_TO_WATCHLIST');
  });

  it('(5) waitCount ≥ 3 → WAIT_COOLDOWN', () => {
    const d = evaluatePreBreakoutWait(baseInput({ waitCount: 3 }));
    expect(d.state).toBe('WAIT_COOLDOWN');
    expect(d.reason).toBe('REPEATED_WAIT');
    expect(d.retryAllowed).toBe(false);
    expect(d.kisWsPriorityAdjustment).toBe('DOWNGRADE_TO_OBSERVE_ONLY');
  });

  it('(5) waitCount=2 → COOLDOWN 미진입 (boundary)', () => {
    const d = evaluatePreBreakoutWait(baseInput({ waitCount: 2 }));
    expect(d.state).not.toBe('WAIT_COOLDOWN');
  });

  it('(5) waitCount=4 → COOLDOWN', () => {
    const d = evaluatePreBreakoutWait(baseInput({ waitCount: 4 }));
    expect(d.state).toBe('WAIT_COOLDOWN');
  });

  it('(6) shadowObservable=true + liveEligible=false → WAIT_SHADOW_ONLY', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      shadowObservable: true,
      liveEligible: false,
    }));
    expect(d.state).toBe('WAIT_SHADOW_ONLY');
    expect(d.reason).toBe('SHADOW_OBSERVABLE_ONLY');
  });

  it('(6) shadowObservable=true + liveEligible=true → SHADOW 분기 진입 안 함', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      shadowObservable: true,
      liveEligible: true,
    }));
    expect(d.state).not.toBe('WAIT_SHADOW_ONLY');
  });

  it('(7) priceDistance > 3% → WAIT_PRICE_TOO_FAR', () => {
    const d = evaluatePreBreakoutWait(baseInput({ priceDistancePct: 3.5 }));
    expect(d.state).toBe('WAIT_PRICE_TOO_FAR');
    expect(d.reason).toBe('PRICE_DISTANCE_TOO_FAR');
    expect(d.kisWsPriorityAdjustment).toBe('DOWNGRADE_TO_WATCHLIST');
  });

  it('(7) priceDistance = 3.0% → boundary FAR 미진입 (strict >)', () => {
    const d = evaluatePreBreakoutWait(baseInput({ priceDistancePct: 3.0 }));
    expect(d.state).not.toBe('WAIT_PRICE_TOO_FAR');
  });

  it('(8) volumeRatio < 0.4 → WAIT_VOLUME_WEAK', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      priceDistancePct: 1.5, // 1~3% 사이라 PRICE_TOO_FAR 안 걸림
      volumeRatio: 0.3,
    }));
    expect(d.state).toBe('WAIT_VOLUME_WEAK');
    expect(d.reason).toBe('VOLUME_BELOW_THRESHOLD');
    expect(d.kisWsPriorityAdjustment).toBe('DOWNGRADE_TO_OBSERVE_ONLY');
  });

  it('(8) volumeRatio = 0.4 → boundary 통과 (strict <)', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      priceDistancePct: 1.5,
      volumeRatio: 0.4,
    }));
    expect(d.state).not.toBe('WAIT_VOLUME_WEAK');
  });

  it('(9) priceDistance ≤ 1% AND gate1Passed=true → WAIT_RETRY_ELIGIBLE', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      priceDistancePct: 0.7,
      gate1Passed: true,
    }));
    expect(d.state).toBe('WAIT_RETRY_ELIGIBLE');
    expect(d.reason).toBe('ENTRY_PRICE_NOT_REACHED');
    expect(d.retryAllowed).toBe(true);
    expect(d.kisWsPriorityAdjustment).toBe('KEEP');
  });

  it('(9) gate1Passed=false → 보수 fallback (기본 retry)', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      priceDistancePct: 0.5,
      gate1Passed: false,
    }));
    // (9) 통과 안 함 → (10) default RETRY_ELIGIBLE
    expect(d.state).toBe('WAIT_RETRY_ELIGIBLE');
    expect(d.retryAllowed).toBe(true);
  });

  it('(10) default fallback — 진입가 1~3% + 차단 사유 부재 → RETRY_ELIGIBLE (보수적)', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      priceDistancePct: 2.0,
      gate1Passed: false,
      volumeRatio: 0.5,
    }));
    expect(d.state).toBe('WAIT_RETRY_ELIGIBLE');
    expect(d.retryAllowed).toBe(true);
    expect(d.reason).toBe('ENTRY_PRICE_NOT_REACHED');
  });
});

describe('ADR-0449 — Group E — increaseFailCount: false literal (ADR-0115 보호)', () => {
  it('모든 7 state 의 decision.increaseFailCount === false (literal type 강제)', () => {
    const cases: PreBreakoutWaitInput[] = [
      baseInput(), // RETRY_ELIGIBLE
      baseInput({ priceDistancePct: 4 }), // PRICE_TOO_FAR
      baseInput({ priceDistancePct: 1.5, volumeRatio: 0.2 }), // VOLUME_WEAK
      baseInput({ recheckPassed: false }), // GATE_RECHECK_FAILED
      baseInput({ waitCount: 5 }), // COOLDOWN
      baseInput({ shadowObservable: true, liveEligible: false }), // SHADOW_ONLY
      baseInput({ riskBlocked: true }), // REJECTED
    ];
    for (const c of cases) {
      const d = evaluatePreBreakoutWait(c);
      // increaseFailCount 는 literal type `false` — 컴파일 타임 + 런타임 모두 false.
      expect(d.increaseFailCount).toBe(false);
    }
  });

  it('ADR-0115 보호 — 모든 decision 이 failCount 증가 0', () => {
    const decisions: PreBreakoutWaitDecision[] = [];
    for (let i = 0; i < 30; i++) {
      decisions.push(evaluatePreBreakoutWait(baseInput({ priceDistancePct: i * 0.2 })));
    }
    expect(decisions.every((d) => d.increaseFailCount === false)).toBe(true);
  });
});

describe('ADR-0449 — Group F — KIS-WS priority adjustment (ADR-0437 연동)', () => {
  it('RETRY_ELIGIBLE → KEEP', () => {
    expect(evaluatePreBreakoutWait(baseInput()).kisWsPriorityAdjustment).toBe('KEEP');
  });

  it('PRICE_TOO_FAR → DOWNGRADE_TO_WATCHLIST', () => {
    expect(evaluatePreBreakoutWait(baseInput({ priceDistancePct: 5 })).kisWsPriorityAdjustment)
      .toBe('DOWNGRADE_TO_WATCHLIST');
  });

  it('VOLUME_WEAK → DOWNGRADE_TO_OBSERVE_ONLY', () => {
    expect(evaluatePreBreakoutWait(baseInput({ priceDistancePct: 1.5, volumeRatio: 0.1 }))
      .kisWsPriorityAdjustment).toBe('DOWNGRADE_TO_OBSERVE_ONLY');
  });

  it('GATE_RECHECK_FAILED → DOWNGRADE_TO_WATCHLIST', () => {
    expect(evaluatePreBreakoutWait(baseInput({ recheckPassed: false })).kisWsPriorityAdjustment)
      .toBe('DOWNGRADE_TO_WATCHLIST');
  });

  it('COOLDOWN → DOWNGRADE_TO_OBSERVE_ONLY', () => {
    expect(evaluatePreBreakoutWait(baseInput({ waitCount: 3 })).kisWsPriorityAdjustment)
      .toBe('DOWNGRADE_TO_OBSERVE_ONLY');
  });

  it('SHADOW_ONLY → DOWNGRADE_TO_OBSERVE_ONLY', () => {
    expect(evaluatePreBreakoutWait(baseInput({ shadowObservable: true, liveEligible: false }))
      .kisWsPriorityAdjustment).toBe('DOWNGRADE_TO_OBSERVE_ONLY');
  });

  it('REJECTED → UNSUBSCRIBE_IF_LOW_PRIORITY', () => {
    expect(evaluatePreBreakoutWait(baseInput({ riskBlocked: true })).kisWsPriorityAdjustment)
      .toBe('UNSUBSCRIBE_IF_LOW_PRIORITY');
  });

  it('STALE_QUOTE → DOWNGRADE_TO_OBSERVE_ONLY', () => {
    expect(evaluatePreBreakoutWait(baseInput({ quoteStale: true })).kisWsPriorityAdjustment)
      .toBe('DOWNGRADE_TO_OBSERVE_ONLY');
  });
});

describe('ADR-0449 — Group G — increaseWaitCount / increaseRecheckFailCount 분리', () => {
  it('RETRY_ELIGIBLE → increaseWaitCount=true / increaseRecheckFailCount=false', () => {
    const d = evaluatePreBreakoutWait(baseInput({ priceDistancePct: 0.5 }));
    expect(d.increaseWaitCount).toBe(true);
    expect(d.increaseRecheckFailCount).toBe(false);
  });

  it('GATE_RECHECK_FAILED → 둘 다 true (waitCount + recheckFailCount 동시 증가)', () => {
    const d = evaluatePreBreakoutWait(baseInput({ recheckPassed: false }));
    expect(d.increaseWaitCount).toBe(true);
    expect(d.increaseRecheckFailCount).toBe(true);
  });

  it('REJECTED (riskBlocked) → 둘 다 false (영구 차단)', () => {
    const d = evaluatePreBreakoutWait(baseInput({ riskBlocked: true }));
    expect(d.increaseWaitCount).toBe(false);
    expect(d.increaseRecheckFailCount).toBe(false);
  });

  it('ENV DISABLED fallback → 둘 다 false', () => {
    process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED = 'true';
    try {
      const d = evaluatePreBreakoutWait(baseInput());
      expect(d.increaseWaitCount).toBe(false);
      expect(d.increaseRecheckFailCount).toBe(false);
    } finally {
      delete process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED;
    }
  });
});

describe('ADR-0449 — Group H — shadowLearningAllowed / counterfactualLearningAllowed', () => {
  it('REJECTED → shadowLearning=false / counterfactual=true (학습 가능)', () => {
    const d = evaluatePreBreakoutWait(baseInput({ riskBlocked: true }));
    expect(d.shadowLearningAllowed).toBe(false);
    expect(d.counterfactualLearningAllowed).toBe(true);
  });

  it('SHADOW_ONLY (quoteStale) → 둘 다 true', () => {
    const d = evaluatePreBreakoutWait(baseInput({ quoteStale: true }));
    expect(d.shadowLearningAllowed).toBe(true);
    expect(d.counterfactualLearningAllowed).toBe(true);
  });

  it('RETRY_ELIGIBLE → 둘 다 true', () => {
    const d = evaluatePreBreakoutWait(baseInput());
    expect(d.shadowLearningAllowed).toBe(true);
    expect(d.counterfactualLearningAllowed).toBe(true);
  });
});

describe('ADR-0449 — Group I — operatorMessage 진단 텍스트', () => {
  it('symbol + 정량 정보 포함', () => {
    const d = evaluatePreBreakoutWait(baseInput({ priceDistancePct: 4.5 }));
    expect(d.operatorMessage).toContain('005930');
    expect(d.operatorMessage).toContain('4.50%');
    expect(d.operatorMessage).toContain('3');
  });

  it('VOLUME_WEAK → ratio 노출', () => {
    const d = evaluatePreBreakoutWait(baseInput({
      priceDistancePct: 1.5,
      volumeRatio: 0.25,
    }));
    expect(d.operatorMessage).toContain('0.25');
    expect(d.operatorMessage).toContain('0.4');
  });

  it('COOLDOWN → waitCount 노출', () => {
    const d = evaluatePreBreakoutWait(baseInput({ waitCount: 5 }));
    expect(d.operatorMessage).toContain('5');
    expect(d.operatorMessage).toContain('3');
  });
});

describe('ADR-0449 — Group J — summarizePreBreakoutWaitDecisions', () => {
  it('빈 배열 → 모든 카운트 0', () => {
    const s = summarizePreBreakoutWaitDecisions({ decisions: [] });
    expect(s.retryEligible).toBe(0);
    expect(s.cooldown).toBe(0);
    expect(s.shadowOnly).toBe(0);
    expect(s.rejected).toBe(0);
    expect(s.failCountProtected).toBe(0);
    expect(s.topReasons).toEqual([]);
  });

  it('7-state 분포 정확 카운트', () => {
    const decisions: PreBreakoutWaitDecision[] = [
      evaluatePreBreakoutWait(baseInput()), // RETRY_ELIGIBLE
      evaluatePreBreakoutWait(baseInput()), // RETRY_ELIGIBLE
      evaluatePreBreakoutWait(baseInput({ waitCount: 5 })), // COOLDOWN
      evaluatePreBreakoutWait(baseInput({ shadowObservable: true, liveEligible: false })), // SHADOW_ONLY
      evaluatePreBreakoutWait(baseInput({ riskBlocked: true })), // REJECTED
      evaluatePreBreakoutWait(baseInput({ priceDistancePct: 5 })), // PRICE_TOO_FAR
      evaluatePreBreakoutWait(baseInput({ priceDistancePct: 1.5, volumeRatio: 0.1 })), // VOLUME_WEAK
      evaluatePreBreakoutWait(baseInput({ recheckPassed: false })), // GATE_RECHECK_FAILED
    ];
    const s = summarizePreBreakoutWaitDecisions({ decisions });
    expect(s.retryEligible).toBe(2);
    expect(s.cooldown).toBe(1);
    expect(s.shadowOnly).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.priceTooFar).toBe(1);
    expect(s.volumeWeak).toBe(1);
    expect(s.gateRecheckFailed).toBe(1);
    expect(s.failCountProtected).toBe(8); // 모든 decision 이 ADR-0115 보호
  });

  it('topReasons — count 내림차순 + Top 3 절삭', () => {
    const decisions: PreBreakoutWaitDecision[] = [
      ...Array.from({ length: 5 }, () => evaluatePreBreakoutWait(baseInput())),
      ...Array.from({ length: 3 }, () => evaluatePreBreakoutWait(baseInput({ recheckPassed: false }))),
      ...Array.from({ length: 2 }, () => evaluatePreBreakoutWait(baseInput({ priceDistancePct: 5 }))),
      evaluatePreBreakoutWait(baseInput({ riskBlocked: true })),
    ];
    const s = summarizePreBreakoutWaitDecisions({ decisions });
    expect(s.topReasons).toHaveLength(3);
    expect(s.topReasons[0].count).toBe(5);
    expect(s.topReasons[0].reason).toBe('ENTRY_PRICE_NOT_REACHED');
    expect(s.topReasons[1].reason).toBe('GATE_RECHECK_FAILED');
    expect(s.topReasons[1].count).toBe(3);
    expect(s.topReasons[2].reason).toBe('PRICE_DISTANCE_TOO_FAR');
    expect(s.topReasons[2].count).toBe(2);
  });
});

describe('ADR-0449 — Group K — formatPreBreakoutWaitSummarySection /scan_blockers', () => {
  it('failCountProtected=0 → null (잡음 차단)', () => {
    const s = summarizePreBreakoutWaitDecisions({ decisions: [] });
    expect(formatPreBreakoutWaitSummarySection(s)).toBeNull();
  });

  it('정상 출력 — 헤더 + retryEligible/cooldown/shadowOnly/rejected + topReason + failCountProtected', () => {
    const decisions = [
      ...Array.from({ length: 4 }, () => evaluatePreBreakoutWait(baseInput())),
      ...Array.from({ length: 8 }, () => evaluatePreBreakoutWait(baseInput({ waitCount: 5 }))),
      ...Array.from({ length: 12 }, () => evaluatePreBreakoutWait(baseInput({ shadowObservable: true, liveEligible: false }))),
      ...Array.from({ length: 3 }, () => evaluatePreBreakoutWait(baseInput({ riskBlocked: true }))),
    ];
    const s = summarizePreBreakoutWaitDecisions({ decisions });
    const out = formatPreBreakoutWaitSummarySection(s);
    expect(out).not.toBeNull();
    expect(out!).toContain('🕒 Pre-Breakout WAIT (ADR-0449)');
    expect(out!).toContain('retryEligible 4');
    expect(out!).toContain('cooldown 8');
    expect(out!).toContain('shadowOnly 12');
    expect(out!).toContain('rejected 3');
    expect(out!).toContain('failCountProtected: 27');
    expect(out!).toContain('topReason:');
  });

  it('priceTooFar/volumeWeak/gateRecheckFailed 모두 0 → 둘째 라인 미렌더', () => {
    const decisions = [evaluatePreBreakoutWait(baseInput())];
    const s = summarizePreBreakoutWaitDecisions({ decisions });
    const out = formatPreBreakoutWaitSummarySection(s);
    expect(out).not.toBeNull();
    expect(out!).not.toContain('priceTooFar');
  });
});

describe('ADR-0449 — Group L — 정적 grep 가드 (절대 불변식)', () => {
  it('preBreakoutWaitPolicy.ts 가 KIS 주문 함수 5종 import 0건', () => {
    const banned = [
      'placeKisMarketBuyOrder',
      'placeKisMarketSellOrder',
      'placeKisOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
    ];
    for (const fn of banned) {
      expect(POLICY_SRC).not.toContain(fn);
    }
  });

  it('preBreakoutWaitPolicy.ts autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(POLICY_SRC).not.toContain('autoTradeEngine');
    expect(POLICY_SRC).not.toContain('orderExecutor');
    expect(POLICY_SRC).not.toContain('trancheExecutor');
  });

  it('preBreakoutWaitPolicy.ts 외부 fetch / axios / node-fetch import 0건', () => {
    expect(POLICY_SRC).not.toMatch(/from ['"](?:axios|node-fetch)['"]/);
    // 'fetch(' 본문 호출도 0건 (KIS/Yahoo/Naver outbound 불가).
    expect(POLICY_SRC).not.toMatch(/\bfetch\s*\(/);
  });

  it('preBreakoutWaitPolicy.ts 신규 Gate threshold 변경 0', () => {
    expect(POLICY_SRC).not.toContain('setGateThreshold');
    expect(POLICY_SRC).not.toContain('GATE_RELAX');
    expect(POLICY_SRC).not.toContain('STRONG_BUY_OVERRIDE');
  });

  it('preBreakoutWaitPolicy.ts increaseFailCount: false literal type 강제', () => {
    // PreBreakoutWaitDecision 의 `increaseFailCount: false;` literal 명시.
    expect(POLICY_SRC).toMatch(/increaseFailCount:\s*false;/);
  });

  it('scanDiagnostics.ts 가 ADR-0449 SSOT 를 import + 후방호환 옵셔널 필드 격상', () => {
    expect(SCAN_DIAGNOSTICS_SRC).toMatch(/from ['"]\.\/preBreakoutWaitPolicy\.js['"]/);
    expect(SCAN_DIAGNOSTICS_SRC).toContain('preBreakoutWaitSummary?: PreBreakoutWaitSummary');
    expect(SCAN_DIAGNOSTICS_SRC).toContain('preBreakoutWaitDecisions: PreBreakoutWaitDecision[]');
  });

  it('scanDiagnostics.ts persistScanResults 가 summarize + format wiring 보유', () => {
    expect(SCAN_DIAGNOSTICS_SRC).toContain('summarizePreBreakoutWaitDecisions');
    expect(SCAN_DIAGNOSTICS_SRC).toContain('formatPreBreakoutWaitSummarySection');
    // try/catch 격리 패턴 확인.
    expect(SCAN_DIAGNOSTICS_SRC).toContain('[PreBreakoutWaitPolicy] summarize 실패');
  });

  it('buyListLoop.ts 가 ADR-0449 SSOT import + try/catch 격리', () => {
    expect(BUY_LIST_LOOP_SRC).toMatch(/from ['"]\.\.\/preBreakoutWaitPolicy\.js['"]/);
    expect(BUY_LIST_LOOP_SRC).toContain('evaluatePreBreakoutWait');
    expect(BUY_LIST_LOOP_SRC).toContain('preBreakoutWaitDecisions.push');
    expect(BUY_LIST_LOOP_SRC).toContain('[ADR-0449] pre-breakout WAIT 분류 실패');
    expect(BUY_LIST_LOOP_SRC).toContain('[ADR-0449] entry deviation WAIT 분류 실패');
  });

  it('buyListLoop.ts 의 ADR-0115 shouldIncrementFailCount 보호 분기 보존', () => {
    // ADR-0449 wiring 전후로 ADR-0115 분기 그대로 유지 (failCount 보호).
    expect(BUY_LIST_LOOP_SRC).toContain("shouldIncrementFailCount('PRE_BREAKOUT_MISS')");
    expect(BUY_LIST_LOOP_SRC).toContain("shouldIncrementFailCount('ENTRY_PRICE_DEVIATION')");
  });
});

describe('ADR-0449 — Group M — 사용자 §"권장 테스트" 통합 시나리오', () => {
  it('100 후보 — 진입가 미도달 분류 + summary 정합', () => {
    const decisions: PreBreakoutWaitDecision[] = [];
    // 50 retry-eligible (entry 도달 가까움)
    for (let i = 0; i < 50; i++) {
      decisions.push(evaluatePreBreakoutWait(baseInput({
        symbol: `0000${i.toString().padStart(2, '0')}`,
        priceDistancePct: 0.5 + (i % 5) * 0.1, // 0.5~0.9%
      })));
    }
    // 30 cooldown
    for (let i = 0; i < 30; i++) {
      decisions.push(evaluatePreBreakoutWait(baseInput({
        symbol: `0001${i.toString().padStart(2, '0')}`,
        waitCount: 5,
      })));
    }
    // 20 priceTooFar
    for (let i = 0; i < 20; i++) {
      decisions.push(evaluatePreBreakoutWait(baseInput({
        symbol: `0002${i.toString().padStart(2, '0')}`,
        priceDistancePct: 5.0,
      })));
    }
    const s = summarizePreBreakoutWaitDecisions({ decisions });
    expect(s.failCountProtected).toBe(100); // ADR-0115 보호 100% 적용
    expect(s.retryEligible).toBe(50);
    expect(s.cooldown).toBe(30);
    expect(s.priceTooFar).toBe(20);
  });

  it('우선순위 충돌 종합 — riskBlocked > quoteStale > recheckFailed > cooldown > shadowOnly > priceTooFar > volumeWeak', () => {
    // 모든 신호 동시 충족 — riskBlocked 가 최상위
    const allBlocked = evaluatePreBreakoutWait({
      symbol: '005930',
      currentPrice: 60000,
      entryPrice: 70000,
      priceDistancePct: 14, // PRICE_TOO_FAR
      volumeRatio: 0.1, // VOLUME_WEAK
      gate1Passed: false,
      recheckPassed: false, // GATE_RECHECK_FAILED
      waitCount: 10, // COOLDOWN
      shadowObservable: true,
      liveEligible: false, // SHADOW_ONLY
      riskBlocked: true, // 최상위
      quoteStale: true,
    });
    expect(allBlocked.state).toBe('WAIT_REJECTED');
    expect(allBlocked.reason).toBe('RISK_RULE_BLOCKED');
  });

  it('회귀 검증 — Pre-Breakout 후보 30 종목 시나리오 (사용자 운영 보고)', () => {
    // 진입가 0.5% 미만 12, 1~3% 8, 3% 이상 5, recheckFailed 3, cooldown 2
    const decisions: PreBreakoutWaitDecision[] = [
      ...Array.from({ length: 12 }, () => evaluatePreBreakoutWait(baseInput({ priceDistancePct: 0.4 }))),
      ...Array.from({ length: 8 }, () => evaluatePreBreakoutWait(baseInput({ priceDistancePct: 1.8, gate1Passed: false }))),
      ...Array.from({ length: 5 }, () => evaluatePreBreakoutWait(baseInput({ priceDistancePct: 4.0 }))),
      ...Array.from({ length: 3 }, () => evaluatePreBreakoutWait(baseInput({ recheckPassed: false }))),
      ...Array.from({ length: 2 }, () => evaluatePreBreakoutWait(baseInput({ waitCount: 4 }))),
    ];
    const s = summarizePreBreakoutWaitDecisions({ decisions });
    expect(s.retryEligible).toBe(20); // 12 (≤1%) + 8 (default fallback)
    expect(s.priceTooFar).toBe(5);
    expect(s.gateRecheckFailed).toBe(3);
    expect(s.cooldown).toBe(2);
    expect(s.failCountProtected).toBe(30);
    // 모든 decision 의 increaseFailCount=false (ADR-0115 보호)
    expect(decisions.every((d) => d.increaseFailCount === false)).toBe(true);
  });
});
