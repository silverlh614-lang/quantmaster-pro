/**
 * @responsibility ADR-0173 §2 ShadowLearningOnlyScan 회귀 — invariant + ENV + 8 reason + blocked-day wiring guard
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SupplyHealthSnapshot } from '../learning/supplyHealthLearning.js';

// PERSIST_DATA_DIR 격리
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-test-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const ENV_KEY = 'SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED';

let mod: typeof import('./shadowLearningOnlyScan.js');
let repo: typeof import('../persistence/shadowLearningOnlySignalRepo.js');

function supplyHealthSnapshot(overrides: Partial<SupplyHealthSnapshot['summary']> = {}): SupplyHealthSnapshot {
  return {
    summary: {
      ok: 4,
      neutral: 0,
      degraded: 3,
      missing: 0,
      stale: 0,
      cacheStatus: 'fresh',
      overallStatus: 'DEGRADED',
      ...overrides,
    },
    coverage: {
      totalSources: 7,
      okRatio: 4 / 7,
      degradedRatio: 3 / 7,
      missingRatio: 0,
      minCriticalCoverage: 0.5,
    },
    sources: {},
    providerTried: ['KIS_API', 'KRX'],
    providerFailed: ['KRX'],
    providerUsed: ['CACHE'],
    criticalFlags: {
      investorFlowDegraded: true,
      programTradingMissing: true,
      foreignerTrendDegraded: false,
      zeroFilledSuspected: false,
      offHoursMode: false,
    },
  };
}

beforeEach(async () => {
  delete process.env[ENV_KEY];
  vi.resetModules();
  mod = await import('./shadowLearningOnlyScan.js');
  repo = await import('../persistence/shadowLearningOnlySignalRepo.js');
  repo.__resetShadowLearningOnlySignalsForTests();
});

afterEach(() => {
  delete process.env[ENV_KEY];
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
});

// ─── ENV 분기 ────────────────────────────────────────────────────────────────

describe('ENV 분기 (default ON, PR-P0-Activation 2026-05-06)', () => {
  it('ENV 미설정 → 활성 (default ON)', async () => {
    delete process.env[ENV_KEY];
    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
    });
    expect(result.skipped).toBe(false);
  });

  it("ENV='true' → 활성", async () => {
    process.env[ENV_KEY] = 'true';
    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
    });
    expect(result.skipped).toBe(false);
  });

  it("ENV='false' 정확 비교 → skipped: ENV_DISABLED (운영자 명시 비활성)", async () => {
    process.env[ENV_KEY] = 'false';
    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
    });
    expect(result).toEqual({ skipped: true, reason: 'ENV_DISABLED' });
  });

  it("ENV 임의 truthy ('1' / 'TRUE' / 'yes' / '') → 모두 활성 (default ON, ADR-0157 정확 비교)", async () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env[ENV_KEY] = v;
      const result = await mod.runShadowLearningOnlyScan({
        allowRealOrder: false,
        bypassMacroEntryBlock: true,
        reason: 'FOMC_BLOCK',
        scanDate: '2026-05-04',
      });
      expect(result.skipped).toBe(false);
    }
  });
});

// ─── 안전 invariant — allowRealOrder ─────────────────────────────────────────

describe('안전 invariant — allowRealOrder', () => {
  it('allowRealOrder=true throw (literal type 우회 차단)', async () => {
    process.env[ENV_KEY] = 'true';
    await expect(
      mod.runShadowLearningOnlyScan({
        // literal type 우회 — runtime throw 강제 검증
        allowRealOrder: true as unknown as false,
        bypassMacroEntryBlock: true,
        reason: 'FOMC_BLOCK',
        scanDate: '2026-05-04',
      }),
    ).rejects.toThrow(/allowRealOrder=false invariant violated/);
  });

  it('allowRealOrder=undefined throw (호출자 의도 명시 강제)', async () => {
    process.env[ENV_KEY] = 'true';
    await expect(
      mod.runShadowLearningOnlyScan({
        // undefined — runtime throw
        allowRealOrder: undefined as unknown as false,
        bypassMacroEntryBlock: true,
        reason: 'FOMC_BLOCK',
        scanDate: '2026-05-04',
      }),
    ).rejects.toThrow(/allowRealOrder=false invariant violated/);
  });

  it('allowRealOrder=false + ENV ON → 정상 진행', async () => {
    process.env[ENV_KEY] = 'true';
    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
    });
    expect(result.skipped).toBe(false);
  });

  it('allowRealOrder invariant 가 ENV OFF 보다 먼저 검증 (literal type 우회 시도가 ENV gate 보다 우선 차단)', async () => {
    delete process.env[ENV_KEY];
    await expect(
      mod.runShadowLearningOnlyScan({
        allowRealOrder: true as unknown as false,
        bypassMacroEntryBlock: true,
        reason: 'FOMC_BLOCK',
        scanDate: '2026-05-04',
      }),
    ).rejects.toThrow(/allowRealOrder=false invariant violated/);
  });
});

// ─── bypassMacroEntryBlock 검증 ──────────────────────────────────────────────

describe('bypassMacroEntryBlock 검증', () => {
  it('boolean 미전달 → throw (호출자 의도 명시 강제)', async () => {
    process.env[ENV_KEY] = 'true';
    await expect(
      mod.runShadowLearningOnlyScan({
        allowRealOrder: false,
        bypassMacroEntryBlock: undefined as unknown as boolean,
        reason: 'FOMC_BLOCK',
        scanDate: '2026-05-04',
      }),
    ).rejects.toThrow(/bypassMacroEntryBlock 은 boolean 의무/);
  });

  it('bypassMacroEntryBlock=false → 정상 진행', async () => {
    process.env[ENV_KEY] = 'true';
    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: false,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
    });
    expect(result.skipped).toBe(false);
  });
});

// ─── 9 reason union 분기 ─────────────────────────────────────────────────────

describe('9 ShadowLearningOnlyScanReason union', () => {
  const reasons = [
    'FOMC_BLOCK',
    'VIX_SPIKE',
    'RISK_OFF_REGIME',
    'R0_CRISIS',
    'R1_DEFENSIVE',
    'KRX_HOLIDAY_REPLAY',
    'LIQUIDITY_BLOCK',
    'MANUAL_BLOCK',
    'R3_SANITY_BLOCK',
  ] as const;
  for (const reason of reasons) {
    it(`reason='${reason}' → 정상 진행 + result.reason 정합`, async () => {
      process.env[ENV_KEY] = 'true';
      const result = await mod.runShadowLearningOnlyScan({
        allowRealOrder: false,
        bypassMacroEntryBlock: true,
        reason,
        scanDate: '2026-05-04',
      });
      expect(result.skipped).toBe(false);
      if (!result.skipped) {
        expect(result.reason).toBe(reason);
      }
    });
  }
});

// ─── ENV ON + 정상 입력 — candidate persistence 검증 ─────────────────────

describe('blocked-day shadow scan persistence', () => {
  it('ENV ON + 정상 입력 → candidates=0, wouldBuyCount=0, signalsRecorded=0', async () => {
    process.env[ENV_KEY] = 'true';
    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
    });
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.candidates).toBe(0);
      expect(result.wouldBuyCount).toBe(0);
      expect(result.signalsRecorded).toBe(0);
    }
  });

  it('ENV ON + watchlist 후보 존재 → ShadowLearningOnlySignal 영속', async () => {
    process.env[ENV_KEY] = 'true';
    fs.writeFileSync(
      path.join(tmpDir, 'watchlist.json'),
      JSON.stringify([
        {
          code: '005930',
          name: 'SAMSUNG',
          entryPrice: 75000,
          stopLoss: 71000,
          targetPrice: 84000,
          addedAt: '2026-05-04T00:00:00.000Z',
          addedBy: 'AUTO',
          section: 'SWING',
          gateScore: 9.5,
          entryRegime: 'R3_EARLY',
        },
      ]),
      'utf-8',
    );

    const result = await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
    });

    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.candidates).toBe(1);
      expect(result.wouldBuyCount).toBe(1);
      expect(result.signalsRecorded).toBe(1);
    }
    const signals = repo.loadShadowLearningOnlySignals();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.symbol).toBe('005930');
    expect(signals[0]!.hypotheticalEntryPrice).toBe(75000);
    expect(signals[0]!.outcome).toBe('PENDING');
  });

  it('supply_health snapshot이 있으면 Shadow 신호에 raw/final/confidence를 함께 저장한다', async () => {
    process.env[ENV_KEY] = 'true';
    fs.writeFileSync(
      path.join(tmpDir, 'watchlist.json'),
      JSON.stringify([
        {
          code: '005930',
          name: 'SAMSUNG',
          entryPrice: 75000,
          stopLoss: 71000,
          targetPrice: 84000,
          addedAt: '2026-05-04T00:00:00.000Z',
          addedBy: 'AUTO',
          section: 'SWING',
          gateScore: 9.5,
          entryRegime: 'R3_EARLY',
        },
      ]),
      'utf-8',
    );

    await mod.runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK',
      scanDate: '2026-05-04',
      supplyHealthSnapshot: supplyHealthSnapshot(),
    });

    const signals = repo.loadShadowLearningOnlySignals();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.rawSignal).toBe('STRONG_BUY');
    expect(signals[0]!.finalSignal).toBe('BUY');
    expect(signals[0]!.wasDowngradedBySupplyHealth).toBe(true);
    expect(signals[0]!.dataQualityBucket).toBe('LOW_CONFIDENCE');
    expect(signals[0]!.supplyHealthSnapshot?.summary.overallStatus).toBe('DEGRADED');
    expect(signals[0]!.downgradeReasons?.length).toBeGreaterThan(0);
  });

  it('동일 날짜/사유/symbol 재실행 → 중복 append 차단', async () => {
    process.env[ENV_KEY] = 'true';
    fs.writeFileSync(
      path.join(tmpDir, 'watchlist.json'),
      JSON.stringify([
        {
          code: '005930',
          name: 'SAMSUNG',
          entryPrice: 75000,
          stopLoss: 71000,
          targetPrice: 84000,
          addedAt: '2026-05-04T00:00:00.000Z',
          addedBy: 'AUTO',
          section: 'SWING',
          gateScore: 9.5,
        },
      ]),
      'utf-8',
    );
    const input = {
      allowRealOrder: false as const,
      bypassMacroEntryBlock: true,
      reason: 'FOMC_BLOCK' as const,
      scanDate: '2026-05-04',
    };

    await mod.runShadowLearningOnlyScan(input);
    const result = await mod.runShadowLearningOnlyScan(input);

    expect(result.skipped).toBe(false);
    if (!result.skipped) expect(result.signalsRecorded).toBe(0);
    expect(repo.loadShadowLearningOnlySignals()).toHaveLength(1);
  });
});

// ─── 영속 round-trip (signal repo) ──────────────────────────────────────────

describe('shadowLearningOnlySignalRepo — round-trip', () => {
  it('appendShadowLearningOnlySignal + load → 동일', () => {
    const signal = {
      symbol: '005930',
      signalDate: '2026-05-04',
      blockedReason: 'FOMC_BLOCK' as const,
      wouldHaveBought: true,
      hypotheticalEntryPrice: 75000,
      hypotheticalStopLoss: 71000,
      hypotheticalTargetPrice: 82000,
      signalGrade: 'STRONG_BUY' as const,
      gateScore: 22,
      regime: 'R3_EARLY',
      macroBlockReason: 'FOMC DAY phase',
      dataQualityStatus: 'OK' as const,
    };
    repo.appendShadowLearningOnlySignal(signal);
    const all = repo.loadShadowLearningOnlySignals();
    expect(all).toHaveLength(1);
    expect(all[0]!.symbol).toBe('005930');
    expect(all[0]!.blockedReason).toBe('FOMC_BLOCK');
  });
});

// ─── 정적 grep 가드 — KIS 주문 import 0건 (절대 규칙 #2) ─────────────────────

/** 주석 제거 헬퍼 — block comment + line comment strip 후 코드 영역만 검사. */
function stripComments(src: string): string {
  // /* ... */ block comment 제거
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // // ... line comment 제거
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

describe('KIS 주문 함수 import 정적 grep 가드', () => {
  it('shadowLearningOnlyScan.ts 본체에 KIS 주문 함수 import 0건 (주석 제외)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, 'shadowLearningOnlyScan.ts'),
      'utf-8',
    );
    const code = stripComments(src);
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    // kisClient 자체 import 도 금지 (raw 함수 호출 위험)
    expect(code).not.toMatch(/from ['"][^'"]*kisClient/);
    expect(code).not.toMatch(/from ['"][^'"]*tranchesRouter/);
  });

  it('signalRepo 본체에 KIS 주문 함수 import 0건', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../persistence/shadowLearningOnlySignalRepo.ts'),
      'utf-8',
    );
    const code = stripComments(src);
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/from ['"][^'"]*kisClient/);
  });
});

// ─── runAutoSignalScan 직접 호출 grep 가드 (무한 루프 차단) ──────────────────

describe('runAutoSignalScan 호출 정적 grep 가드 (무한 루프 차단)', () => {
  it('shadowLearningOnlyScan.ts 본체에 runAutoSignalScan 호출 0건 (주석 제외)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, 'shadowLearningOnlyScan.ts'),
      'utf-8',
    );
    const code = stripComments(src);
    expect(code).not.toMatch(/runAutoSignalScan/);
  });
});

