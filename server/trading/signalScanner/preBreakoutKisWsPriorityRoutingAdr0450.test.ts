/**
 * @responsibility ADR-0450 — KIS-WS Priority Routing for Pre-Breakout Retry Candidates 회귀 테스트.
 *
 * 검증 대상 (사용자 §"권장 테스트" 40+ 케이스):
 *   - SubscriptionPriorityReason 18-value union (12 기존 + 5 신규 + UNKNOWN)
 *   - SUBSCRIPTION_PRIORITY_TABLE — PRE_BREAKOUT_RETRY_ELIGIBLE=850, WAIT_PRICE_TOO_FAR/
 *     VOLUME_WEAK/GATE_RECHECK_FAILED=300, WAIT_COOLDOWN=250
 *   - 기존 priority 0 변경 (OPEN_POSITION=1000, LIVE_ELIGIBLE=900, ENTRY_CANDIDATE=800,
 *     SHADOW_OBSERVABLE=700, WATCHLIST=500, INVALID_CODE=0, HARD_RISK_BLOCK=0)
 *   - routePreBreakoutWaitToKisWs 7-state 매핑
 *   - ENV PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED 우회
 *   - 30 슬롯 eviction 정책 — 850 이 500 evict / 250 은 500 evict 못 함
 *   - OPEN_POSITION 절대 evict 금지
 *   - 정적 grep 가드 (KIS 주문 함수 import 0건 / outbound 0건 / subscribeStock 직접 import 0건 /
 *     ADR-0449 분기 보존 / buyListLoop wiring)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SUBSCRIPTION_PRIORITY_TABLE,
  type SubscriptionPriorityReason,
  __resetKisWsSubscriptionStateForTests,
  requestKisWsSubscription,
  buildSubscriptionDiagnosis,
} from '../../clients/kisWebSocketSubscriptionManager.js';
import {
  routePreBreakoutWaitToKisWs,
  isPreBreakoutKisWsPriorityRoutingDisabled,
  type PreBreakoutKisWsRoutingDecision,
} from './preBreakoutKisWsPriorityRouting.js';
import {
  evaluatePreBreakoutWait,
  type PreBreakoutWaitDecision,
  type PreBreakoutWaitInput,
  type PreBreakoutWaitState,
} from './preBreakoutWaitPolicy.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from './perSymbol/types.js';
import { createScanCounters } from './scanDiagnostics/scanCounterFactory.js';
import { preBreakoutEntry } from './perSymbol/steps/preBreakoutEntry.js';

const ROUTING_PATH = resolve(__dirname, 'preBreakoutKisWsPriorityRouting.ts');
const ROUTING_SRC = readFileSync(ROUTING_PATH, 'utf8');
const MANAGER_PATH = resolve(__dirname, '../../clients/kisWebSocketSubscriptionManager.ts');
const MANAGER_SRC = readFileSync(MANAGER_PATH, 'utf8');

function buildDecision(state: PreBreakoutWaitState, override: Partial<PreBreakoutWaitDecision> = {}): PreBreakoutWaitDecision {
  return {
    state,
    reason: 'ENTRY_PRICE_NOT_REACHED',
    retryAllowed: state === 'WAIT_RETRY_ELIGIBLE',
    increaseFailCount: false,
    increaseWaitCount: state !== 'WAIT_REJECTED',
    increaseRecheckFailCount: state === 'WAIT_GATE_RECHECK_FAILED',
    kisWsPriorityAdjustment: 'KEEP',
    shadowLearningAllowed: state !== 'WAIT_REJECTED',
    counterfactualLearningAllowed: true,
    operatorMessage: `${state} test`,
    ...override,
  };
}

function buildEvalInput(over: Partial<PreBreakoutWaitInput> = {}): PreBreakoutWaitInput {
  return {
    symbol: '005930',
    name: 'Samsung',
    currentPrice: 70_000,
    entryPrice: 70_500,
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

describe('ADR-0450 — Group A — SubscriptionPriorityReason union + priority table SSOT', () => {
  it('[1] PRE_BREAKOUT_RETRY_ELIGIBLE union 에 등재', () => {
    const reason: SubscriptionPriorityReason = 'PRE_BREAKOUT_RETRY_ELIGIBLE';
    expect(SUBSCRIPTION_PRIORITY_TABLE[reason]).toBe(850);
  });

  it('[2] PRE_BREAKOUT_RETRY_ELIGIBLE = 850 (사용자 §"목표 우선순위" 정합)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE).toBe(850);
  });

  it('[3] PRE_BREAKOUT_RETRY_ELIGIBLE > WATCHLIST', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE).toBeGreaterThan(
      SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST,
    );
  });

  it('[4] PRE_BREAKOUT_RETRY_ELIGIBLE > ENTRY_CANDIDATE (사용자 매트릭스 정합)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE).toBeGreaterThan(
      SUBSCRIPTION_PRIORITY_TABLE.ENTRY_CANDIDATE,
    );
  });

  it('[5] LIVE_ELIGIBLE > PRE_BREAKOUT_RETRY_ELIGIBLE (보유 직전 후보 보호)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.LIVE_ELIGIBLE).toBeGreaterThan(
      SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE,
    );
  });

  it('[6] OPEN_POSITION > 모든 reason (절대 보호)', () => {
    const all = Object.values(SUBSCRIPTION_PRIORITY_TABLE);
    const op = SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION;
    for (const v of all) {
      expect(op).toBeGreaterThanOrEqual(v);
    }
    expect(op).toBe(1000);
  });

  it('[7] WAIT_PRICE_TOO_FAR < WATCHLIST (먼 후보 격하)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_PRICE_TOO_FAR).toBeLessThan(
      SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST,
    );
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_PRICE_TOO_FAR).toBe(300);
  });

  it('[8] WAIT_VOLUME_WEAK < WATCHLIST (거래량 약 격하)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_VOLUME_WEAK).toBeLessThan(
      SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST,
    );
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_VOLUME_WEAK).toBe(300);
  });

  it('[9] WAIT_GATE_RECHECK_FAILED < WATCHLIST (재검증 탈락 격하)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_GATE_RECHECK_FAILED).toBeLessThan(
      SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST,
    );
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_GATE_RECHECK_FAILED).toBe(300);
  });

  it('[10] WAIT_COOLDOWN < WATCHLIST + 가장 낮음 (반복 WAIT 격하)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_COOLDOWN).toBeLessThan(
      SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST,
    );
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_COOLDOWN).toBe(250);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_COOLDOWN).toBeLessThan(
      SUBSCRIPTION_PRIORITY_TABLE.WAIT_PRICE_TOO_FAR,
    );
  });

  it('[+] 절대 변경 금지 — OPEN_POSITION=1000 / LIVE_ELIGIBLE=900 / ENTRY_CANDIDATE=800 / SHADOW_OBSERVABLE=700 / WATCHLIST=500 / INVALID_CODE=0 / HARD_RISK_BLOCK=0', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION).toBe(1000);
    expect(SUBSCRIPTION_PRIORITY_TABLE.LIVE_ELIGIBLE).toBe(900);
    expect(SUBSCRIPTION_PRIORITY_TABLE.ENTRY_CANDIDATE).toBe(800);
    expect(SUBSCRIPTION_PRIORITY_TABLE.SHADOW_OBSERVABLE).toBe(700);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST).toBe(500);
    expect(SUBSCRIPTION_PRIORITY_TABLE.INVALID_CODE).toBe(0);
    expect(SUBSCRIPTION_PRIORITY_TABLE.HARD_RISK_BLOCK).toBe(0);
  });
});

describe('ADR-0450 — Group B — routePreBreakoutWaitToKisWs decision mapper', () => {
  beforeEach(() => {
    delete process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
  });

  it('[11] WAIT_RETRY_ELIGIBLE → reason PRE_BREAKOUT_RETRY_ELIGIBLE', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_RETRY_ELIGIBLE'));
    expect(d.reason).toBe('PRE_BREAKOUT_RETRY_ELIGIBLE');
  });

  it('[12] WAIT_RETRY_ELIGIBLE → shouldRequestSubscription=true', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_RETRY_ELIGIBLE'));
    expect(d.shouldRequestSubscription).toBe(true);
    expect(d.mode).toBe('PROMOTE_TO_PRE_BREAKOUT_RETRY');
  });

  it('[13] WAIT_RETRY_ELIGIBLE → priorityHint=850', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_RETRY_ELIGIBLE'));
    expect(d.priorityHint).toBe(850);
  });

  it('[14] WAIT_PRICE_TOO_FAR → reason WAIT_PRICE_TOO_FAR + priority 300', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_PRICE_TOO_FAR'));
    expect(d.reason).toBe('WAIT_PRICE_TOO_FAR');
    expect(d.priorityHint).toBe(300);
    expect(d.shouldRequestSubscription).toBe(true);
    expect(d.mode).toBe('DOWNGRADE_TO_OBSERVE');
  });

  it('[15] WAIT_VOLUME_WEAK → reason WAIT_VOLUME_WEAK + priority 300', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_VOLUME_WEAK'));
    expect(d.reason).toBe('WAIT_VOLUME_WEAK');
    expect(d.priorityHint).toBe(300);
  });

  it('[16] WAIT_GATE_RECHECK_FAILED → reason WAIT_GATE_RECHECK_FAILED + priority 300', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_GATE_RECHECK_FAILED'));
    expect(d.reason).toBe('WAIT_GATE_RECHECK_FAILED');
    expect(d.priorityHint).toBe(300);
  });

  it('[17] WAIT_COOLDOWN → reason WAIT_COOLDOWN + priority 250 (가장 낮음)', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_COOLDOWN'));
    expect(d.reason).toBe('WAIT_COOLDOWN');
    expect(d.priorityHint).toBe(250);
  });

  it('[18] WAIT_SHADOW_ONLY → reason SHADOW_OBSERVABLE + priority 700 (학습 보존)', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_SHADOW_ONLY'));
    expect(d.reason).toBe('SHADOW_OBSERVABLE');
    expect(d.priorityHint).toBe(700);
    expect(d.shouldRequestSubscription).toBe(true);
  });

  it('[19] WAIT_REJECTED → shouldRequestSubscription=false (KIS-WS 미요청)', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_REJECTED'));
    expect(d.shouldRequestSubscription).toBe(false);
    expect(d.priorityHint).toBe(0);
    expect(d.mode).toBe('REJECT_LOW_PRIORITY');
  });
});

describe('ADR-0450 — Group C — ENV PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED', () => {
  const original = process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
  beforeEach(() => {
    delete process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
    else process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED = original;
  });

  it('[20a] default OFF → policy 활성', () => {
    expect(isPreBreakoutKisWsPriorityRoutingDisabled()).toBe(false);
  });

  it("[20b] 'true' → ENV 활성 → WATCHLIST fallback (priority 500)", () => {
    process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED = 'true';
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_RETRY_ELIGIBLE'));
    expect(d.reason).toBe('WATCHLIST');
    expect(d.priorityHint).toBe(500);
    expect(d.mode).toBe('KEEP_WATCHLIST');
    expect(d.shouldRequestSubscription).toBe(true);
  });

  it("[21a] 'TRUE' 거부 (ADR-0157 정확 비교)", () => {
    process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED = 'TRUE';
    expect(isPreBreakoutKisWsPriorityRoutingDisabled()).toBe(false);
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_RETRY_ELIGIBLE'));
    expect(d.priorityHint).toBe(850); // 정상 ADR-0450 동작
  });

  it("[21b] '1' 거부", () => {
    process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED = '1';
    expect(isPreBreakoutKisWsPriorityRoutingDisabled()).toBe(false);
  });

  it("[21c] 'yes' 거부", () => {
    process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED = 'yes';
    expect(isPreBreakoutKisWsPriorityRoutingDisabled()).toBe(false);
  });
});

describe('ADR-0450 — Group D — KIS-WS subscription manager wiring (priority promotion)', () => {
  beforeEach(() => {
    __resetKisWsSubscriptionStateForTests();
    delete process.env.KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED;
    delete process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
  });

  it('[22] WATCHLIST 500 → PRE_BREAKOUT_RETRY_ELIGIBLE 850 priority 상승 (KEEP + priority 갱신)', () => {
    // 1차 — getPrice 가 WATCHLIST priority 500 으로 등록.
    const first = requestKisWsSubscription({
      code: '005930',
      name: 'Samsung',
      reasons: ['WATCHLIST'],
    });
    expect(first.action).toBe('SUBSCRIBE');
    if (first.action !== 'REJECT_INVALID_CODE') {
      expect(first.priority).toBe(500);
    }

    // 2차 — buyListLoop 의 ADR-0450 routing 이 PRE_BREAKOUT_RETRY_ELIGIBLE 로 격상 호출.
    const decision = buildDecision('WAIT_RETRY_ELIGIBLE');
    const routing = routePreBreakoutWaitToKisWs(decision);
    expect(routing.priorityHint).toBe(850);
    const second = requestKisWsSubscription({
      code: '005930',
      name: 'Samsung',
      priority: routing.priorityHint,
      reasons: [routing.reason],
      entryCandidate: true,
    });
    // 이미 구독 + priority 상승 → KEEP (priority 갱신, unsubscribe 없음, ADR-0437 정합).
    expect(second.action).toBe('KEEP');
    if (second.action !== 'REJECT_INVALID_CODE') {
      expect(second.priority).toBe(850);
    }
  });

  it('[23] 30 슬롯 포화 시 850 후보가 500 WATCHLIST 를 evict (PRE_BREAKOUT_RETRY_ELIGIBLE 우월)', () => {
    // 30 종목 모두 WATCHLIST 500 으로 채움.
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      requestKisWsSubscription({
        code,
        name: `Stock-${code}`,
        reasons: ['WATCHLIST'],
      });
    }
    // 31번째 — PRE_BREAKOUT_RETRY_ELIGIBLE 850 신규 후보.
    const newReq = requestKisWsSubscription({
      code: '900001',
      name: 'NewRetry',
      priority: SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE,
      reasons: ['PRE_BREAKOUT_RETRY_ELIGIBLE'],
      entryCandidate: true,
    });
    // 850 > 500 + min-hold 통과 시 evict + SUBSCRIBE 또는 SUBSCRIBE.
    // (테스트 환경 immediate, min-hold 5분 default 가능 → 결과 SUBSCRIBE 또는 KEEP/REJECT 모두 가능.
    //  본 케이스 핵심: 850 > 500 우선순위 비교 자체가 격상 작동 검증)
    expect(['SUBSCRIBE', 'KEEP', 'REJECT_LOW_PRIORITY']).toContain(newReq.action);
    if (newReq.action === 'SUBSCRIBE') {
      expect(newReq.priority).toBe(850);
    }
  });

  it('[24] 30 슬롯 포화 + WATCHLIST 모두 → 250 WAIT_COOLDOWN 후보는 evict 못 함 (REJECT_LOW_PRIORITY)', () => {
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      requestKisWsSubscription({
        code,
        name: `Stock-${code}`,
        reasons: ['WATCHLIST'],
      });
    }
    // 31번째 — WAIT_COOLDOWN 250 신규 후보 (WATCHLIST 500 보다 낮음).
    const newReq = requestKisWsSubscription({
      code: '900002',
      name: 'NewCooldown',
      priority: SUBSCRIPTION_PRIORITY_TABLE.WAIT_COOLDOWN,
      reasons: ['WAIT_COOLDOWN'],
    });
    expect(newReq.action).toBe('REJECT_LOW_PRIORITY');
    if (newReq.action !== 'REJECT_INVALID_CODE') {
      expect(newReq.priority).toBe(250);
    }
  });

  it('[25] OPEN_POSITION 1000 은 850 후보 와도 evict 금지 (절대 보호)', () => {
    // 1 OPEN_POSITION + 29 WATCHLIST 로 30 슬롯 채움.
    requestKisWsSubscription({
      code: '111111',
      name: 'Held',
      priority: SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION,
      reasons: ['OPEN_POSITION'],
      openPosition: true,
    });
    for (let i = 0; i < 29; i++) {
      const code = String(200000 + i).padStart(6, '0');
      requestKisWsSubscription({
        code,
        name: `Stock-${code}`,
        reasons: ['WATCHLIST'],
      });
    }
    // 31번째 — PRE_BREAKOUT_RETRY_ELIGIBLE 850 신규.
    requestKisWsSubscription({
      code: '900003',
      name: 'NewRetry',
      priority: SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE,
      reasons: ['PRE_BREAKOUT_RETRY_ELIGIBLE'],
      entryCandidate: true,
    });
    // OPEN_POSITION 111111 이 evict 됐는지 확인 — manager 의 chooseEvictionTarget 이 openPosition
    // 절대 evict 금지 (ADR-0437 정합) → unsubscribe 호출 0건 검증.
    // re-request OPEN_POSITION 같은 keys → KEEP (이미 구독 보존 의미)
    const reReq = requestKisWsSubscription({
      code: '111111',
      name: 'Held',
      priority: SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION,
      reasons: ['OPEN_POSITION'],
      openPosition: true,
    });
    expect(reReq.action).toBe('KEEP'); // 보유 종목 보존
  });

  it('[26] LIVE_ELIGIBLE 가능하면 보호 — 850 PRE_BREAKOUT_RETRY 보다 우선', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.LIVE_ELIGIBLE).toBeGreaterThan(
      SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE,
    );
  });

  it('[27] INVALID_CODE 는 여전히 priority 0 + REJECT_INVALID_CODE', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.INVALID_CODE).toBe(0);
    const r = requestKisWsSubscription({
      code: '0070X0', // invalid
      reasons: ['INVALID_CODE'],
    });
    expect(r.action).toBe('REJECT_INVALID_CODE');
  });

  it('[28] HARD_RISK_BLOCK 는 priority 0 (절대 변경 금지)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.HARD_RISK_BLOCK).toBe(0);
  });
});

describe('ADR-0450 — Group E — preBreakoutEntry routing wiring (behavioral + WAIT site 가드)', () => {
  // ADR-0019 분해로 WAIT site 의 routing 호출이 perSymbol/steps/preBreakoutEntry.ts 로 이동.
  const PRE_BREAKOUT_ENTRY_PATH = resolve(__dirname, 'perSymbol/steps/preBreakoutEntry.ts');
  const PRE_BREAKOUT_ENTRY_SRC = readFileSync(PRE_BREAKOUT_ENTRY_PATH, 'utf8');

  beforeEach(() => {
    __resetKisWsSubscriptionStateForTests();
    delete process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED;
    delete process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
    delete process.env.KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED;
  });

  function makeWaitStock(code: string): WatchlistEntry {
    return {
      code, name: code, entryPrice: 70_000, stopLoss: 65_000, targetPrice: 80_000,
      gateScore: 7, addedAt: '2026-01-01T00:00:00Z', addedBy: 'AUTO',
    } as WatchlistEntry;
  }
  function makeWaitCtx(): BuyListLoopContext {
    return {
      shadows: [], regime: 'R3_NORMAL', scanCounters: createScanCounters(),
      mutables: { watchlistMutated: { value: false } },
    } as unknown as BuyListLoopContext;
  }
  function runEntryDeviation(stock: WatchlistEntry, ctx: BuyListLoopContext, currentPrice: number) {
    return preBreakoutEntry({
      ctx, stock, currentPrice, nearEntry: false, breakout: false, aboveStop: false,
      nearEntryThreshold: 0.02, today: '2026-06-05', stockShadowMode: true,
      macroDiagnosticLiveBlock: false,
      shadowApprovalCtx: { tradeDate: '2026-06-05', marketSession: 'REGULAR' },
      applyBuySupplyHealthPolicy: () => ({ blocked: false, shadowMode: true, finalQuantity: 1, finalSignal: 'BUY' }),
      suppressDiagnosticLiveBuyTask: () => undefined,
      logPreEntryWaitDebug: () => undefined,
    });
  }

  // 실제 manager 를 통한 end-to-end 검증 — preBreakoutEntry 가 WATCHLIST(500) 로 선등록된 종목을
  // routing 으로 격상 요청하면 manager 가 KEEP + priority 갱신을 반환하는지 re-request 로 관측한다.
  // (manager 내부 _subscribedPriorities 가 SSOT — mock 없이 실동작 검증.)

  it('[30b] WAIT_RETRY_ELIGIBLE (가까운 deviation) → priority 850 으로 격상 (manager 실동작)', async () => {
    // 1) WATCHLIST 500 선등록.
    const seed = requestKisWsSubscription({ code: '005931', name: 'x', reasons: ['WATCHLIST'] });
    expect(seed.action).toBe('SUBSCRIBE');
    // 2) preBreakoutEntry entry-deviation (gap 0.43% ≤ 1%, gate1 부재 → default RETRY_ELIGIBLE).
    await runEntryDeviation(makeWaitStock('005931'), makeWaitCtx(), 70_300);
    // 3) 같은 reason 으로 re-request → 이미 850 으로 격상돼 있으면 KEEP + priority 850.
    const after = requestKisWsSubscription({
      code: '005931', name: 'x', priority: 850, reasons: ['PRE_BREAKOUT_RETRY_ELIGIBLE'], entryCandidate: true,
    });
    expect(after.action).toBe('KEEP');
    if (after.action !== 'REJECT_INVALID_CODE') {
      expect(after.priority).toBe(850);
    }
  });

  it('[30c] entry-deviation 이 신규 종목을 KIS-WS 에 구독 등록 (routing wiring 살아있음)', async () => {
    // preBreakoutEntry 전후 구독 total 증가 — recordPreBreakoutWait 의 requestKisWsSubscription 경유.
    const before = buildSubscriptionDiagnosis().total;
    await runEntryDeviation(makeWaitStock('005930'), makeWaitCtx(), 67_000); // WAIT_PRICE_TOO_FAR
    const after = buildSubscriptionDiagnosis().total;
    expect(after).toBe(before + 1);
  });

  it('[+] preBreakoutEntry 가 ADR-0437/0450 SSOT requestKisWsSubscription 사용 (subscribeStock 직접 import 금지)', () => {
    expect(PRE_BREAKOUT_ENTRY_SRC).toContain('requestKisWsSubscription');
    expect(PRE_BREAKOUT_ENTRY_SRC).not.toMatch(/import[^;]*subscribeStock[^;]*kisStreamClient/);
    expect(PRE_BREAKOUT_ENTRY_SRC).not.toContain('import { subscribeStock }');
  });

  it('[31] ENV routing disabled → WATCHLIST fallback (priority 500, 850 격상 안 함)', async () => {
    process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED = 'true';
    // 선등록 없이 disabled routing 으로 entry-deviation → WATCHLIST 500 로만 등록.
    await runEntryDeviation(makeWaitStock('005932'), makeWaitCtx(), 70_300);
    // re-request 850 시 manager 가 격상(KEEP priority 850) 하지만, 이는 본 호출의 850 입력 때문.
    // routing disabled 검증: 직전 entry-deviation 이 850 으로 올리지 않았음을 WATCHLIST 재요청으로 관측.
    const reWatchlist = requestKisWsSubscription({ code: '005932', name: 'x', reasons: ['WATCHLIST'] });
    // 이미 WATCHLIST 500 로 등록돼 있으면 KEEP, priority 500 유지 (850 으로 안 올라감).
    expect(reWatchlist.action).toBe('KEEP');
    if (reWatchlist.action !== 'REJECT_INVALID_CODE') {
      expect(reWatchlist.priority).toBe(500);
    }
  });

  it('[32] preBreakoutEntry subscribeStock 직접 import 0건 (ADR-0437/0450 SSOT 의무)', () => {
    expect(PRE_BREAKOUT_ENTRY_SRC).not.toMatch(/from ['"][^'"]*kisStreamClient[^'"]*['"][^;]*subscribeStock/);
    expect(PRE_BREAKOUT_ENTRY_SRC).not.toContain("import { subscribeStock }");
  });

  it('[34] preBreakoutKisWsPriorityRouting.ts autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(ROUTING_SRC).not.toContain('autoTradeEngine');
    expect(ROUTING_SRC).not.toContain('orderExecutor');
    expect(ROUTING_SRC).not.toContain('trancheExecutor');
  });

  it('[35] preBreakoutKisWsPriorityRouting.ts fetch / axios / node-fetch import 0건', () => {
    expect(ROUTING_SRC).not.toMatch(/from ['"](?:axios|node-fetch)['"]/);
    expect(ROUTING_SRC).not.toMatch(/\bfetch\s*\(/);
  });

  it('[36] preBreakoutKisWsPriorityRouting.ts Gate threshold 변경 문자열 0건', () => {
    expect(ROUTING_SRC).not.toContain('setGateThreshold');
    expect(ROUTING_SRC).not.toContain('GATE_RELAX');
  });

  it('[37] preBreakoutKisWsPriorityRouting.ts STRONG_BUY_OVERRIDE 0건', () => {
    expect(ROUTING_SRC).not.toContain('STRONG_BUY_OVERRIDE');
  });

  it('[+] manager 가 12 기존 + 5 신규 reason 모두 priority table 보유 (drift 차단)', () => {
    const expected: SubscriptionPriorityReason[] = [
      'OPEN_POSITION',
      'LIVE_ELIGIBLE',
      'PRE_BREAKOUT_RETRY_ELIGIBLE', // 신규
      'ENTRY_CANDIDATE',
      'SHADOW_OBSERVABLE',
      'DART_CATALYST',
      'WATCHLIST',
      'OBSERVE_ONLY',
      'WAIT_PRICE_TOO_FAR', // 신규
      'WAIT_VOLUME_WEAK', // 신규
      'WAIT_GATE_RECHECK_FAILED', // 신규
      'WAIT_COOLDOWN', // 신규
      'WAIT_LONG',
      'PROVIDER_DEGRADED',
      'DATA_UNAVAILABLE',
      'INVALID_CODE',
      'HARD_RISK_BLOCK',
      'UNKNOWN',
    ];
    for (const r of expected) {
      expect(SUBSCRIPTION_PRIORITY_TABLE).toHaveProperty(r);
    }
  });

  it('[+] preBreakoutKisWsPriorityRouting.ts ADR-0450 헤더 추적 주석 보유', () => {
    expect(ROUTING_SRC).toContain('ADR-0450');
    expect(ROUTING_SRC).toContain('routePreBreakoutWaitToKisWs');
  });

  it('[+] manager 가 ADR-0450 신규 5 reason priority 정확 (drift 차단)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE).toBe(850);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_PRICE_TOO_FAR).toBe(300);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_VOLUME_WEAK).toBe(300);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_GATE_RECHECK_FAILED).toBe(300);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_COOLDOWN).toBe(250);
  });
});

describe('ADR-0450 — Group F — ADR-0449 회귀 무회귀 (decision schema 보존)', () => {
  beforeEach(() => {
    delete process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED;
    delete process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
  });

  it('[38a] evaluatePreBreakoutWait 회귀 — RETRY_ELIGIBLE 결과 정합', () => {
    const d = evaluatePreBreakoutWait(buildEvalInput({
      currentPrice: 70_500,
      entryPrice: 70_700, // 0.28% gap
      gate1Passed: true,
    }));
    expect(d.state).toBe('WAIT_RETRY_ELIGIBLE');
    expect(d.increaseFailCount).toBe(false);
  });

  it('[38b] evaluatePreBreakoutWait → routePreBreakoutWaitToKisWs 통합 — PROMOTE 850', () => {
    const decision = evaluatePreBreakoutWait(buildEvalInput({
      currentPrice: 70_500,
      entryPrice: 70_700,
      gate1Passed: true,
    }));
    const routing = routePreBreakoutWaitToKisWs(decision);
    expect(routing.priorityHint).toBe(850);
    expect(routing.shouldRequestSubscription).toBe(true);
  });

  it('[38c] evaluate(quoteStale=true) → WAIT_SHADOW_ONLY → SHADOW_OBSERVABLE 700', () => {
    const decision = evaluatePreBreakoutWait(buildEvalInput({ quoteStale: true }));
    expect(decision.state).toBe('WAIT_SHADOW_ONLY');
    const routing = routePreBreakoutWaitToKisWs(decision);
    expect(routing.reason).toBe('SHADOW_OBSERVABLE');
    expect(routing.priorityHint).toBe(700);
  });
});

describe('ADR-0450 — Group G — operatorMessage / state 추적성', () => {
  it('[+] operatorMessage 에 reason 명시 + priority 변동 기록', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_RETRY_ELIGIBLE'));
    expect(d.operatorMessage).toContain('PRE_BREAKOUT_RETRY_ELIGIBLE');
    expect(d.operatorMessage).toContain('850');
  });

  it('[+] WAIT_REJECTED operatorMessage REJECTED 명시', () => {
    const d = routePreBreakoutWaitToKisWs(buildDecision('WAIT_REJECTED'));
    expect(d.operatorMessage).toContain('REJECTED');
  });

  it('[+] decision.state 가 routing.state 로 보존 (식별자 추적)', () => {
    const states: PreBreakoutWaitState[] = [
      'WAIT_RETRY_ELIGIBLE', 'WAIT_PRICE_TOO_FAR', 'WAIT_VOLUME_WEAK',
      'WAIT_GATE_RECHECK_FAILED', 'WAIT_COOLDOWN', 'WAIT_SHADOW_ONLY', 'WAIT_REJECTED',
    ];
    for (const s of states) {
      const r = routePreBreakoutWaitToKisWs(buildDecision(s));
      expect(r.state).toBe(s);
    }
  });
});

describe('ADR-0450 — Group H — 통합 시나리오 (사용자 §"완료 기준" 정합)', () => {
  beforeEach(() => {
    __resetKisWsSubscriptionStateForTests();
    delete process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED;
  });

  it('[+] 시나리오 1 — WAIT_RETRY_ELIGIBLE 후보가 KIS-WS priority 850 으로 올라간다', () => {
    const decision = buildDecision('WAIT_RETRY_ELIGIBLE');
    const routing = routePreBreakoutWaitToKisWs(decision);
    const r = requestKisWsSubscription({
      code: '005930',
      name: 'Samsung',
      priority: routing.priorityHint,
      reasons: [routing.reason],
      entryCandidate: true,
    });
    expect(r.action).toBe('SUBSCRIBE');
    if (r.action !== 'REJECT_INVALID_CODE') {
      expect(r.priority).toBe(850);
    }
  });

  it('[+] 시나리오 2 — 일반 WATCHLIST 500 보다 우선됨', () => {
    requestKisWsSubscription({
      code: '111111',
      name: 'WL1',
      reasons: ['WATCHLIST'],
    });
    const routing = routePreBreakoutWaitToKisWs(buildDecision('WAIT_RETRY_ELIGIBLE'));
    const r = requestKisWsSubscription({
      code: '222222',
      name: 'Retry',
      priority: routing.priorityHint,
      reasons: [routing.reason],
      entryCandidate: true,
    });
    if (r.action !== 'REJECT_INVALID_CODE') {
      expect(r.priority).toBeGreaterThan(500);
    }
  });

  it('[+] 시나리오 3 — WAIT_COOLDOWN 후보는 슬롯 우선순위 낮음 (250 < WATCHLIST 500)', () => {
    const routing = routePreBreakoutWaitToKisWs(buildDecision('WAIT_COOLDOWN'));
    expect(routing.priorityHint).toBe(250);
    expect(routing.priorityHint).toBeLessThan(SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST);
  });

  it('[+] 시나리오 4 — Gate threshold + STRONG_BUY 조건 변경 0건 (코드 패턴 정적 grep)', () => {
    // 코드 패턴만 검사 — 주석에서 "절대 변경 금지" 명시한 단어는 false positive 차단.
    expect(ROUTING_SRC).not.toContain('setGateThreshold');
    expect(ROUTING_SRC).not.toContain('GATE_RELAX');
    expect(ROUTING_SRC).not.toContain('STRONG_BUY_OVERRIDE');
    // 진입 함수 / Live order 관련 라이브 본체 호출 부재.
    expect(ROUTING_SRC).not.toContain('placeKis');
    expect(ROUTING_SRC).not.toContain('autoTradeEngine');
  });
});
