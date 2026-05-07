// @responsibility ADR-0433 Counterfactual Universe Learning Repo 회귀 테스트.
//
// 사용자 §J 16+ 케이스 + 정적 grep 가드 (KIS 주문 import 0건 / virtual account 무영향 /
// shadow-trades / provisional / counterfactual-candidate ledger 와 파일 분리).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_PATH = join(__dirname, 'counterfactualUniverseLearningRepo.ts');
const REPO_SOURCE_RAW = fs.readFileSync(REPO_PATH, 'utf-8');
const WIRING_PATH = join(
  __dirname,
  '..',
  'trading',
  'signalScanner',
  'counterfactualUniverseLearningWiring.ts',
);
const WIRING_SOURCE_RAW = fs.readFileSync(WIRING_PATH, 'utf-8');

// stripComments — block comments + line comments 제거. 정적 grep 가드가 invariant
// 코멘트 안의 식별자 ("orderExecutor 0건" 같은 안전 invariant 명문화) 와 충돌하지 않도록
// 본 source 검사에서는 코드 영역만 확인.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/[^\n]\s+\/\/.*$/gm, (m) => m.split('//')[0]);
}
const REPO_SOURCE = stripComments(REPO_SOURCE_RAW);
const WIRING_SOURCE = stripComments(WIRING_SOURCE_RAW);

let TEST_DIR: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'counterfactual-universe-test-'));
  originalDataDir = process.env.PERSIST_DATA_DIR;
  process.env.PERSIST_DATA_DIR = TEST_DIR;
  delete process.env.COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED;
  // paths.ts 가 PERSIST_DATA_DIR 을 module-load 시점에 1회만 resolve 하므로 매 테스트마다
  // module cache reset → 새 TEST_DIR 가 DATA_DIR 로 사용되도록 강제.
  vi.resetModules();
  const { __resetCounterfactualUniverseLearningLedgerForTests } = await import(
    './counterfactualUniverseLearningRepo.js'
  );
  __resetCounterfactualUniverseLearningLedgerForTests();
});

