/**
 * @responsibility ADR-0175 Phase 2b-1 — futureReturnResolver 회귀 (ENV gate / horizon / outcome / 정적 grep 가드)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEY = 'FUTURE_RETURN_RESOLVER_ENABLED';

// PERSIST_DATA_DIR 격리 — 모듈 import 전 설정 의무 (paths.ts DATA_DIR 은 const 라 1회 평가).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fut-ret-resolver-'));
process.env.PERSIST_DATA_DIR = tmpDir;

let mod: typeof import('./futureReturnResolver.js');
let repo: typeof import('../persistence/shadowLearningOnlySignalRepo.js');

beforeEach(async () => {
  delete process.env[ENV_KEY];
  vi.resetModules();
  mod = await import('./futureReturnResolver.js');
  repo = await import('../persistence/shadowLearningOnlySignalRepo.js');
  repo.__resetShadowLearningOnlySignalsForTests();
  process.env[ENV_KEY] = 'true';
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

/** 영속 파일 경로 — paths.ts SHADOW_LEARNING_ONLY_SIGNAL_FILE 와 동일 규약. */
function shadowFile(): string {
  return path.join(tmpDir, 'shadow-learning-only-signals.json');
}

function writeSignals(signals: unknown[]): void {
  fs.writeFileSync(shadowFile(), JSON.stringify(signals, null, 2), 'utf-8');
}

function readSignals(): unknown[] {
  if (!fs.existsSync(shadowFile())) return [];
  return JSON.parse(fs.readFileSync(shadowFile(), 'utf-8'));
}

/** 표준 영속 schema (ShadowLearningOnlySignal). 14필드 + outcome 옵셔널. */
function makeSignal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: 'AAPL',
    signalDate: '2026-04-21', // 화요일 (영업일)
    blockedReason: 'FOMC_BLOCK',
    wouldHaveBought: true,
    hypotheticalEntryPrice: 100,
    hypotheticalStopLoss: 92,
    hypotheticalTargetPrice: 115,
    signalGrade: 'STRONG_BUY',
    gateScore: 8,
    regime: 'R5_CAUTION',
    macroBlockReason: 'FOMC announcement',
    dataQualityStatus: 'OK',
    ...overrides,
  };
}

// ─── ENV 분기 4 (default OFF / 'true' / 'false' / '1' truthy 거부) ───────────────

describe('isFutureReturnResolverEnabled — ENV 분기', () => {
  it('default (미설정) → false', () => {
    delete process.env[ENV_KEY];
    expect(mod.isFutureReturnResolverEnabled()).toBe(false);
  });

  it("='true' → true", () => {
    process.env[ENV_KEY] = 'true';
    expect(mod.isFutureReturnResolverEnabled()).toBe(true);
  });

  it("='false' 명시 → false", () => {
    process.env[ENV_KEY] = 'false';
    expect(mod.isFutureReturnResolverEnabled()).toBe(false);
  });

  it("='1' truthy 거부 → false (정확 비교 SSOT)", () => {
    process.env[ENV_KEY] = '1';
    expect(mod.isFutureReturnResolverEnabled()).toBe(false);
  });
});

// ─── ENV OFF default 진입 → 즉시 빈 결과 ────────────────────────────────────────

describe('resolveFutureReturns — ENV gate', () => {
  it('ENV OFF default → 즉시 totalSignals=0 반환 (영속 read 안 함)', async () => {
    delete process.env[ENV_KEY];
    const result = await mod.resolveFutureReturns();
    expect(result.totalSignals).toBe(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.outcomesUpdated).toBe(0);
    expect(result.errors).toBe(0);
  });
});

// ─── 빈 영속 → totalSignals=0 ──────────────────────────────────────────────────

describe('resolveFutureReturns — 빈 영속', () => {
  it('ENV ON + 영속 부재 → totalSignals=0', async () => {
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-15T07:00:00.000Z'),
      priceFetcher: async () => 100,
    });
    expect(result.totalSignals).toBe(0);
    expect(result.resolvedCount).toBe(0);
  });

  it('ENV ON + 빈 배열 영속 → totalSignals=0', async () => {
    writeSignals([]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-15T07:00:00.000Z'),
      priceFetcher: async () => 100,
    });
    expect(result.totalSignals).toBe(0);
  });
});

