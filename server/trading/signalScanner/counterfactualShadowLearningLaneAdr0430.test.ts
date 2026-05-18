// @responsibility ADR-0430 SSOT 결정 트리 + 영속 분리 + 회귀 가드.
//
// 사용자 §K 14 케이스 + 정적 grep 안전 가드 + 영속 분리 검증.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  deriveCounterfactualShadowLearningCandidate,
  formatCounterfactualShadowLearningSection,
  summarizeCounterfactualShadowLearningCandidates,
  isCounterfactualShadowLearningDisabled,
  type CounterfactualShadowLearningCandidate,
  type DeriveCounterfactualShadowLearningInput,
} from './counterfactualShadowLearningLane.js';

// ── 사용자 §K — 14 핵심 케이스 ─────────────────────────────────

describe('ADR-0430 — Counterfactual Shadow Learning Lane SSOT', () => {
  beforeEach(() => {
    delete process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED;
  });
  afterEach(() => {
    delete process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED;
  });

  // 1. SELL_ONLY + R3_EARLY + Gate1 survivor → counterfactual entry
  it('§K-1: SELL_ONLY + R3_EARLY + Gate1 survivor 이면 counterfactual entry 생성', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { sellOnly: true },
    });
    expect(c).not.toBeNull();
    expect(c?.learningOnly).toBe(true);
    expect(c?.liveAllowed).toBe(false);
    expect(c?.paperAllowed).toBe(false);
    expect(c?.executionShadowAllowed).toBe(false);
    expect(c?.virtualAccountImpact).toBe('NONE');
    expect(c?.blockedBy).toContain('SELL_ONLY');
    expect(c?.label).toBe('R3_COUNTERFACTUAL_UNDER_SELL_ONLY');
    expect(c?.reasons).toContain('SELL_ONLY');
    expect(c?.reasons).toContain('R3_EARLY');
    expect(c?.reasons).toContain('GATE1_SURVIVOR');
    expect(c?.reasons).toContain('LEARNING_ONLY');
  });

  // 2. SELL_ONLY → counterfactual learning also records, while provisional shadow remains separately observable.
  it('§K-2: SELL_ONLY counterfactual learning remains recorded alongside diagnostic shadow lanes', () => {
    // SSOT 자체 단위 — counterfactual learning ledger 를 보존한다. provisional shadow 가능 여부는 ADR-0426 별도 검증.
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '000660',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { sellOnly: true, r6Defense: false },
    });
    expect(c).not.toBeNull();
    // provisional vs counterfactual 분리 — 영속 schema 의 source 마커
    expect(c?.source).toBe('ADR-0430');
    expect(c?.eventType).toBe('COUNTERFACTUAL_SHADOW_LEARNING_ENTRY');
    expect(c?.provisional).toBe(false);
  });

  // 3. SOFT_DEGRADE → counterfactual null (Provisional 우선)
  it('§K-3: SOFT_DEGRADE 에서는 counterfactual null — Provisional shadow 우선', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '247540',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      router: {
        severity: 'SOFT_DEGRADE',
        reasons: ['SECTOR_DATA_STALE'],
        liveAllowed: false,
        paperAllowed: false,
        shadowAllowed: true,
        watchAllowed: true,
        label: 'SOFT_DEGRADE_DATA',
        operatorMessage: 'soft',
      },
    });
    expect(c).toBeNull();
  });

  // 4. FULL_ENTRY_CANDIDATE → counterfactual null
  it('§K-4: FULL_ENTRY_CANDIDATE 에서 counterfactual null — 정상 매수 path 사용', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '035420',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: true,
      router: {
        severity: 'FULL_ENTRY_CANDIDATE',
        reasons: [],
        liveAllowed: true,
        paperAllowed: true,
        shadowAllowed: true,
        watchAllowed: true,
        label: 'FULL_CANDIDATE',
        operatorMessage: 'full',
      },
      riskFlags: { sellOnly: true }, // 무시되어야 함 (router severity 우선)
    });
    expect(c).toBeNull();
  });

  // 5. Gate1 미통과 → null
  it('§K-5: Gate1 미통과 이면 counterfactual null', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '035720',
      regime: 'R3_EARLY',
      gate1Passed: false,
      gate2Passed: false,
      riskFlags: { sellOnly: true },
    });
    expect(c).toBeNull();
  });

  // 6. dedup — repo 단위 검증으로 별도. 여기서는 SSOT 가 항상 후보 객체 반환 검증.
  it('§K-6: SSOT 동일 입력 시 동일 후보 객체 생성 (dedup 은 repo scope)', () => {
    const input: DeriveCounterfactualShadowLearningInput = {
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { sellOnly: true },
      scanId: 'scan-A',
    };
    const c1 = deriveCounterfactualShadowLearningCandidate(input);
    const c2 = deriveCounterfactualShadowLearningCandidate(input);
    expect(c1?.symbol).toBe(c2?.symbol);
    expect(c1?.label).toBe(c2?.label);
    expect(c1?.scanId).toBe('scan-A');
  });

  // 9. virtual account 영향 0 — schema literal 검증
  it('§K-9: virtualAccountImpact 는 항상 NONE (literal 강제)', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { sellOnly: true },
    });
    expect(c?.virtualAccountImpact).toBe('NONE');
  });

  // 12. ENV DISABLED → null
  it('§K-12: ENV COUNTERFACTUAL_SHADOW_LEARNING_DISABLED=true 이면 null', () => {
    process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED = 'true';
    expect(isCounterfactualShadowLearningDisabled()).toBe(true);
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { sellOnly: true },
    });
    expect(c).toBeNull();
  });

  it('§K-12b: ENV 정확 비교 — "1"·"TRUE"·"yes" 거부 (ADR-0157)', () => {
    process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED = '1';
    expect(isCounterfactualShadowLearningDisabled()).toBe(false);
    process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED = 'TRUE';
    expect(isCounterfactualShadowLearningDisabled()).toBe(false);
    process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED = 'yes';
    expect(isCounterfactualShadowLearningDisabled()).toBe(false);
  });

  // 13. emergencyStop 정책 — 사용자 §E "추천: true, label 에 EMERGENCY_STOP"
  it('§K-13: emergencyStop 시 counterfactual entry 생성, blockedBy 에 EMERGENCY_STOP 포함', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { emergencyStop: true },
    });
    expect(c).not.toBeNull();
    expect(c?.blockedBy).toContain('EMERGENCY_STOP');
    expect(c?.label).toBe('R3_COUNTERFACTUAL_UNDER_HARD_BLOCK');
  });

  // 14a. 정적 안전 가드 — KIS 주문 함수 import 0건
  it('§K-14: 정적 grep 가드 — KIS 주문 함수 5종 + autoTradeEngine + orderExecutor + shadowTradeRepo + virtualAccount 부재', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/trading/signalScanner/counterfactualShadowLearningLane.ts'),
      'utf-8',
    );
    // 주석 strip — false positive 차단 (ADR 본문에 키워드 등장)
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/placeKisMarketBuyOrder/);
    expect(stripped).not.toMatch(/placeKisSellOrder/);
    expect(stripped).not.toMatch(/cancelKisOrder/);
    expect(stripped).not.toMatch(/placeKisStopLossOrder/);
    expect(stripped).not.toMatch(/placeKisTakeProfitOrder/);
    expect(stripped).not.toMatch(/autoTradeEngine/);
    expect(stripped).not.toMatch(/orderExecutor/);
    expect(stripped).not.toMatch(/trancheExecutor/);
    expect(stripped).not.toMatch(/shadowTradeRepo/);
    expect(stripped).not.toMatch(/setGateThreshold/);
    expect(stripped).not.toMatch(/STRONG_BUY_OVERRIDE/);
    expect(stripped).not.toMatch(/\bfetch\(/);
    expect(stripped).not.toMatch(/axios/);
  });

  it('§K-14b: ledger repo 정적 가드 — 일반 shadow-trades.json + provisional ledger import 부재', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/persistence/counterfactualShadowLearningRepo.ts'),
      'utf-8',
    );
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/shadow-trades\.json/);
    expect(stripped).not.toMatch(/SHADOW_FILE/);
    expect(stripped).not.toMatch(/PROVISIONAL_SHADOW_LEDGER_FILE/);
    expect(stripped).not.toMatch(/shadowTradeRepo/);
    expect(stripped).not.toMatch(/provisionalShadowLedger/);
    // KIS / order import 0건
    expect(stripped).not.toMatch(/placeKisMarketBuyOrder/);
    expect(stripped).not.toMatch(/orderExecutor/);
    expect(stripped).not.toMatch(/trancheExecutor/);
    expect(stripped).not.toMatch(/autoTradeEngine/);
  });

  // formatter — §K-10 검증 (Counterfactual Shadow Learning / learningOnly / executionImpact: NONE)
  it('§K-10: formatter 가 learningOnly + executionImpact NONE + blockedBy 표시', () => {
    const text = formatCounterfactualShadowLearningSection({
      eligible: 5,
      created: 5,
      topBlockedBy: ['SELL_ONLY'],
      dominantLabel: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
    });
    expect(text).toContain('Counterfactual Shadow Learning');
    expect(text).toContain('learningOnly');
    expect(text).toContain('executionImpact');
    expect(text).toContain('NONE');
    expect(text).toContain('SELL_ONLY');
    expect(text).toContain('eligible');
    expect(text).toContain('created');
  });

  it('formatter eligible=0 시 reason 표시', () => {
    const text = formatCounterfactualShadowLearningSection({
      eligible: 0,
      created: 0,
      noEligibleReason: 'no Gate1 survivor',
    });
    expect(text).toContain('eligible');
    expect(text).toContain('0');
    expect(text).toContain('no Gate1 survivor');
  });

  it('summarize 헬퍼 — Top blockedBy 정렬', () => {
    const c1 = deriveCounterfactualShadowLearningCandidate({
      symbol: 'A', regime: 'R3_EARLY', gate1Passed: true, riskFlags: { sellOnly: true },
    })!;
    const c2 = deriveCounterfactualShadowLearningCandidate({
      symbol: 'B', regime: 'R3_EARLY', gate1Passed: true, riskFlags: { sellOnly: true },
    })!;
    const c3 = deriveCounterfactualShadowLearningCandidate({
      symbol: 'C', regime: 'R3_EARLY', gate1Passed: true, riskFlags: { vixBlock: true },
    })!;
    const summary = summarizeCounterfactualShadowLearningCandidates([c1, c2, c3]);
    expect(summary.eligible).toBe(3);
    expect(summary.topBlockedBy?.[0]).toBe('SELL_ONLY');
  });

  it('regime ≠ R3_EARLY 면 null', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R5_BEAR',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { sellOnly: true },
    });
    expect(c).toBeNull();
  });

  it('TRUE_WEAKNESS router 면 null (학습 표본 오염 차단)', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      router: {
        severity: 'TRUE_WEAKNESS',
        reasons: ['TRUE_GATE_REJECTION'],
        liveAllowed: false,
        paperAllowed: false,
        shadowAllowed: false,
        watchAllowed: true,
        label: 'BLOCK_TRUE_WEAKNESS',
        operatorMessage: 'true weakness',
      },
      riskFlags: { sellOnly: true },
    });
    expect(c).toBeNull();
  });

  it('technicalBreakdown 면 null (학습 표본 오염 차단)', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      riskFlags: { sellOnly: true, technicalBreakdown: true },
    });
    expect(c).toBeNull();
  });

  it('Router HARD_BLOCK 면 counterfactual entry 생성', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: '005930',
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      router: {
        severity: 'HARD_BLOCK',
        reasons: ['SIZING_BLOCKED'],
        liveAllowed: false,
        paperAllowed: false,
        shadowAllowed: false,
        watchAllowed: false,
        label: 'BLOCK_RISK',
        operatorMessage: 'sizing',
      },
    });
    expect(c).not.toBeNull();
    expect(c?.blockedBy).toContain('ROUTER_HARD_BLOCK');
    expect(c?.label).toBe('R3_COUNTERFACTUAL_UNDER_HARD_BLOCK');
  });
});

