// @responsibility ADR-0427 Provisional Shadow Ledger 영속 회귀 테스트.
//
// 사용자 §J 12 케이스 + 정적 grep 가드 (KIS 주문 import 0건 / virtual account 무영향).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LEDGER_PATH = join(__dirname, 'provisionalShadowLedger.ts');
const LEDGER_SOURCE = fs.readFileSync(LEDGER_PATH, 'utf-8');

let TEST_DIR: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'provisional-ledger-test-'));
  originalDataDir = process.env.PERSIST_DATA_DIR;
  process.env.PERSIST_DATA_DIR = TEST_DIR;
  delete process.env.PROVISIONAL_SHADOW_LEDGER_DISABLED;
  // ESM dynamic import — paths.ts 가 PERSIST_DATA_DIR 기반 경로 조립
  const { __resetProvisionalShadowLedgerForTests } = await import('./provisionalShadowLedger.js');
  __resetProvisionalShadowLedgerForTests();
});

afterEach(() => {
  if (originalDataDir !== undefined) process.env.PERSIST_DATA_DIR = originalDataDir;
  else delete process.env.PERSIST_DATA_DIR;
  delete process.env.PROVISIONAL_SHADOW_LEDGER_DISABLED;
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

const baseCandidate = {
  symbol: '005930',
  name: '삼성전자',
  label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED' as const,
  reasons: [
    'R3_EARLY' as const,
    'GATE1_SURVIVOR' as const,
    'NO_HARD_RISK' as const,
    'SECTOR_DATA_DEGRADED' as const,
    'GATE2_NOT_CONFIRMED' as const,
  ],
  liveAllowed: false as const,
  shadowAllowed: true as const,
  source: 'ADR-0426' as const,
  regime: 'R3_EARLY' as const,
  gate1Passed: true,
  gate2Passed: false,
};

describe('ADR-0427 Provisional Shadow Ledger 영속', () => {
  // ────────────────────────────────────────────────────────
  // §J #1: 정상 영속 — eventType / source / provisional / liveAllowed=false 보존
  // ────────────────────────────────────────────────────────
  it('§J#1: 정상 영속 — schema 모든 필수 필드 저장', async () => {
    const { recordR3ProvisionalShadowCandidate, loadProvisionalShadowLedger } = await import('./provisionalShadowLedger.js');
    const result = recordR3ProvisionalShadowCandidate({
      candidate: baseCandidate,
      scanId: '2026-05-07:scan-1',
      scannedAtKst: '2026-05-07T15:30:00+09:00',
    });
    expect(result.recorded).toBe(true);
    const entries = loadProvisionalShadowLedger();
    expect(entries).toHaveLength(1);
    expect(entries[0].eventType).toBe('PROVISIONAL_SHADOW_ENTRY');
    expect(entries[0].source).toBe('ADR-0426');
    expect(entries[0].provisional).toBe(true);
    expect(entries[0].liveAllowed).toBe(false);
    expect(entries[0].shadowAllowed).toBe(true);
    expect(entries[0].symbol).toBe('005930');
    expect(entries[0].label).toBe('R3_PROVISIONAL_LEADER_DATA_DEGRADED');
  });

  // ────────────────────────────────────────────────────────
  // §J #2: 동일 scanId+symbol 중복 차단
  // ────────────────────────────────────────────────────────
  it('§J#2: 동일 scanId+symbol 중복 차단 (DUPLICATE)', async () => {
    const { recordR3ProvisionalShadowCandidate, loadProvisionalShadowLedger } = await import('./provisionalShadowLedger.js');
    const r1 = recordR3ProvisionalShadowCandidate({
      candidate: baseCandidate,
      scanId: 'same-scan',
    });
    expect(r1.recorded).toBe(true);
    const r2 = recordR3ProvisionalShadowCandidate({
      candidate: baseCandidate,
      scanId: 'same-scan',
    });
    expect(r2.recorded).toBe(false);
    if (!r2.recorded) {
      expect(r2.reason).toBe('DUPLICATE');
    }
    expect(loadProvisionalShadowLedger()).toHaveLength(1);
  });

  // ────────────────────────────────────────────────────────
  // §J #3: 다른 scanId — 같은 symbol 도 영속 가능
  // ────────────────────────────────────────────────────────
  it('§J#3: 다른 scanId 면 같은 symbol 영속 가능', async () => {
    const { recordR3ProvisionalShadowCandidate, loadProvisionalShadowLedger } = await import('./provisionalShadowLedger.js');
    const r1 = recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: 'scan-A' });
    const r2 = recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: 'scan-B' });
    expect(r1.recorded).toBe(true);
    expect(r2.recorded).toBe(true);
    expect(loadProvisionalShadowLedger()).toHaveLength(2);
  });

  // ────────────────────────────────────────────────────────
  // §J #4: ENV `PROVISIONAL_SHADOW_LEDGER_DISABLED=true` 시 차단
  // ────────────────────────────────────────────────────────
  it('§J#4: ENV DISABLED → recorded=false + reason=ENV_DISABLED', async () => {
    process.env.PROVISIONAL_SHADOW_LEDGER_DISABLED = 'true';
    const { recordR3ProvisionalShadowCandidate, loadProvisionalShadowLedger } = await import('./provisionalShadowLedger.js');
    const result = recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: 'scan-X' });
    expect(result.recorded).toBe(false);
    if (!result.recorded) expect(result.reason).toBe('ENV_DISABLED');
    expect(loadProvisionalShadowLedger()).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────
  // §J #5: ENV 정확 비교 (ADR-0157)
  // ────────────────────────────────────────────────────────
  it('§J#5: ENV "1"/"TRUE"/"yes" 거부 (정확 비교만 활성화)', async () => {
    for (const v of ['1', 'TRUE', 'yes', 'True']) {
      process.env.PROVISIONAL_SHADOW_LEDGER_DISABLED = v;
      const { recordR3ProvisionalShadowCandidate, __resetProvisionalShadowLedgerForTests } =
        await import('./provisionalShadowLedger.js');
      __resetProvisionalShadowLedgerForTests();
      const result = recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: `s-${v}` });
      expect(result.recorded).toBe(true); // ENV 정확 비교 — 'true' 만 disable
    }
  });

  // ────────────────────────────────────────────────────────
  // §J #6: dedup key 형식 검증
  // ────────────────────────────────────────────────────────
  it('§J#6: buildDedupKey scanId 있을 때 / 없을 때', async () => {
    const { buildDedupKey } = await import('./provisionalShadowLedger.js');
    expect(buildDedupKey('scan-1', '005930')).toBe('scan-1:005930:ADR-0426');
    expect(buildDedupKey(undefined, '005930', '2026-05-07T15:30:00+09:00')).toContain('005930:ADR-0426');
    expect(buildDedupKey(undefined, '005930', '2026-05-07T15:30:00+09:00')).toMatch(/^\d{12}:005930:ADR-0426$/);
  });

  // ────────────────────────────────────────────────────────
  // §J #7: hasExistingEntry 동작
  // ────────────────────────────────────────────────────────
  it('§J#7: hasExistingEntry 영속 후 true / 다른 scanId 는 false', async () => {
    const { recordR3ProvisionalShadowCandidate, hasExistingEntry } = await import('./provisionalShadowLedger.js');
    expect(hasExistingEntry('scan-1', '005930')).toBe(false);
    recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: 'scan-1' });
    expect(hasExistingEntry('scan-1', '005930')).toBe(true);
    expect(hasExistingEntry('scan-2', '005930')).toBe(false);
    expect(hasExistingEntry('scan-1', '999999')).toBe(false);
  });

  // ────────────────────────────────────────────────────────
  // §J #8: metadata 영속 (sectorEnergy / unavailable / router reasons)
  // ────────────────────────────────────────────────────────
  it('§J#8: metadata 모든 필드 영속', async () => {
    const { recordR3ProvisionalShadowCandidate, loadProvisionalShadowLedger } = await import('./provisionalShadowLedger.js');
    const result = recordR3ProvisionalShadowCandidate({
      candidate: baseCandidate,
      scanId: 'scan-meta',
      metadata: {
        sectorEnergyDataQuality: 'DEGRADED',
        sectorEnergyConfidence: 0,
        sectorEnergyIndexCodeCoverage: 0.187,
        sectorEnergyRepairStatus: 'PARTIAL',
        unavailableConditions: ['supply_confluence', 'earnings_quality', 'per'],
        failedTechnicalConditions: ['trend_acceleration'],
        routerReasons: ['SECTOR_DATA_STALE', 'DATA_UNAVAILABLE'],
      },
    });
    expect(result.recorded).toBe(true);
    const entries = loadProvisionalShadowLedger();
    expect(entries[0].metadata?.sectorEnergyDataQuality).toBe('DEGRADED');
    expect(entries[0].metadata?.sectorEnergyConfidence).toBe(0);
    expect(entries[0].metadata?.unavailableConditions).toEqual(['supply_confluence', 'earnings_quality', 'per']);
    expect(entries[0].metadata?.routerReasons).toEqual(['SECTOR_DATA_STALE', 'DATA_UNAVAILABLE']);
  });

  // ────────────────────────────────────────────────────────
  // §J #9: FIFO trim — 한계 초과 시 가장 오래된 entry 제거
  // ────────────────────────────────────────────────────────
  it('§J#9: FIFO 2000건 trim 검증', async () => {
    const { recordR3ProvisionalShadowCandidate, loadProvisionalShadowLedger, PROVISIONAL_SHADOW_LEDGER_MAX } =
      await import('./provisionalShadowLedger.js');
    expect(PROVISIONAL_SHADOW_LEDGER_MAX).toBe(2000);
    // FIFO 동작은 spot-check (실제 2000건 영속은 시간 소요 큼) — 직접 paths.ts 영속 파일 조작
    // 으로 시뮬레이션
    const { PROVISIONAL_SHADOW_LEDGER_FILE } = await import('./paths.js');
    const initial = { version: 1, entries: Array.from({ length: 2000 }, (_, i) => ({
      eventType: 'PROVISIONAL_SHADOW_ENTRY',
      provisional: true,
      source: 'ADR-0426',
      symbol: `S${i.toString().padStart(6, '0')}`,
      scanId: `seed-${i}`,
      createdAtKst: new Date().toISOString(),
      label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
      reasons: ['R3_EARLY', 'GATE1_SURVIVOR'],
      regime: 'R3_EARLY',
      gate1Passed: true,
      gate2Passed: false,
      liveAllowed: false,
      shadowAllowed: true,
    })) };
    fs.writeFileSync(PROVISIONAL_SHADOW_LEDGER_FILE, JSON.stringify(initial), 'utf-8');
    const result = recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: 'overflow-1' });
    expect(result.recorded).toBe(true);
    const entries = loadProvisionalShadowLedger();
    expect(entries).toHaveLength(2000);
    // 가장 오래된 (S000000) 제거됨
    expect(entries.find((e) => e.symbol === 'S000000')).toBeUndefined();
    // 신규 entry 영속
    expect(entries.find((e) => e.symbol === '005930' && e.scanId === 'overflow-1')).toBeDefined();
  });

  // ────────────────────────────────────────────────────────
  // §J #10: 손상 JSON fallback
  // ────────────────────────────────────────────────────────
  it('§J#10: 손상 JSON 빈 ledger fallback', async () => {
    const { PROVISIONAL_SHADOW_LEDGER_FILE } = await import('./paths.js');
    fs.writeFileSync(PROVISIONAL_SHADOW_LEDGER_FILE, '{ broken json !!!', 'utf-8');
    const { loadProvisionalShadowLedger, recordR3ProvisionalShadowCandidate } = await import('./provisionalShadowLedger.js');
    expect(loadProvisionalShadowLedger()).toEqual([]);
    // 신규 영속 정상 동작
    const result = recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: 'after-corrupt' });
    expect(result.recorded).toBe(true);
  });

  // ────────────────────────────────────────────────────────
  // §J #11: 일반 shadow buy 와 분리 영속 (PROVISIONAL_SHADOW_LEDGER_FILE ≠ SHADOW_FILE)
  // ────────────────────────────────────────────────────────
  it('§J#11: SHADOW_FILE (shadow-trades.json) 무수정 — 별도 ledger', async () => {
    const { PROVISIONAL_SHADOW_LEDGER_FILE } = await import('./paths.js');
    const { SHADOW_FILE } = await import('./paths.js');
    expect(PROVISIONAL_SHADOW_LEDGER_FILE).not.toBe(SHADOW_FILE);
    expect(PROVISIONAL_SHADOW_LEDGER_FILE).toContain('provisional-shadow-ledger.json');
    expect(SHADOW_FILE).toContain('shadow-trades.json');
    const { recordR3ProvisionalShadowCandidate } = await import('./provisionalShadowLedger.js');
    recordR3ProvisionalShadowCandidate({ candidate: baseCandidate, scanId: 'separation' });
    expect(fs.existsSync(PROVISIONAL_SHADOW_LEDGER_FILE)).toBe(true);
    expect(fs.existsSync(SHADOW_FILE)).toBe(false); // shadow-trades.json 영속 0건
  });

  // ────────────────────────────────────────────────────────
  // §J #12: 정적 grep 가드 — KIS 주문 함수 import 0건
  // ────────────────────────────────────────────────────────
  describe('§J#12: 정적 grep 가드 — LIVE 매매 영향 0', () => {
    it('KIS 주문 함수 5종 import 0건', () => {
      expect(LEDGER_SOURCE).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
    });

    it('autoTradeEngine import 0건', () => {
      expect(LEDGER_SOURCE).not.toMatch(/autoTradeEngine/);
    });

    it('orderExecutor / trancheExecutor import 0건', () => {
      expect(LEDGER_SOURCE).not.toMatch(/orderExecutor|trancheExecutor/);
    });

    it('shadowTradeRepo (일반 shadow buy) import 0건 — 분리 영속', () => {
      expect(LEDGER_SOURCE).not.toMatch(/shadowTradeRepo|appendShadow|saveShadowTrades/);
    });

    it('Gate threshold / STRONG_BUY 변경 키워드 부재', () => {
      expect(LEDGER_SOURCE).not.toMatch(/setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX|STRONG_BUY_OVERRIDE/);
    });

    it('외부 fetch / axios / API 호출 0건', () => {
      expect(LEDGER_SOURCE).not.toMatch(/\bfetch\(|axios\.|node-fetch/);
    });

    it('ENV 정확 비교 (ADR-0157)', () => {
      expect(LEDGER_SOURCE).toContain("=== 'true'");
    });

    it('liveAllowed: false literal 영속 — TypeScript 강제', () => {
      expect(LEDGER_SOURCE).toContain('liveAllowed: false');
      expect(LEDGER_SOURCE).toContain("eventType: 'PROVISIONAL_SHADOW_ENTRY'");
      expect(LEDGER_SOURCE).toContain("source: 'ADR-0426'");
      expect(LEDGER_SOURCE).toContain('provisional: true');
    });
  });

  // ────────────────────────────────────────────────────────
  // formatter skipped 표시 회귀
  // ────────────────────────────────────────────────────────
  it('formatter skipped > 0 + skipReasons 표시', async () => {
    const { formatProvisionalShadowSection } = await import('../trading/signalScanner/provisionalShadowLane.js');
    const section = formatProvisionalShadowSection({
      eligible: 5,
      created: 3,
      skipped: 2,
      skipReasons: { DUPLICATE: 1, ENV_DISABLED: 1 },
      dominantLabel: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
      topReasons: ['SECTOR_DATA_DEGRADED'],
    });
    expect(section).toContain('eligible:');
    expect(section).toContain('5');
    expect(section).toContain('created:');
    expect(section).toContain('3');
    expect(section).toContain('skipped:');
    expect(section).toContain('2');
    expect(section).toContain('skipReasons');
    expect(section).toContain('DUPLICATE');
    expect(section).toContain('ENV_DISABLED');
  });

  // ────────────────────────────────────────────────────────
  // formatter HARD_BLOCK noEligibleReason
  // ────────────────────────────────────────────────────────
  it('formatter eligible=0 + noEligibleReason → blockedBy 라벨', async () => {
    const { formatProvisionalShadowSection } = await import('../trading/signalScanner/provisionalShadowLane.js');
    const section = formatProvisionalShadowSection({
      eligible: 0,
      created: 0,
      noEligibleReason: 'HARD_BLOCK / SELL_ONLY',
    });
    expect(section).toContain('blockedBy:');
    expect(section).toContain('HARD_BLOCK');
    expect(section).toContain('SELL_ONLY');
    expect(section).toContain('Shadow 학습도 제한');
  });
});