afterEach(() => {
  if (originalDataDir !== undefined) process.env.PERSIST_DATA_DIR = originalDataDir;
  else delete process.env.PERSIST_DATA_DIR;
  delete process.env.COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED;
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

const baseSnapshot = {
  id: 'cul-202605070900-abcd',
  eventType: 'COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT' as const,
  source: 'ADR-0433' as const,
  learningOnly: true as const,
  executionShadow: false as const,
  virtualAccountImpact: 'NONE' as const,
  liveAllowed: false as const,
  paperAllowed: false as const,
  executionShadowAllowed: false as const,
  scanId: 'scan-A',
  createdAtKst: '2026-05-07T09:00:00+09:00',
  regime: 'R6_DEFENSE',
  blockedBy: ['SELL_ONLY'],
  reasons: ['SELL_ONLY_PREFLIGHT' as const],
  preflightStage: 'AFTER_UNIVERSE_BUILD' as const,
};

describe('ADR-0433 Counterfactual Universe Learning Repo', () => {
  // ────────────────────────────────────────────────────────
  // §J #1: SELL_ONLY preflight abort → universe learning snapshot 생성
  // ────────────────────────────────────────────────────────
  it('§J#1: SELL_ONLY preflight 시 learning snapshot 생성', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    const result = recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-1',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    expect(result.recorded).toBe(true);
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger).toHaveLength(1);
    const e = ledger[0];
    expect(e.eventType).toBe('COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT');
    expect(e.source).toBe('ADR-0433');
    expect(e.learningOnly).toBe(true);
    expect(e.executionShadow).toBe(false);
    expect(e.virtualAccountImpact).toBe('NONE');
    expect(e.liveAllowed).toBe(false);
    expect(e.paperAllowed).toBe(false);
    expect(e.executionShadowAllowed).toBe(false);
    expect(e.blockedBy).toEqual(['SELL_ONLY']);
    expect(e.reasons).toEqual(['SELL_ONLY_PREFLIGHT']);
  });

  // ────────────────────────────────────────────────────────
  // §J #2: 후보 목록 없으면 candidateSummaryCount=0
  // ────────────────────────────────────────────────────────
  it('§J#2: 후보 목록 없으면 candidateSummaryCount=0', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-empty',
      preflightStage: 'BEFORE_UNIVERSE_BUILD',
      blockedBy: ['EMERGENCY_STOP'],
      reasons: ['EMERGENCY_STOP_PREFLIGHT'],
    });
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].candidateSummaryCount).toBe(0);
    expect(ledger[0].candidates).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────
  // §J #3: 후보 목록 있으면 Top N 50개만 영속
  // ────────────────────────────────────────────────────────
  it('§J#3: 후보 목록 ≤50 lightweight summary 만 저장', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    const candidates = Array.from({ length: 100 }, (_, i) => ({
      symbol: `00${(i + 1).toString().padStart(4, '0')}`,
      name: `종목${i + 1}`,
      lastPrice: 10000 + i,
      sector: '반도체',
    }));
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-big',
      preflightStage: 'AFTER_CANDIDATE_SCAN',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
      candidates,
    });
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger[0].candidateSummaryCount).toBe(50);
    expect(ledger[0].candidates?.length).toBe(50);
  });

  // ────────────────────────────────────────────────────────
  // §J #4: raw payload 절대 저장 금지 — symbol 만 추출
  // ────────────────────────────────────────────────────────
  it('§J#4: raw candidate payload 저장 금지 — lightweight subset 만', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    const fatCandidate = {
      symbol: '005930',
      name: '삼성전자',
      lastPrice: 70000,
      sector: '반도체',
      // 노이즈 raw 필드들 — 절대 저장되어선 안 됨
      apiResponseRaw: { kis: { token: 'SECRET-TOKEN' } },
      bloatedHistory: Array(1000).fill({ ts: Date.now(), price: 70000 }),
    };
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-fat',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
      candidates: [fatCandidate],
    });
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    const c = ledger[0].candidates?.[0];
    expect(c).toBeDefined();
    expect(c?.symbol).toBe('005930');
    expect(c?.name).toBe('삼성전자');
    expect(c?.lastPrice).toBe(70000);
    expect(c?.sector).toBe('반도체');
    // 다음 raw 필드는 lightweight subset 에 절대 포함 안 됨
    expect((c as unknown as Record<string, unknown>).apiResponseRaw).toBeUndefined();
    expect((c as unknown as Record<string, unknown>).bloatedHistory).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────
  // §J #5: 동일 scanId+stage 중복 record 차단
  // ────────────────────────────────────────────────────────
  it('§J#5: 동일 scanId+stage dedup 차단', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    const r1 = recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-dup',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    const r2 = recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-dup',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    expect(r1.recorded).toBe(true);
    expect(r2.recorded).toBe(false);
    expect(r2.reason).toBe('duplicate');
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger).toHaveLength(1);
  });

  // ────────────────────────────────────────────────────────
  // §J #6: emergencyStop preflight 도 learning snapshot 생성 (사용자 명시 정책 — blockedBy 명시)
  // ────────────────────────────────────────────────────────
  it('§J#6: emergencyStop preflight 도 snapshot 생성 + blockedBy=EMERGENCY_STOP_PREFLIGHT', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot, deriveUniverseLearningReason } =
      await import('../trading/signalScanner/counterfactualUniverseLearningWiring.js');
    const reason = deriveUniverseLearningReason('EMERGENCY_STOP');
    expect(reason).toBe('EMERGENCY_STOP_PREFLIGHT');
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-emstop',
      preflightStage: 'BEFORE_UNIVERSE_BUILD',
      blockedBy: ['EMERGENCY_STOP'],
      reasons: [reason],
      marketSnapshot: { emergencyStop: true },
    });
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].reasons).toContain('EMERGENCY_STOP_PREFLIGHT');
    expect(ledger[0].marketSnapshot?.emergencyStop).toBe(true);
  });

  // ────────────────────────────────────────────────────────
  // §J #7: ENV COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED=true → 생성 안 됨
  // ────────────────────────────────────────────────────────
  it('§J#7: ENV DISABLED 시 record 안 됨', async () => {
    process.env.COUNTERFACTUAL_UNIVERSE_LEARNING_DISABLED = 'true';
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    const r = recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-env',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    expect(r.recorded).toBe(false);
    expect(r.reason).toBe('env-disabled');
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────
  // §J #8: ADR-0430 candidate ledger 와 파일 분리
  // ────────────────────────────────────────────────────────
  it('§J#8: ADR-0430 candidate ledger 와 영속 파일 분리', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-sep',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    // counterfactual-universe-learning-ledger.json 존재
    const universePath = path.join(TEST_DIR, 'counterfactual-universe-learning-ledger.json');
    expect(fs.existsSync(universePath)).toBe(true);
    // counterfactual-shadow-learning-ledger.json (ADR-0430) 미생성
    const candidatePath = path.join(TEST_DIR, 'counterfactual-shadow-learning-ledger.json');
    expect(fs.existsSync(candidatePath)).toBe(false);
    expect(repo.loadCounterfactualUniverseLearningLedger()).toHaveLength(1);
  });

  // ────────────────────────────────────────────────────────
  // §J #9: shadow-trades.json 와 파일 분리
  // ────────────────────────────────────────────────────────
  it('§J#9: 일반 shadow-trades.json 과 영속 파일 분리', async () => {
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-sep2',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    expect(fs.existsSync(path.join(TEST_DIR, 'shadow-trades.json'))).toBe(false);
  });

  // ────────────────────────────────────────────────────────
  // §J #10: provisional-shadow-ledger.json 와 파일 분리
  // ────────────────────────────────────────────────────────
  it('§J#10: provisional-shadow-ledger.json 과 영속 파일 분리', async () => {
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-sep3',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    expect(fs.existsSync(path.join(TEST_DIR, 'provisional-shadow-ledger.json'))).toBe(false);
  });

  // ────────────────────────────────────────────────────────
  // §J #11: virtual account / cash / holdings 무관 — 영속 schema 에 미포함
  // ────────────────────────────────────────────────────────
  it('§J#11: snapshot schema 에 virtual account 필드 부재', async () => {
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-vacc',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    const e = repo.loadCounterfactualUniverseLearningLedger()[0];
    const flat = JSON.stringify(e);
    expect(flat).not.toMatch(/holdings|cashBalance|equity|orderableCash/i);
    expect(e.virtualAccountImpact).toBe('NONE');
  });

  // ────────────────────────────────────────────────────────
  // §J #12: blockedByBreakdown / preflightStageBreakdown 계산 검증
  // ────────────────────────────────────────────────────────
  it('§J#12: summarize blockedByBreakdown + preflightStageBreakdown 정확', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-A1',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-A2',
      preflightStage: 'AFTER_UNIVERSE_BUILD',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
    });
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-B1',
      preflightStage: 'BEFORE_BUYLIST_LOOP',
      blockedBy: ['HARD_BLOCK'],
      reasons: ['HARD_BLOCK_PREFLIGHT'],
    });
    const summary = repo.summarizeCounterfactualUniverseLearningLedger('2026-05-07');
    expect(summary.totalSnapshots).toBe(3);
    expect(summary.blockedByBreakdown['SELL_ONLY']).toBe(2);
    expect(summary.blockedByBreakdown['HARD_BLOCK']).toBe(1);
    expect(summary.preflightStageBreakdown['AFTER_UNIVERSE_BUILD']).toBe(2);
    expect(summary.preflightStageBreakdown['BEFORE_BUYLIST_LOOP']).toBe(1);
    expect(summary.reasonBreakdown['SELL_ONLY_PREFLIGHT']).toBe(2);
    expect(summary.reasonBreakdown['HARD_BLOCK_PREFLIGHT']).toBe(1);
  });

  // ────────────────────────────────────────────────────────
  // §J #13: try/catch 격리 — write 실패가 호출자 흐름 차단 안 함
  // ────────────────────────────────────────────────────────
  it('§J#13: write 실패 시 호출자 abort 흐름 보호', async () => {
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    // PERSIST_DATA_DIR 을 read-only path 로 강제
    const roDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cul-readonly-'));
    fs.chmodSync(roDir, 0o400);
    process.env.PERSIST_DATA_DIR = roDir;
    let didThrow = false;
    try {
      recordCounterfactualUniverseLearningSnapshot({
        scanId: 'scan-rofail',
        preflightStage: 'AFTER_UNIVERSE_BUILD',
        blockedBy: ['SELL_ONLY'],
        reasons: ['SELL_ONLY_PREFLIGHT'],
      });
    } catch {
      didThrow = true;
    }
    fs.chmodSync(roDir, 0o700);
    fs.rmSync(roDir, { recursive: true, force: true });
    process.env.PERSIST_DATA_DIR = TEST_DIR;
    expect(didThrow).toBe(false);
  });

  // ────────────────────────────────────────────────────────
  // §J #14: deriveUniverseLearningReason 매핑 정확
  // ────────────────────────────────────────────────────────
  it('§J#14: reason 매핑 SSOT — 모든 사용자 명시 분기', async () => {
    const { deriveUniverseLearningReason } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    expect(deriveUniverseLearningReason('SELL_ONLY')).toBe('SELL_ONLY_PREFLIGHT');
    expect(deriveUniverseLearningReason('MANUAL_BLOCK')).toBe('SELL_ONLY_PREFLIGHT');
    expect(deriveUniverseLearningReason('HARD_BLOCK')).toBe('HARD_BLOCK_PREFLIGHT');
    expect(deriveUniverseLearningReason('R3_SANITY_BLOCK')).toBe('HARD_BLOCK_PREFLIGHT');
    expect(deriveUniverseLearningReason('R6_DEFENSE')).toBe('R6_DEFENSE_PREFLIGHT');
    expect(deriveUniverseLearningReason('RISK_OFF_REGIME')).toBe('R6_DEFENSE_PREFLIGHT');
    expect(deriveUniverseLearningReason('EMERGENCY_STOP')).toBe('EMERGENCY_STOP_PREFLIGHT');
    expect(deriveUniverseLearningReason('VIX_BLOCK')).toBe('VIX_BLOCK_PREFLIGHT');
    expect(deriveUniverseLearningReason('VIX_SPIKE')).toBe('VIX_BLOCK_PREFLIGHT');
    expect(deriveUniverseLearningReason('FOMC_BLOCK')).toBe('FOMC_BLOCK_PREFLIGHT');
    expect(deriveUniverseLearningReason('CANDIDATE_SCAN_SKIPPED')).toBe('CANDIDATE_EVALUATION_SKIPPED');
    expect(deriveUniverseLearningReason('SCAN_ABORTED')).toBe('SCAN_ABORTED_BEFORE_GATE');
    expect(deriveUniverseLearningReason('UNKNOWN_FOO')).toBe('LEARNING_ONLY');
  });

  // ────────────────────────────────────────────────────────
  // §J #15: dedup key SSOT — scanId 부재 fallback
  // ────────────────────────────────────────────────────────
  it('§J#15: dedup key SSOT — scanId 부재 시 fallback minute key 사용', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const k1 = repo.buildCounterfactualUniverseLearningDedupKey(
      'scan-X',
      'AFTER_UNIVERSE_BUILD',
      '202605070900',
    );
    expect(k1).toBe('scan-X:ADR-0433:AFTER_UNIVERSE_BUILD');
    const k2 = repo.buildCounterfactualUniverseLearningDedupKey(
      undefined,
      'BEFORE_BUYLIST_LOOP',
      '202605070900',
    );
    expect(k2).toBe('202605070900:ADR-0433:BEFORE_BUYLIST_LOOP');
    const k3 = repo.buildCounterfactualUniverseLearningDedupKey('', 'AFTER_UNIVERSE_BUILD', '202605070905');
    expect(k3).toBe('202605070905:ADR-0433:AFTER_UNIVERSE_BUILD');
  });

  // ────────────────────────────────────────────────────────
  // §J #16: 정적 grep 가드 (사용자 §"절대 하지 말 것" 정합)
  // ────────────────────────────────────────────────────────
  describe('§J#16: 정적 grep 가드 (절대 invariant)', () => {
    it('repo: KIS 주문 함수 import 0건', () => {
      expect(REPO_SOURCE).not.toMatch(
        /placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/,
      );
    });
    it('repo: orderExecutor / trancheExecutor / autoTradeEngine import 0건', () => {
      expect(REPO_SOURCE).not.toMatch(/orderExecutor|trancheExecutor|autoTradeEngine/);
    });
    it('repo: shadowTradeRepo import 0건', () => {
      expect(REPO_SOURCE).not.toMatch(/shadowTradeRepo/);
    });
    it('repo: provisionalShadowLedger import 0건 (분리 정책)', () => {
      expect(REPO_SOURCE).not.toMatch(/provisionalShadowLedger/);
    });
    it('repo: virtual account mutation 패턴 0건', () => {
      expect(REPO_SOURCE).not.toMatch(
        /setVirtualAccountHoldings|updateVirtualAccountCash|mutateHoldings|setEquity/,
      );
    });
    it('repo: 외부 fetch / axios 호출 0건', () => {
      expect(REPO_SOURCE).not.toMatch(/\bfetch\(|axios\.|node-fetch/);
    });
    it('wiring: KIS 주문 함수 import 0건', () => {
      expect(WIRING_SOURCE).not.toMatch(
        /placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/,
      );
    });
    it('wiring: orderExecutor / trancheExecutor / autoTradeEngine import 0건', () => {
      expect(WIRING_SOURCE).not.toMatch(/orderExecutor|trancheExecutor|autoTradeEngine/);
    });
    it('wiring: shadowTradeRepo import 0건', () => {
      expect(WIRING_SOURCE).not.toMatch(/shadowTradeRepo/);
    });
    it('wiring: gate threshold / STRONG_BUY 변경 패턴 0건', () => {
      expect(WIRING_SOURCE).not.toMatch(
        /setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX|STRONG_BUY_OVERRIDE/,
      );
    });
    it('wiring: 외부 fetch / axios 호출 0건', () => {
      expect(WIRING_SOURCE).not.toMatch(/\bfetch\(|axios\.|node-fetch/);
    });
    it('wiring: virtual account mutation 패턴 0건', () => {
      expect(WIRING_SOURCE).not.toMatch(
        /setVirtualAccountHoldings|updateVirtualAccountCash|mutateHoldings|setEquity/,
      );
    });
    it('repo: ADR-0433 추적 주석 명시', () => {
      expect(REPO_SOURCE_RAW).toMatch(/ADR-0433/);
      expect(REPO_SOURCE_RAW).toMatch(/COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT/);
    });
  });

  // ────────────────────────────────────────────────────────
  // 추가: 손상 JSON fallback
  // ────────────────────────────────────────────────────────
  it('손상 JSON 시 빈 ledger fallback', async () => {
    const universePath = path.join(TEST_DIR, 'counterfactual-universe-learning-ledger.json');
    fs.writeFileSync(universePath, '{ this is not valid json', 'utf-8');
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger).toEqual([]);
    const summary = repo.summarizeCounterfactualUniverseLearningLedger();
    expect(summary.totalSnapshots).toBe(0);
  });

  // ────────────────────────────────────────────────────────
  // 추가: snapshot schema 직접 round-trip
  // ────────────────────────────────────────────────────────
  it('schema round-trip — 직접 append + load', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const r = repo.appendCounterfactualUniverseLearningSnapshot(baseSnapshot);
    expect(r.recorded).toBe(true);
    const ledger = repo.loadCounterfactualUniverseLearningLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].id).toBe(baseSnapshot.id);
    expect(ledger[0].source).toBe('ADR-0433');
  });

  // ────────────────────────────────────────────────────────
  // 추가: hasExistingUniverseSnapshot
  // ────────────────────────────────────────────────────────
  it('hasExistingUniverseSnapshot — scanId 부재 시 false', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    expect(repo.hasExistingUniverseSnapshot(undefined, 'AFTER_UNIVERSE_BUILD')).toBe(false);
    expect(repo.hasExistingUniverseSnapshot('', 'AFTER_UNIVERSE_BUILD')).toBe(false);
    repo.appendCounterfactualUniverseLearningSnapshot(baseSnapshot);
    expect(repo.hasExistingUniverseSnapshot('scan-A', 'AFTER_UNIVERSE_BUILD')).toBe(true);
    expect(repo.hasExistingUniverseSnapshot('scan-A', 'BEFORE_BUYLIST_LOOP')).toBe(false);
    expect(repo.hasExistingUniverseSnapshot('scan-OTHER', 'AFTER_UNIVERSE_BUILD')).toBe(false);
  });

  // ────────────────────────────────────────────────────────
  // 추가: formatter 섹션 — empty + populated
  // ────────────────────────────────────────────────────────
  it('formatter: empty ledger 시 null', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const summary = repo.summarizeCounterfactualUniverseLearningLedger();
    expect(repo.formatCounterfactualUniverseLearningSummarySection(summary)).toBeNull();
  });

  it('formatter: populated ledger 시 ADR-0433 헤더 + key fields', async () => {
    const repo = await import('./counterfactualUniverseLearningRepo.js');
    const { recordCounterfactualUniverseLearningSnapshot } = await import(
      '../trading/signalScanner/counterfactualUniverseLearningWiring.js'
    );
    recordCounterfactualUniverseLearningSnapshot({
      scanId: 'scan-fmt',
      preflightStage: 'AFTER_CANDIDATE_SCAN',
      blockedBy: ['SELL_ONLY'],
      reasons: ['SELL_ONLY_PREFLIGHT'],
      candidates: [{ symbol: '005930', name: '삼성전자' }],
    });
    const summary = repo.summarizeCounterfactualUniverseLearningLedger();
    const section = repo.formatCounterfactualUniverseLearningSummarySection(summary);
    expect(section).toContain('Counterfactual Universe Learning (ADR-0433)');
    expect(section).toContain('learningOnly: ✅');
    expect(section).toContain('AFTER_CANDIDATE_SCAN');
    expect(section).toContain('SELL_ONLY');
    expect(section).toContain('executionImpact: NONE');
  });
});