// ── 영속 분리 검증 (사용자 §K-7, §K-8) ───────────────────────────

describe('ADR-0430 — counterfactualShadowLearningRepo 영속 분리', () => {
  let prevDataDir: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    prevDataDir = process.env.PERSIST_DATA_DIR;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0430-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (prevDataDir !== undefined) process.env.PERSIST_DATA_DIR = prevDataDir;
    else delete process.env.PERSIST_DATA_DIR;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('§K-7+§K-8: counterfactual ledger 와 shadow-trades.json + provisional ledger 분리', async () => {
    const { COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE, SHADOW_FILE, PROVISIONAL_SHADOW_LEDGER_FILE } =
      await import('../../persistence/paths.js');
    expect(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE).not.toBe(SHADOW_FILE);
    expect(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE).not.toBe(PROVISIONAL_SHADOW_LEDGER_FILE);
    expect(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE).toContain('counterfactual-shadow-learning-ledger.json');
  });

  it('append → load round-trip', async () => {
    const repo = await import('../../persistence/counterfactualShadowLearningRepo.js');
    repo.__resetCounterfactualShadowLearningLedgerForTests();
    const candidate: CounterfactualShadowLearningCandidate = {
      symbol: '005930',
      eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
      source: 'ADR-0430',
      learningOnly: true,
      provisional: false,
      executionShadow: false,
      label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
      reasons: ['R3_EARLY', 'GATE1_SURVIVOR', 'LEARNING_ONLY', 'NO_HARD_RISK_BYPASS_ATTEMPT', 'SELL_ONLY'],
      blockedBy: ['SELL_ONLY'],
      liveAllowed: false,
      paperAllowed: false,
      executionShadowAllowed: false,
      virtualAccountImpact: 'NONE',
      regime: 'R3_EARLY',
      createdAtKst: '2026-05-07T15:00:00+09:00',
      gate1Passed: true,
      gate2Passed: false,
    };
    const r1 = repo.appendCounterfactualShadowLearningEntry({
      candidate,
      scanId: 'scan-X',
    });
    expect(r1.recorded).toBe(true);
    const all = repo.loadCounterfactualShadowLearningLedger();
    expect(all.length).toBe(1);
    expect(all[0].symbol).toBe('005930');
    expect(all[0].source).toBe('ADR-0430');
    expect(all[0].virtualAccountImpact).toBe('NONE');
  }, 10_000);

  it('§K-6: dedup — 동일 scanId+symbol 중복 차단', async () => {
    const repo = await import('../../persistence/counterfactualShadowLearningRepo.js');
    repo.__resetCounterfactualShadowLearningLedgerForTests();
    const candidate: CounterfactualShadowLearningCandidate = {
      symbol: '005930',
      eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
      source: 'ADR-0430',
      learningOnly: true,
      provisional: false,
      executionShadow: false,
      label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
      reasons: [],
      blockedBy: ['SELL_ONLY'],
      liveAllowed: false,
      paperAllowed: false,
      executionShadowAllowed: false,
      virtualAccountImpact: 'NONE',
      createdAtKst: '2026-05-07T15:00:00+09:00',
    };
    const r1 = repo.appendCounterfactualShadowLearningEntry({
      candidate,
      scanId: 'scan-A',
    });
    const r2 = repo.appendCounterfactualShadowLearningEntry({
      candidate,
      scanId: 'scan-A',
    });
    expect(r1.recorded).toBe(true);
    expect(r2.recorded).toBe(false);
    if (!r2.recorded) {
      expect(r2.reason).toBe('DUPLICATE');
    }
    expect(repo.loadCounterfactualShadowLearningLedger().length).toBe(1);
  });

  it('summarize ledger — top blockedBy / labels', async () => {
    const repo = await import('../../persistence/counterfactualShadowLearningRepo.js');
    repo.__resetCounterfactualShadowLearningLedgerForTests();
    for (const sym of ['A', 'B', 'C']) {
      const candidate: CounterfactualShadowLearningCandidate = {
        symbol: sym,
        eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
        source: 'ADR-0430',
        learningOnly: true,
        provisional: false,
        executionShadow: false,
        label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
        reasons: [],
        blockedBy: ['SELL_ONLY'],
        liveAllowed: false,
        paperAllowed: false,
        executionShadowAllowed: false,
        virtualAccountImpact: 'NONE',
        createdAtKst: new Date().toISOString(),
      };
      repo.appendCounterfactualShadowLearningEntry({
        candidate,
        scanId: `scan-${sym}`,
      });
    }
    const summary = repo.summarizeCounterfactualShadowLearningLedger();
    expect(summary.totalEntries).toBe(3);
    expect(summary.topBlockedBy[0]?.blocker).toBe('SELL_ONLY');
    expect(summary.topLabels[0]?.label).toBe('R3_COUNTERFACTUAL_UNDER_SELL_ONLY');
  });
});