// ─── closed signal skip (불변성 invariant) ─────────────────────────────────────

describe('resolveFutureReturns — closed signal 불변성', () => {
  it('outcome=WIN 재방문 안 됨', async () => {
    writeSignals([
      makeSignal({
        symbol: 'WINNER',
        outcome: 'WIN',
        futureReturn1d: 5.0,
        futureReturn3d: 7.0,
        futureReturn5d: 8.0,
        futureReturn20d: 10.0,
      }),
    ]);
    const fetcherCalls: string[] = [];
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T07:00:00.000Z'),
      priceFetcher: async (symbol) => {
        fetcherCalls.push(symbol);
        return 200;
      },
    });
    expect(result.totalSignals).toBe(0); // openSignals 필터에서 제외
    expect(fetcherCalls).toEqual([]);

    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].outcome).toBe('WIN');
    expect(persisted[0].futureReturn20d).toBe(10.0);
  });

  it('outcome=LOSS 재방문 안 됨', async () => {
    writeSignals([
      makeSignal({ symbol: 'LOSER', outcome: 'LOSS', futureReturn20d: -5 }),
    ]);
    let called = false;
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T07:00:00.000Z'),
      priceFetcher: async () => {
        called = true;
        return 90;
      },
    });
    expect(result.totalSignals).toBe(0);
    expect(called).toBe(false);
  });

  it('outcome=BE 재방문 안 됨', async () => {
    writeSignals([makeSignal({ symbol: 'BE_STOCK', outcome: 'BE' })]);
    let called = false;
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T07:00:00.000Z'),
      priceFetcher: async () => {
        called = true;
        return 100;
      },
    });
    expect(result.totalSignals).toBe(0);
    expect(called).toBe(false);
  });

  it('outcome=PENDING 또는 미설정 → 평가 대상 (totalSignals 카운트)', async () => {
    writeSignals([
      makeSignal({ symbol: 'PENDING_A', outcome: 'PENDING' }),
      makeSignal({ symbol: 'NO_OUTCOME' }), // outcome 미설정
    ]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-15T07:00:00.000Z'),
      priceFetcher: async () => 105,
    });
    expect(result.totalSignals).toBe(2);
  });
});

// ─── horizon 도달 분기 4 (1d / 3d / 5d / 20d) ─────────────────────────────────

describe('resolveFutureReturns — horizon 도달 분기', () => {
  it('signalDate=4/21 화 + now=4/22 수 → 1d 도달, 3/5/20d 미도달', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-04-22T08:00:00.000Z'), // 4/22 17:00 KST
      priceFetcher: async () => 105,
      horizons: [1, 3, 5, 20],
    });
    expect(result.totalSignals).toBe(1);
    expect(result.resolvedCount).toBe(1);

    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeCloseTo(5.0, 6);
    expect(persisted[0].futureReturn3d).toBeUndefined();
    expect(persisted[0].futureReturn5d).toBeUndefined();
    expect(persisted[0].futureReturn20d).toBeUndefined();
    expect(persisted[0].outcome).toBeUndefined();
  });

  it('signalDate=4/21 화 + now=4/24 금 → 1d/3d 도달, 5/20d 미도달', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-04-24T08:00:00.000Z'),
      priceFetcher: async () => 110,
    });
    expect(result.resolvedCount).toBe(1);

    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeCloseTo(10.0, 6);
    expect(persisted[0].futureReturn3d).toBeCloseTo(10.0, 6);
    expect(persisted[0].futureReturn5d).toBeUndefined();
    expect(persisted[0].futureReturn20d).toBeUndefined();
  });

  it('signalDate=4/21 화 + now=4/28 화 → 1d/3d/5d 도달, 20d 미도달', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-04-28T08:00:00.000Z'),
      priceFetcher: async () => 102,
    });
    expect(result.resolvedCount).toBe(1);

    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn5d).toBeCloseTo(2.0, 6);
    expect(persisted[0].futureReturn20d).toBeUndefined();
    expect(persisted[0].outcome).toBeUndefined();
  });

  it('signalDate=4/21 + now=5/30 (20d 영업일 후) → 모든 horizon 도달 + outcome 분류', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 112,
    });
    expect(result.resolvedCount).toBe(1);
    expect(result.outcomesUpdated).toBe(1);

    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeCloseTo(12.0, 6);
    expect(persisted[0].futureReturn3d).toBeCloseTo(12.0, 6);
    expect(persisted[0].futureReturn5d).toBeCloseTo(12.0, 6);
    expect(persisted[0].futureReturn20d).toBeCloseTo(12.0, 6);
    expect(persisted[0].outcome).toBe('WIN');
  });
});

