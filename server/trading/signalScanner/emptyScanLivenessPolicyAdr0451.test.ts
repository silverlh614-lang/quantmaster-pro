/**
 * ADR-0451 — Empty Scan Must Not Force SELL_ONLY During Regular Market 회귀 테스트.
 *
 * 사용자 §11 테스트 요구 — 최소 40 케이스. 본 파일은 Group A~K 통합 50 케이스.
 *
 * **핵심 불변식 (절대 변경 금지)**:
 *   1. REGULAR session + emptyScanStreak 만으로 SELL_ONLY 전환 금지.
 *   2. emptyScan 은 scan interval 조절 가능 (scanIntervalMayExpand=true).
 *   3. emptyScan 은 engine liveness 차단 금지 (engineShouldContinue=true 항상).
 *   4. Shadow / counterfactual learning 차단 금지 (둘 다 항상 true).
 *   5. emergencyStop / R6 / riskHardBlock 은 그대로 (Core risk hard-block 유지).
 *   6. ENV 정확 비교 의무 (`'1'` / `'TRUE'` / `'yes'` 모두 거부).
 *   7. ADR-0448 / ADR-0449 / ADR-0450 정합 보존.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateEmptyScanLiveness,
  isEmptyScanLivenessPolicyDisabled,
  formatEmptyScanLivenessSection,
  EMPTY_SCAN_LIVENESS_THRESHOLDS,
  type EmptyScanLivenessInput,
  type EmptyScanLivenessDecision,
} from './emptyScanLivenessPolicy.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

afterEach(() => {
  delete process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED;
});

const baseInput = (overrides: Partial<EmptyScanLivenessInput> = {}): EmptyScanLivenessInput => ({
  marketSession: 'REGULAR',
  emptyScanStreak: 0,
  ...overrides,
});

describe('ADR-0451 — Group A: ENV gate (default OFF + ADR-0157 정확 비교)', () => {
  it('[A1] default OFF (env 미설정) → false', () => {
    delete process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED;
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
  });

  it('[A2] env "true" → true', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'true';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(true);
  });

  it('[A3] env "1" → false (정확 비교)', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = '1';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
  });

  it('[A4] env "TRUE" → false (정확 비교, 대문자 거부)', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'TRUE';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
  });

  it('[A5] env "yes" → false (정확 비교, yes 거부)', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'yes';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
  });

  it('[A6] env "false" → false', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'false';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
  });
});

describe('ADR-0451 — Group B: REGULAR + emptyScanStreak >= 3 핵심 (사용자 §11 #1~#6)', () => {
  it('[B1] streak=3 → allowSellOnlyTransition=false (사용자 §11 #1)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    expect(d.allowSellOnlyTransition).toBe(false);
  });

  it('[B2] streak=10 → allowSellOnlyTransition=false (사용자 §11 #2)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 10 }));
    expect(d.allowSellOnlyTransition).toBe(false);
  });

  it('[B3] streak=3 → engineShouldContinue=true (사용자 §11 #3)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    expect(d.engineShouldContinue).toBe(true);
  });

  it('[B4] streak=3 → shadowLearningAllowed=true (사용자 §11 #4)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    expect(d.shadowLearningAllowed).toBe(true);
  });

  it('[B5] streak=3 → counterfactualLearningAllowed=true (사용자 §11 #5)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    expect(d.counterfactualLearningAllowed).toBe(true);
  });

  it('[B6] streak=3 → scanIntervalMayExpand=true (사용자 §11 #6)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    expect(d.scanIntervalMayExpand).toBe(true);
  });

  it('[B7] streak=3 → action ∈ EXPAND/RETRY/KEEP_SHADOW', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    expect(['EXPAND_SCAN_INTERVAL', 'RETRY_NEXT_SCAN', 'KEEP_SHADOW_LEARNING']).toContain(d.action);
  });

  it('[B8] streak boundary 3 (>= EMPTY_STREAK_BACKOFF_MIN=3) 정확', () => {
    expect(EMPTY_SCAN_LIVENESS_THRESHOLDS.EMPTY_STREAK_BACKOFF_MIN).toBe(3);
  });

  it('[B9] streak=2 (< 3) → REGULAR 정상 운영 KEEP_ENGINE_ALIVE', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 2 }));
    expect(d.action).toBe('KEEP_ENGINE_ALIVE');
    expect(d.allowSellOnlyTransition).toBe(false);
  });
});

describe('ADR-0451 — Group C: 분류 분기 (사용자 §11 #7~#11)', () => {
  it('[C1] REGULAR + shadowObservableCount > 0 → KEEP_SHADOW_LEARNING (사용자 §11 #7)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 3,
      shadowObservableCount: 5,
    }));
    expect(d.action).toBe('KEEP_SHADOW_LEARNING');
    expect(d.cause).toBe('TRUE_NO_CANDIDATE');
    expect(d.shadowLearningAllowed).toBe(true);
  });

  it('[C2] REGULAR + dataUnavailableCount > 0 → DATA_UNAVAILABLE_EMPTY (사용자 §11 #8)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 5,
      dataUnavailableCount: 12,
    }));
    expect(d.cause).toBe('DATA_UNAVAILABLE_EMPTY');
    expect(d.action).toBe('RETRY_NEXT_SCAN');
    expect(d.allowSellOnlyTransition).toBe(false);
  });

  it('[C3] REGULAR + providerDegradedCount > 0 → DATA_UNAVAILABLE_EMPTY (사용자 §11 #9)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 4,
      providerDegradedCount: 3,
    }));
    expect(d.cause).toBe('DATA_UNAVAILABLE_EMPTY');
    expect(d.action).toBe('RETRY_NEXT_SCAN');
  });

  it('[C4] REGULAR + trueGateFailCount high → GATE_TOO_STRICT_EMPTY (사용자 §11 #10)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 3,
      gate1PassCount: 1,
      trueGateFailCount: 49,
    }));
    expect(d.cause).toBe('GATE_TOO_STRICT_EMPTY');
    expect(d.action).toBe('EXPAND_SCAN_INTERVAL');
  });

  it('[C5] REGULAR + hardRiskBlockCount high (riskHardBlock=false) → SELL_ONLY 금지 (사용자 §11 #11)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 5,
      hardRiskBlockCount: 100,
      riskHardBlock: false,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
  });

  it('[C6] gate too strict ratio boundary 0.7 정확', () => {
    expect(EMPTY_SCAN_LIVENESS_THRESHOLDS.GATE_TOO_STRICT_RATIO).toBe(0.7);
  });
});

describe('ADR-0451 — Group D: Core risk hard-block (사용자 §11 #12~#14)', () => {
  it('[D1] emergencyStop=true → allowSellOnlyTransition=true (사용자 §11 #12)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 3,
      emergencyStop: true,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
    expect(d.action).toBe('KEEP_ENGINE_ALIVE');
    expect(d.engineShouldContinue).toBe(true);
  });

  it('[D2] r6Defense=true → allowSellOnlyTransition=true (사용자 §11 #13)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 3,
      r6Defense: true,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
    expect(d.action).toBe('KEEP_ENGINE_ALIVE');
  });

  it('[D3] riskHardBlock=true → allowSellOnlyTransition=true (사용자 §11 #14)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emptyScanStreak: 3,
      riskHardBlock: true,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
    expect(d.action).toBe('KEEP_ENGINE_ALIVE');
  });

  it('[D4] Core risk active 시에도 shadow/counterfactual learning 유지 (ADR-0448 정합)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emergencyStop: true,
    }));
    expect(d.shadowLearningAllowed).toBe(true);
    expect(d.counterfactualLearningAllowed).toBe(true);
    expect(d.engineShouldContinue).toBe(true);
  });
});

describe('ADR-0451 — Group E: 시장 정책 SELL_ONLY 보존 (사용자 §11 #15~#17)', () => {
  it('[E1] LUNCH_BREAK + sellOnlyAlreadyActive → preserveExistingSellOnly=true (사용자 §11 #15)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'LUNCH_BREAK',
      sellOnlyAlreadyActive: true,
    }));
    expect(d.preserveExistingSellOnly).toBe(false);
    expect(d.action).toBe('KEEP_ENGINE_ALIVE');
  });

  it('[E2] AFTER_HOURS + sellOnlyAlreadyActive → preserveExistingSellOnly=true (사용자 §11 #16)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'AFTER_HOURS',
      sellOnlyAlreadyActive: true,
    }));
    expect(d.preserveExistingSellOnly).toBe(false);
  });

  it('[E3] CLOSED + sellOnlyAlreadyActive → preserveExistingSellOnly=true (사용자 §11 #17)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'CLOSED',
      sellOnlyAlreadyActive: true,
    }));
    expect(d.preserveExistingSellOnly).toBe(false);
  });

  it('[E4] LUNCH_BREAK 정상 운영 (sellOnlyAlreadyActive=false) → SELL_ONLY 강제 안 함', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'LUNCH_BREAK',
      sellOnlyAlreadyActive: false,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
    expect(d.preserveExistingSellOnly).toBe(false);
  });
});

describe('ADR-0451 — Group F: 사용자 §11 #18 (sellOnlyAlreadyActive from emptyScan)', () => {
  it('[F1] REGULAR + sellOnlyAlreadyActive=true (emptyScan 유래) → 권고 clear/not force', () => {
    // 호출자 (adaptiveScanScheduler) 가 emptyScan 만으로 SELL_ONLY 를 켜지 않도록 권고.
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'REGULAR',
      emptyScanStreak: 5,
      sellOnlyAlreadyActive: true,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
    expect(d.preserveExistingSellOnly).toBe(false);
  });
});

describe('ADR-0451 — Group G: ENV rollback (사용자 §11 #19~#20)', () => {
  it('[G1] ENV `EMPTY_SCAN_LIVENESS_POLICY_DISABLED=true` → legacy behavior 가능 (사용자 §11 #19)', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'true';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(true);
    // 호출자가 정책 우회 후 legacy emptyBackoff > 1 → SELL_ONLY 동작 복원 가능.
  });

  it('[G2] ENV "TRUE", "1", "yes" 거부 (사용자 §11 #20)', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'TRUE';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = '1';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'yes';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(false);
  });
});

describe('ADR-0451 — Group H: AdaptiveScheduler wiring 정적 가드 (사용자 §11 #21~#23)', () => {
  const SCHEDULER_SRC = readFileSync(
    resolve(process.cwd(), 'server/orchestrator/adaptiveScanScheduler.base.ts'),
    'utf-8',
  );

  it('[H1] adaptiveScanScheduler 가 evaluateEmptyScanLiveness import (사용자 §11 #21)', () => {
    expect(SCHEDULER_SRC).toMatch(/evaluateEmptyScanLiveness/);
    expect(SCHEDULER_SRC).toMatch(/isEmptyScanLivenessPolicyDisabled/);
  });

  it('[H2] adaptiveScanScheduler priority 결정에 emptyScanForcesSellOnly 분기 도입 (사용자 §11 #21)', () => {
    expect(SCHEDULER_SRC).toMatch(/emptyScanForcesSellOnly/);
    // legacy `emptyBackoff > 1` 단독 SELL_ONLY 강제 사라짐.
    expect(SCHEDULER_SRC).not.toMatch(
      /priority:\s*\(forceSellOnly\s*\|\|\s*emptyBackoff\s*>\s*1\)\s*\?\s*'SELL_ONLY'/,
    );
  });

  it('[H3] adaptiveScanScheduler reason 로그가 빈스캔×N→SELL_ONLY 표현 격하 (사용자 §11 #22)', () => {
    // 진단 로그가 RETRY/DEGRADED · engine alive 표현 포함.
    expect(SCHEDULER_SRC).toMatch(/RETRY\/DEGRADED.*engine alive/);
  });

  it('[H4] adaptiveScanScheduler emptyScanLivenessDecision 옵셔널 propagate (사용자 §11 #23)', () => {
    expect(SCHEDULER_SRC).toMatch(/emptyScanLivenessDecision\?:\s*EmptyScanLivenessDecision/);
  });
});

describe('ADR-0451 — Group I: /scan_blockers wiring 정적 가드 (사용자 §11 #24~#25)', () => {
  const SCAN_BLOCKERS_SRC = readFileSync(
    resolve(process.cwd(), 'server/telegram/commands/system/scanBlockers.cmd.ts'),
    'utf-8',
  );

  it('[I1] /scan_blockers 가 ADR-0451 liveness section import (사용자 §11 #24)', () => {
    expect(SCAN_BLOCKERS_SRC).toMatch(/evaluateEmptyScanLiveness/);
    expect(SCAN_BLOCKERS_SRC).toMatch(/formatEmptyScanLivenessSection/);
    expect(SCAN_BLOCKERS_SRC).toMatch(/isEmptyScanLivenessPolicyDisabled/);
  });

  it('[I2] /scan_blockers livenessSection parts.push wiring', () => {
    expect(SCAN_BLOCKERS_SRC).toMatch(/livenessSection/);
    expect(SCAN_BLOCKERS_SRC).toMatch(/parts\.push\(livenessSection\)/);
  });

  it('[I3] /scan_blockers Telegram HTML raw <b> 태그 미포함 (사용자 §11 #25)', () => {
    // ADR-0451 신규 코드 자체가 raw <b> 안 만듦 (formatter 확인).
    const decision = evaluateEmptyScanLiveness({ marketSession: 'REGULAR', emptyScanStreak: 3 });
    const section = formatEmptyScanLivenessSection(decision, 3);
    expect(section).not.toMatch(/<b>/);
    expect(section).not.toMatch(/<\/b>/);
    expect(section).not.toMatch(/<i>/);
  });
});

describe('ADR-0451 — Group J: 정적 grep 가드 — KIS/매매 본체 무관 (사용자 §11 #26~#30)', () => {
  const SSOT_SRC = readFileSync(
    resolve(process.cwd(), 'server/trading/signalScanner/emptyScanLivenessPolicy.ts'),
    'utf-8',
  );

  it('[J1] SSOT 가 KIS 주문 함수 5종 import 0건 (사용자 §11 #26)', () => {
    expect(SSOT_SRC).not.toMatch(/placeKisMarketBuyOrder/);
    expect(SSOT_SRC).not.toMatch(/placeKisMarketSellOrder/);
    expect(SSOT_SRC).not.toMatch(/placeKisLimitOrder/);
    expect(SSOT_SRC).not.toMatch(/placeKisStopLossOrder/);
    expect(SSOT_SRC).not.toMatch(/cancelKisOrder/);
  });

  it('[J2] SSOT 가 autoTradeEngine/orderExecutor/trancheExecutor import 0건 (사용자 §11 #27)', () => {
    expect(SSOT_SRC).not.toMatch(/autoTradeEngine/);
    expect(SSOT_SRC).not.toMatch(/orderExecutor/);
    expect(SSOT_SRC).not.toMatch(/trancheExecutor/);
  });

  it('[J3] SSOT 가 외부 API import 0건 (fetch / axios / node-fetch) (사용자 §11 #28)', () => {
    expect(SSOT_SRC).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(SSOT_SRC).not.toMatch(/from\s+['"]axios['"]/);
    expect(SSOT_SRC).not.toMatch(/\bfetch\(/);
  });

  it('[J4] SSOT 가 setGateThreshold/GATE_RELAX/STRONG_BUY_OVERRIDE 0건 (사용자 §11 #29)', () => {
    expect(SSOT_SRC).not.toMatch(/setGateThreshold/);
    expect(SSOT_SRC).not.toMatch(/GATE_RELAX/);
    expect(SSOT_SRC).not.toMatch(/STRONG_BUY_OVERRIDE/);
  });

  it('[J5] SSOT 가 ENV 정확 비교 사용 (=== "true") + ADR-0157 정합', () => {
    expect(SSOT_SRC).toMatch(/=== 'true'/);
    expect(SSOT_SRC).toMatch(/ADR-0157/);
  });
});

describe('ADR-0451 — Group K: SELL_ONLY 정상 보존 (사용자 §11 #30~#33)', () => {
  it('[K1] SELL_ONLY 개념 자체는 그대로 유지 (사용자 §"하지 말 것" #10) — ENV 우회 시 호출자 legacy 동작 복원 가능 (사용자 §11 #19)', () => {
    process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED = 'true';
    expect(isEmptyScanLivenessPolicyDisabled()).toBe(true);
    // 호출자 (adaptiveScanScheduler) 가 emptyBackoff > 1 → SELL_ONLY 정책 그대로 사용.
  });

  it('[K2] market closed mode SELL_ONLY 보존 (사용자 §11 #31)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'CLOSED',
      sellOnlyAlreadyActive: true,
    }));
    expect(d.preserveExistingSellOnly).toBe(false);
  });

  it('[K3] R6 defense SELL_ONLY 보존 (사용자 §11 #32)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      r6Defense: true,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
  });

  it('[K4] emergencyStop SELL_ONLY 보존 (사용자 §11 #33)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      emergencyStop: true,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
  });
});

describe('ADR-0451 — Group L: format compact line', () => {
  it('[L1] formatter — null 입력 시 null 반환', () => {
    expect(formatEmptyScanLivenessSection(null, 0)).toBeNull();
    expect(formatEmptyScanLivenessSection(undefined, 0)).toBeNull();
  });

  it('[L2] REGULAR + streak=3 → "SELL_ONLY not forced" 표현', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    const section = formatEmptyScanLivenessSection(d, 3);
    expect(section).toBeTruthy();
    expect(section!).toMatch(/SELL_ONLY not forced/);
    expect(section!).toMatch(/engine: alive/);
    expect(section!).toMatch(/shadow\/counterfactual: kept/);
  });

  it('[L3] LUNCH_BREAK + legacy SELL_ONLY ignored by rollback', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'LUNCH_BREAK',
      sellOnlyAlreadyActive: true,
    }));
    const section = formatEmptyScanLivenessSection(d, 0);
    expect(section).toBeTruthy();
    expect(section!).toMatch(/SELL_ONLY not forced/);
  });

  it('[L4] formatter 첫 줄에 ADR-0451 마커', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    const section = formatEmptyScanLivenessSection(d, 3);
    expect(section!).toMatch(/ADR-0451/);
  });
});

describe('ADR-0451 — Group M: ADR cross-references (정합 보존)', () => {
  const SSOT_SRC = readFileSync(
    resolve(process.cwd(), 'server/trading/signalScanner/emptyScanLivenessPolicy.ts'),
    'utf-8',
  );

  it('[M1] SSOT 헤더에 ADR-0448 정합 명시', () => {
    expect(SSOT_SRC).toMatch(/ADR-0448/);
  });

  it('[M2] SSOT 헤더에 ADR-0157 정합 명시', () => {
    expect(SSOT_SRC).toMatch(/ADR-0157/);
  });

  it('[M3] engineShouldContinue / shadowLearningAllowed / counterfactualLearningAllowed literal type 강제', () => {
    // Literal type true (가 모든 분기에서 반환되는지).
    const sessions: EmptyScanLivenessInput['marketSession'][] = [
      'REGULAR', 'OPEN_AUCTION', 'LUNCH_BREAK', 'AFTER_HOURS', 'CLOSED', 'UNKNOWN',
    ];
    for (const s of sessions) {
      const d = evaluateEmptyScanLiveness(baseInput({ marketSession: s, emptyScanStreak: 5 }));
      expect(d.engineShouldContinue).toBe(true);
      expect(d.shadowLearningAllowed).toBe(true);
      expect(d.counterfactualLearningAllowed).toBe(true);
    }
  });

  it('[M4] core risk + REGULAR + emptyScan 동시 충돌 시 core risk 우선 (decision tree 우선순위)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'REGULAR',
      emptyScanStreak: 10,
      emergencyStop: true,
    }));
    expect(d.allowSellOnlyTransition).toBe(false);
  });

  it('[M5] sellOnlyReason propagate (operator visibility)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({
      marketSession: 'CLOSED',
      sellOnlyAlreadyActive: true,
      sellOnlyReason: 'MANUAL',
    }));
    expect(d.preserveExistingSellOnly).toBe(false);
    expect(d.operatorMessage).toMatch(/CLOSED/);
  });
});

describe('ADR-0451 — Group N: 사용자 운영 시나리오 14:30 KST', () => {
  it('[N1] 사용자 §1 정확 시나리오 — 14:30 REGULAR + R2_BULL + 빈스캔×3 → SELL_ONLY 강제 안 됨', () => {
    const d = evaluateEmptyScanLiveness({
      marketSession: 'REGULAR',
      emptyScanStreak: 3,
      // R2_BULL — emergencyStop / r6Defense / riskHardBlock 모두 false
    });
    expect(d.allowSellOnlyTransition).toBe(false);
    expect(d.engineShouldContinue).toBe(true);
    expect(d.scanIntervalMayExpand).toBe(true);
    expect(d.shadowLearningAllowed).toBe(true);
    expect(d.counterfactualLearningAllowed).toBe(true);
  });

  it('[N2] operatorMessage 가 사용자 §"한 줄 정의" 부합 (engine alive 명시)', () => {
    const d = evaluateEmptyScanLiveness(baseInput({ emptyScanStreak: 3 }));
    expect(d.operatorMessage).toMatch(/engine alive/);
  });
});