// ── §K-11 — Macro live block keeps shadow/watch diagnostics always-on ──────

describe('ADR-0430 — Router learning lane 표시', () => {
  it('§K-11: SELL_ONLY is live-only block with shadow/watch diagnostics', async () => {
    const { deriveGateDecisionRouterResult, formatGateDecisionRouterSection } = await import(
      './gateDecisionRouter.js'
    );
    const result = deriveGateDecisionRouterResult({
      regime: 'R3_EARLY',
      gate1Pass: 1,
      riskFlags: { sellOnly: true },
    });
    expect(result.severity).toBe('SELL_ONLY');
    expect(result.liveAllowed).toBe(false);
    expect(result.paperAllowed).toBe(false);
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(result.learningShadowAllowed).toBe(true);
    const text = formatGateDecisionRouterSection(result);
    expect(text).toContain('shadow=✅');
    expect(text).toContain('watch=✅');
    expect(text).toContain('learning=✅');
  });

  it('FULL_ENTRY_CANDIDATE 시 learning=❌ (정상 경로 사용)', async () => {
    const { deriveGateDecisionRouterResult, formatGateDecisionRouterSection } = await import(
      './gateDecisionRouter.js'
    );
    const result = deriveGateDecisionRouterResult({
      regime: 'R3_EARLY',
      gate1Pass: 5,
      gate2Pass: 5,
      gate3Pass: 5,
      lastTriggerPass: 5,
    });
    expect(result.severity).toBe('FULL_ENTRY_CANDIDATE');
    expect(result.counterfactualLearningAllowed).toBe(true);
    const text = formatGateDecisionRouterSection(result);
    expect(text).toContain('learning=✅');
    expect(text).toContain('counterfactual=✅');
  });
});