// ─── futureReturn 갱신 정확성 ─────────────────────────────────────────────────

describe('resolveFutureReturns — futureReturn 정확성', () => {
  it('hypotheticalEntryPrice=100, asOf 가격=110 → futureReturn=10', async () => {
    writeSignals([makeSignal({ hypotheticalEntryPrice: 100 })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-04-22T08:00:00.000Z'),
      priceFetcher: async () => 110,
      horizons: [1],
    });
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeCloseTo(10.0, 6);
  });

  it('hypotheticalEntryPrice=200, asOf 가격=180 → futureReturn=-10', async () => {
    writeSignals([makeSignal({ hypotheticalEntryPrice: 200 })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-04-22T08:00:00.000Z'),
      priceFetcher: async () => 180,
      horizons: [1],
    });
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeCloseTo(-10.0, 6);
  });
});

// ─── outcome 분류 분기 (WIN > +1.0 / LOSS < -0.5 / BE 그 외, ADR-0112) ────────

describe('resolveFutureReturns — outcome 분류 (ADR-0112 임계)', () => {
  it('20d=+5 (> WIN_PCT_MIN=1.0) → outcome=WIN', async () => {
    writeSignals([makeSignal({ symbol: 'WIN_TEST' })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 105,
    });
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].outcome).toBe('WIN');
  });

  it('20d=-3 (< LOSS_PCT_MAX=-0.5) → outcome=LOSS', async () => {
    writeSignals([makeSignal({ symbol: 'LOSS_TEST' })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 97,
    });
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].outcome).toBe('LOSS');
  });

  it('20d=+0.3 (-0.5 < x ≤ +1.0) → outcome=BE', async () => {
    writeSignals([makeSignal({ symbol: 'BE_TEST' })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 100.3,
    });
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].outcome).toBe('BE');
  });

  it('20d=+1.0 (boundary, NOT > WIN_PCT_MIN) → outcome=BE', async () => {
    writeSignals([makeSignal({ symbol: 'BOUNDARY_WIN' })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 101.0,
    });
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].outcome).toBe('BE');
  });

  it('20d=-0.5 (boundary, NOT < LOSS_PCT_MAX) → outcome=BE', async () => {
    writeSignals([makeSignal({ symbol: 'BOUNDARY_LOSS' })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 99.5,
    });
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].outcome).toBe('BE');
  });
});

// ─── priceFetcher 실패 분기 ───────────────────────────────────────────────────

describe('resolveFutureReturns — priceFetcher 실패', () => {
  it('priceFetcher null 반환 → errors++ + 다음 horizon 시도', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    let calls = 0;
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => {
        calls++;
        return null;
      },
    });
    expect(result.errors).toBe(4);
    expect(result.resolvedCount).toBe(0);
    expect(calls).toBe(4);
  });

  it('priceFetcher throw → errors++ + 다음 horizon 시도', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    let calls = 0;
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => {
        calls++;
        throw new Error('KIS timeout');
      },
    });
    expect(result.errors).toBe(4);
    expect(result.resolvedCount).toBe(0);
    expect(calls).toBe(4);
  });

  it('priceFetcher 미전달 → 모든 signal errors + 영속 변경 0', async () => {
    writeSignals([makeSignal({ symbol: 'A' }), makeSignal({ symbol: 'B' })]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      // priceFetcher 미전달
    });
    expect(result.totalSignals).toBe(2);
    expect(result.errors).toBe(2);
    expect(result.resolvedCount).toBe(0);
    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeUndefined();
  });

  it('priceFetcher 일부 성공 / 일부 null → 부분 갱신', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async (_symbol, asOf) => {
        const ymd = asOf.toISOString().slice(0, 10);
        if (ymd === '2026-04-22' || ymd === '2026-04-28') return 105;
        return null;
      },
    });
    expect(result.errors).toBe(2);
    expect(result.resolvedCount).toBe(1);
    expect(result.outcomesUpdated).toBe(0);

    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeCloseTo(5.0, 6);
    expect(persisted[0].futureReturn3d).toBeUndefined();
    expect(persisted[0].futureReturn5d).toBeCloseTo(5.0, 6);
    expect(persisted[0].futureReturn20d).toBeUndefined();
    expect(persisted[0].outcome).toBeUndefined();
  });
});