// ─── 호출자 정적 grep 가드 (signalScanner helper만 허용) ─────────────────────

describe('호출자 제한 (signalScanner helper만 허용)', () => {
  function readSrcSafely(absPath: string): string | null {
    try {
      return fs.readFileSync(absPath, 'utf-8');
    } catch {
      return null;
    }
  }

  function rejectsImports(src: string | null, importBase: string): boolean {
    if (src === null) return true; // 파일 부재 = 호출자 0건 자연 만족
    // 파일 안에 본 모듈 import 가 0건이어야 함.
    const re = new RegExp(`from ['"][^'"]*${importBase}`);
    return !re.test(src);
  }

  it('signalScanner.ts — ADR-0183 Phase 3 Stage A 후 *예상된* 호출자 (4 site wiring + helper)', () => {
    // ADR-0183 Stage A wiring: signalScanner helper is the expected production caller.
    // signalScanner.ts 는 이제 *예상된* 호출자 — recordBlockedDayShadowScan SSOT 헬퍼 안에서
    // ENV gate 통과 시에만 runShadowLearningOnlyScan 호출. 안전 invariant 7종 (ADR-0183 §3)
    // 준수 확인은 server/trading/signalScannerAdr0183Wiring.test.ts 의 22 케이스에서.
    const src = readSrcSafely(
      path.resolve(__dirname, 'signalScanner/preflight.ts'),
    );
    expect(src).not.toBeNull();
    if (src !== null) {
      // ADR-0183 wiring 정합 — 정확 1 import + 정확 1 helper 호출 + 정확 4 site 호출
      expect(src).toMatch(/from ['"]\.\.\/shadowLearningOnlyScan\.js['"]/);
      const helperCalls = src.match(/runShadowLearningOnlyScan\(/g);
      expect(helperCalls).not.toBeNull();
      expect(helperCalls!.length).toBe(1);  // helper 안 단일 호출
      const wiringCalls = src.match(/recordBlockedDayShadowScan\(['"]/g);
      expect(wiringCalls).not.toBeNull();
      expect(wiringCalls!.length).toBe(5);  // 4 macro sites + R3 sanity latch
    }
  });

  it('entryEngine.ts 본체에 runShadowLearningOnlyScan 호출 0건', () => {
    const src = readSrcSafely(
      path.resolve(__dirname, 'entryEngine.ts'),
    );
    if (src !== null) {
      expect(src).not.toMatch(/runShadowLearningOnlyScan/);
      expect(rejectsImports(src, 'shadowLearningOnlyScan')).toBe(true);
    }
  });

  it('signalScanner/perSymbol/buyListLoop.ts 본체에 runShadowLearningOnlyScan 호출 0건', () => {
    const src = readSrcSafely(
      path.resolve(__dirname, 'signalScanner/perSymbol/buyListLoop.ts'),
    );
    if (src !== null) {
      expect(src).not.toMatch(/runShadowLearningOnlyScan/);
      expect(rejectsImports(src, 'shadowLearningOnlyScan')).toBe(true);
    }
  });

  it('signalScanner/perSymbol/intradayLoop.ts 본체에 runShadowLearningOnlyScan 호출 0건', () => {
    const src = readSrcSafely(
      path.resolve(__dirname, 'signalScanner/perSymbol/intradayLoop.ts'),
    );
    if (src !== null) {
      expect(src).not.toMatch(/runShadowLearningOnlyScan/);
      expect(rejectsImports(src, 'shadowLearningOnlyScan')).toBe(true);
    }
  });

  it('exitEngine 디렉토리 어느 파일도 호출 0건', () => {
    const exitDir = path.resolve(__dirname, 'exitEngine');
    if (!fs.existsSync(exitDir)) return;
    const collect = (dir: string): string[] => {
      const out: string[] = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...collect(full));
        else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) {
          out.push(full);
        }
      }
      return out;
    };
    const files = collect(exitDir);
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      expect(src, `exitEngine/${path.relative(exitDir, f)} 가 runShadowLearningOnlyScan 을 호출`).not.toMatch(
        /runShadowLearningOnlyScan/,
      );
    }
  });
});