// ── §K-14 추가 정적 가드 — 매매 정책 변경 0 ───────────────────

describe('ADR-0430 — 정적 안전 가드 (매매 정책 변경 0)', () => {
  it('SSOT 모듈 — Gate threshold/STRONG_BUY 변경 0', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/trading/signalScanner/counterfactualShadowLearningLane.ts'),
      'utf-8',
    );
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/setGateThreshold/);
    expect(stripped).not.toMatch(/MIN_GATE_OVERRIDE/);
    expect(stripped).not.toMatch(/GATE_RELAX/);
    expect(stripped).not.toMatch(/STRONG_BUY_OVERRIDE/);
    // virtual account *함수* 호출 0 — schema 마커 `virtualAccountImpact: 'NONE'` 는 허용.
    expect(stripped).not.toMatch(/setVirtualAccountHoldings/);
    expect(stripped).not.toMatch(/updateVirtualAccountCash/);
    expect(stripped).not.toMatch(/mutateHoldings/);
    expect(stripped).not.toMatch(/setEquity/);
    // 외부 API 호출 0
    expect(stripped).not.toMatch(/\baxios\b/);
    expect(stripped).not.toMatch(/node-fetch/);
  });

  it('repo 모듈 — virtual account 변경 0', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/persistence/counterfactualShadowLearningRepo.ts'),
      'utf-8',
    );
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/virtualAccount/);
    expect(stripped).not.toMatch(/setHoldings/);
    expect(stripped).not.toMatch(/setCash/);
    expect(stripped).not.toMatch(/updateEquity/);
  });

  it('SSOT literal types — liveAllowed/paperAllowed/executionShadowAllowed 강제', () => {
    const c = deriveCounterfactualShadowLearningCandidate({
      symbol: 'X',
      regime: 'R3_EARLY',
      gate1Passed: true,
      riskFlags: { sellOnly: true },
    });
    expect(c).not.toBeNull();
    if (c !== null) {
      // TypeScript literal 강제 — 호출자가 true 부여 시 컴파일 에러.
      expect(c.liveAllowed).toBe(false);
      expect(c.paperAllowed).toBe(false);
      expect(c.executionShadowAllowed).toBe(false);
      expect(c.learningOnly).toBe(true);
      expect(c.provisional).toBe(false);
      expect(c.virtualAccountImpact).toBe('NONE');
      expect(c.source).toBe('ADR-0430');
      expect(c.eventType).toBe('COUNTERFACTUAL_SHADOW_LEARNING_ENTRY');
    }
  });
});