// ─── 영속 round-trip + 변경 없음 시 skip ──────────────────────────────────────

describe('resolveFutureReturns — 영속 round-trip', () => {
  it('변경 0건 (모든 horizon 미도달) → 영속 mtime 변경 안 함', async () => {
    writeSignals([makeSignal({ signalDate: '2026-04-21' })]);
    const beforeContent = fs.readFileSync(shadowFile()).toString();
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-04-21T10:00:00.000Z'), // signalDate 당일 — 1d 미도달
      priceFetcher: async () => 100,
    });
    expect(result.resolvedCount).toBe(0);
    const afterContent = fs.readFileSync(shadowFile()).toString();
    expect(afterContent).toBe(beforeContent);
  });

  it('round-trip — 갱신 후 outcome / futureReturn 영속', async () => {
    writeSignals([makeSignal({ symbol: 'ROUND_TRIP', signalDate: '2026-04-21' })]);
    await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 110,
    });
    // 두 번째 호출 — 이미 갱신된 horizon 은 skip + outcome 분류된 signal 은 closed
    const result2 = await mod.resolveFutureReturns({
      now: new Date('2026-05-30T08:00:00.000Z'),
      priceFetcher: async () => 200,
    });
    expect(result2.totalSignals).toBe(0); // outcome=WIN closed
    expect(result2.resolvedCount).toBe(0);

    const persisted = readSignals() as Array<Record<string, unknown>>;
    expect(persisted[0].futureReturn1d).toBeCloseTo(10.0, 6);
    expect(persisted[0].outcome).toBe('WIN');
  });
});

// ─── 정적 grep 가드 — KIS 주문 함수 import 0건 (안전 invariant 2) ────────────

describe('정적 grep 가드 — 안전 invariant', () => {
  it('KIS 주문 함수 5종 import 0건', () => {
    const src = fs.readFileSync(
      path.resolve('server/learning/futureReturnResolver.ts'),
      'utf-8',
    );
    // import 라인만 추출 (안내 주석은 통과)
    const importBlock: string[] = [];
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (t.startsWith('import ') || (t.startsWith('}') && importBlock.length > 0)) {
        importBlock.push(line);
      } else if (importBlock.length > 0 && t.startsWith('from ')) {
        importBlock.push(line);
      } else if (importBlock.length > 0 && !t.startsWith('}') && !t.startsWith('from ')) {
        // 다중 라인 import 중 (`{ a,\n  b }` 같은 패턴)
        if (t.length > 0 && !t.startsWith('//')) {
          importBlock.push(line);
        }
      }
    }
    const joined = importBlock.join('\n');
    expect(joined).not.toMatch(/placeKisMarketOrder/);
    expect(joined).not.toMatch(/placeKisSellOrder/);
    expect(joined).not.toMatch(/cancelKisOrder/);
    expect(joined).not.toMatch(/placeKisStopLossOrder/);
    expect(joined).not.toMatch(/placeKisTakeProfitOrder/);
  });

  it('호출자 1건 (cron 만) — server 코드베이스 grep', async () => {
    const serverDir = path.resolve('server');
    const files: string[] = [];
    function walk(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
          continue;
        }
        if (!entry.isFile() || !full.endsWith('.ts') || full.endsWith('.d.ts')) continue;
        const src = fs.readFileSync(full, 'utf-8');
        if (/\bresolveFutureReturns\b|\bisFutureReturnResolverEnabled\b/.test(src)) {
          files.push(path.relative(process.cwd(), full).replace(/\\/g, '/'));
        }
      }
    }
    walk(serverDir);
    // 화이트리스트 — 모듈 본체 + 본 테스트 + cron 등록 (learningJobs.ts) + ADR-0176 mock (missedLearningReplay.test.ts)
    // missedLearningReplay.test.ts 는 registerLearningJobs() 호출 시 다른 학습 함수 본체가 실제 실행되지
    // 않도록 vi.mock 으로 격리한 결과 식별자 등장 — 정상 회귀 가드.
    const allowed = new Set([
      'server/learning/futureReturnResolver.ts',
      'server/learning/futureReturnResolver.test.ts',
      'server/scheduler/learningJobs.ts',
      'server/scheduler/learningJobsCronWiring.test.ts',
      'server/scheduler/missedLearningReplay.test.ts',
    ]);
    for (const f of files) {
      expect(allowed.has(f), `예상치 못한 호출자: ${f}`).toBe(true);
    }
    // 최소 — 모듈 본체 + cron 등록 포함
    expect(files).toContain('server/learning/futureReturnResolver.ts');
    expect(files).toContain('server/scheduler/learningJobs.ts');
  });
});

// ─── 내부 헬퍼 단위 테스트 (__testOnly) ───────────────────────────────────────

describe('__testOnly — 내부 헬퍼', () => {
  it('classifyOutcomeByFutureReturn — 4 분기', () => {
    expect(mod.__testOnly.classifyOutcomeByFutureReturn(5.0)).toBe('WIN');
    expect(mod.__testOnly.classifyOutcomeByFutureReturn(-3.0)).toBe('LOSS');
    expect(mod.__testOnly.classifyOutcomeByFutureReturn(0.3)).toBe('BE');
    expect(mod.__testOnly.classifyOutcomeByFutureReturn(NaN)).toBe('BE');
  });

  it('normalizeSignalDate — ISO + YYYY-MM-DD + 잘못된 형식', () => {
    expect(mod.__testOnly.normalizeSignalDate('2026-04-21')).toBe('2026-04-21');
    expect(mod.__testOnly.normalizeSignalDate('2026-04-21T08:00:00.000Z')).toBe(
      '2026-04-21',
    );
    expect(mod.__testOnly.normalizeSignalDate('invalid')).toBe('');
    expect(mod.__testOnly.normalizeSignalDate('')).toBe('');
  });

  it('isHorizonReached — signalDate + horizon ≤ nowYmd', () => {
    expect(mod.__testOnly.isHorizonReached('2026-04-21', 1, '2026-04-22')).toBe(
      true,
    );
    expect(mod.__testOnly.isHorizonReached('2026-04-21', 1, '2026-04-21')).toBe(
      false,
    );
    expect(mod.__testOnly.isHorizonReached('2026-04-21', 5, '2026-04-28')).toBe(
      true,
    );
    expect(mod.__testOnly.isHorizonReached('2026-04-21', 5, '2026-04-27')).toBe(
      false,
    );
  });

  it('horizonFieldKey — 4 horizon → 4 field', () => {
    expect(mod.__testOnly.horizonFieldKey(1)).toBe('futureReturn1d');
    expect(mod.__testOnly.horizonFieldKey(3)).toBe('futureReturn3d');
    expect(mod.__testOnly.horizonFieldKey(5)).toBe('futureReturn5d');
    expect(mod.__testOnly.horizonFieldKey(20)).toBe('futureReturn20d');
  });
});

// ─── 통합 — 잘못된 signalDate / hypotheticalEntryPrice 안전 ────────────────────

describe('resolveFutureReturns — 손상 데이터 안전', () => {
  it('잘못된 signalDate 형식 → silent skip (errors 미카운트)', async () => {
    writeSignals([
      makeSignal({ symbol: 'GOOD', signalDate: '2026-04-21' }),
      makeSignal({ symbol: 'BAD_DATE', signalDate: 'invalid-date' }),
    ]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-04-22T08:00:00.000Z'),
      priceFetcher: async () => 105,
      horizons: [1],
    });
    expect(result.totalSignals).toBe(2);
    expect(result.resolvedCount).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('hypotheticalEntryPrice ≤ 0 → silent skip (영속 보존)', async () => {
    writeSignals([
      makeSignal({ symbol: 'BAD_ENTRY', hypotheticalEntryPrice: 0 }),
    ]);
    const result = await mod.resolveFutureReturns({
      now: new Date('2026-04-22T08:00:00.000Z'),
      priceFetcher: async () => 100,
      horizons: [1],
    });
    expect(result.totalSignals).toBe(1);
    expect(result.resolvedCount).toBe(0);
  });
});
