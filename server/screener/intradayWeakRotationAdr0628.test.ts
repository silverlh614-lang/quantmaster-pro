/**
 * intradayWeakRotationAdr0628.test.ts — ADR-0628 D5 (약세 종목 회전) 회귀.
 *
 * 8 케이스 (D5 testsRequired a~h):
 *  (1) flag OFF → evictionStrategy 미주입, 기존 momentum_full/tryEvictWeakest byte-identical
 *  (2) flag ON + 캡 만석 + 강한 리더 → 가장 약한 evictable 멤버 evict + 리더 admit
 *  (3) flag ON + 리더 강도 ≤ 최약체+margin → evict 안 함(admit 실패, momentum_full 유지)
 *  (4) 보호 목록(SWING/CATALYST/보유/MANUAL/isFocus/grace/intradayActive) 제외 검증
 *  (5) 사이클당 상한 3 초과 안 함
 *  (6) 신선 changeRate 부재 → composite(기존) fallback (evict 제외)
 *  (7) ledger 보존(evict 해도 shadow/counterfactual row 변경 0 — read-only)
 *  (8) 보유 종목 절대 evict 안 됨(getOpenPositions 차단)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';
import type { WeakRotationContext } from './intradayWeakRotation.js';

// ── 헬퍼 — MOMENTUM watchlist entry ───────────────────────────────────────────
function momEntry(over: Partial<WatchlistEntry> & { code: string; name: string }): WatchlistEntry {
  return {
    section: 'MOMENTUM',
    entryPrice: 10_000,
    stopLoss: 9_500,
    targetPrice: 11_000,
    addedAt: '2020-01-01T00:00:00.000Z', // grace 한참 지남
    addedBy: 'AUTO',
    gateScore: 5.0,
    ...over,
  };
}

function makeCtx(over: Partial<WeakRotationContext> = {}): WeakRotationContext {
  return {
    kospiDayReturn: 1.0,
    leaderStrength: 10.0,
    heldCodes: new Set<string>(),
    freshChangeRateOf: () => null,
    evictedThisCycle: 0,
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// A. 순수 함수 단위 — weakRotationStrengthOf / isWeakRotationEvictable / strategy
// ──────────────────────────────────────────────────────────────────────────────
describe('intradayWeakRotation — 순수 함수 (D5.2/D5.3/D5.5)', () => {
  beforeEach(() => { vi.resetModules(); });

  it('weakRotationStrengthOf — changeRate − kospiDayReturn (벤치마크 상대값)', async () => {
    const { weakRotationStrengthOf } = await import('./intradayWeakRotation.js');
    const ctx = makeCtx({ kospiDayReturn: 1.5, freshChangeRateOf: () => -2.0 });
    const e = momEntry({ code: '000001', name: 'A' });
    expect(weakRotationStrengthOf(e, ctx)).toBeCloseTo(-3.5); // -2.0 - 1.5
  });

  it('weakRotationStrengthOf — screener 미수록(null)/비유한 → null (D5.2 보수 fallback)', async () => {
    const { weakRotationStrengthOf } = await import('./intradayWeakRotation.js');
    const e = momEntry({ code: '000001', name: 'A' });
    expect(weakRotationStrengthOf(e, makeCtx({ freshChangeRateOf: () => null }))).toBeNull();
    expect(weakRotationStrengthOf(e, makeCtx({ freshChangeRateOf: () => NaN }))).toBeNull();
  });

  it('isWeakRotationEvictable — SWING/CATALYST 섹션 보호 (false)', async () => {
    const { isWeakRotationEvictable } = await import('./intradayWeakRotation.js');
    const ctx = makeCtx({ freshChangeRateOf: () => -5.0 });
    expect(isWeakRotationEvictable(momEntry({ code: '1', name: 'A', section: 'SWING' }), ctx)).toBe(false);
    expect(isWeakRotationEvictable(momEntry({ code: '2', name: 'B', section: 'CATALYST' }), ctx)).toBe(false);
  });

  it('isWeakRotationEvictable — 보유(heldCodes)/MANUAL/isFocus 보호 (false)', async () => {
    const { isWeakRotationEvictable } = await import('./intradayWeakRotation.js');
    const base = makeCtx({ freshChangeRateOf: () => -5.0, heldCodes: new Set(['000010']) });
    expect(isWeakRotationEvictable(momEntry({ code: '000010', name: 'held' }), base)).toBe(false);
    expect(isWeakRotationEvictable(momEntry({ code: '000011', name: 'manual', addedBy: 'MANUAL' }), base)).toBe(false);
    expect(isWeakRotationEvictable(momEntry({ code: '000012', name: 'focus', isFocus: true }), base)).toBe(false);
  });

  it('isWeakRotationEvictable — bridge grace(10분 이내) 보호 (false), grace 경과 → 적격', async () => {
    const { isWeakRotationEvictable } = await import('./intradayWeakRotation.js');
    const ctx = makeCtx({ freshChangeRateOf: () => -5.0 });
    const fresh = momEntry({ code: '1', name: 'fresh', leadershipBridge: true, addedAt: new Date().toISOString() });
    expect(isWeakRotationEvictable(fresh, ctx)).toBe(false);
    const old = momEntry({ code: '2', name: 'old', leadershipBridge: true, addedAt: '2020-01-01T00:00:00.000Z' });
    expect(isWeakRotationEvictable(old, ctx)).toBe(true);
  });

  it('isWeakRotationEvictable — intradayActiveCodes 보호 (집합 미주입 시 해당 보호만 skip)', async () => {
    const { isWeakRotationEvictable } = await import('./intradayWeakRotation.js');
    const withSet = makeCtx({ freshChangeRateOf: () => -5.0, intradayActiveCodes: new Set(['000020']) });
    expect(isWeakRotationEvictable(momEntry({ code: '000020', name: 'active' }), withSet)).toBe(false);
    // 집합 미주입 → 해당 보호 skip, 신선신호 있으면 적격
    const noSet = makeCtx({ freshChangeRateOf: () => -5.0 });
    expect(isWeakRotationEvictable(momEntry({ code: '000020', name: 'active' }), noSet)).toBe(true);
  });

  it('isWeakRotationEvictable — 신선신호 부재 → 회전 제외 (false, D5.2)', async () => {
    const { isWeakRotationEvictable } = await import('./intradayWeakRotation.js');
    expect(isWeakRotationEvictable(
      momEntry({ code: '000030', name: 'nofresh' }),
      makeCtx({ freshChangeRateOf: () => null }),
    )).toBe(false);
  });

  it('strategy — 최약체 evict (리더 강도 > 최약체 + margin)', async () => {
    const { buildWeakRotationEvictionStrategy } = await import('./intradayWeakRotation.js');
    const list = [
      momEntry({ code: '000001', name: 'strong' }),   // changeRate +3 → rel +2
      momEntry({ code: '000002', name: 'weakest' }),   // changeRate -4 → rel -5
      momEntry({ code: '000003', name: 'mid' }),       // changeRate 0 → rel -1
    ];
    const fresh: Record<string, number> = { '000001': 3, '000002': -4, '000003': 0 };
    const ctx = makeCtx({
      kospiDayReturn: 1.0,
      leaderStrength: 10.0, // > -5 + 2.0
      freshChangeRateOf: (c) => fresh[c] ?? null,
    });
    const strategy = buildWeakRotationEvictionStrategy(ctx);
    const evicted = strategy(list, momEntry({ code: '999', name: 'leader' }));
    expect(evicted?.code).toBe('000002'); // 최약체
    expect(list.find((w) => w.code === '000002')).toBeUndefined(); // in-place splice
    expect(list).toHaveLength(2);
  });

  it('strategy — margin 미달 → null (evict 안 함)', async () => {
    const { buildWeakRotationEvictionStrategy } = await import('./intradayWeakRotation.js');
    const list = [momEntry({ code: '000002', name: 'weakest' })];
    const ctx = makeCtx({
      kospiDayReturn: 1.0,
      leaderStrength: -3.5, // 최약체 rel = -4-1 = -5; -5 + 2.0 = -3.0; -3.5 < -3.0 → 미달
      freshChangeRateOf: () => -4,
    });
    const strategy = buildWeakRotationEvictionStrategy(ctx);
    expect(strategy(list, momEntry({ code: '999', name: 'leader' }))).toBeNull();
    expect(list).toHaveLength(1); // 보존
  });

  it('strategy — 사이클 상한 도달 시 null (evictedThisCycle ≥ max)', async () => {
    const { buildWeakRotationEvictionStrategy, getWeakRotationMaxPerCycle } = await import('./intradayWeakRotation.js');
    const list = [momEntry({ code: '000002', name: 'weakest' })];
    const ctx = makeCtx({
      leaderStrength: 100,
      freshChangeRateOf: () => -4,
      evictedThisCycle: getWeakRotationMaxPerCycle(), // 상한 도달
    });
    expect(buildWeakRotationEvictionStrategy(ctx)(list, momEntry({ code: '999', name: 'leader' }))).toBeNull();
    expect(list).toHaveLength(1);
  });

  it('strategy — 적격 후보 0(전부 보호/신선신호 부재) → null', async () => {
    const { buildWeakRotationEvictionStrategy } = await import('./intradayWeakRotation.js');
    const list = [
      momEntry({ code: '000001', name: 'manual', addedBy: 'MANUAL' }),
      momEntry({ code: '000002', name: 'nofresh' }), // freshChangeRateOf → null
    ];
    const ctx = makeCtx({ leaderStrength: 100, freshChangeRateOf: (c) => c === '000001' ? -9 : null });
    expect(buildWeakRotationEvictionStrategy(ctx)(list, momEntry({ code: '999', name: 'leader' }))).toBeNull();
    expect(list).toHaveLength(2);
  });
});

describe('intradayWeakRotation — flag/상수 SSOT', () => {
  const origFlag = process.env.INTRADAY_WEAK_ROTATION_ENABLED;
  const origMax = process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    if (origFlag === undefined) delete process.env.INTRADAY_WEAK_ROTATION_ENABLED;
    else process.env.INTRADAY_WEAK_ROTATION_ENABLED = origFlag;
    if (origMax === undefined) delete process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE;
    else process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE = origMax;
  });

  it('isIntradayWeakRotationEnabled — default OFF, === "true" 만 활성', async () => {
    delete process.env.INTRADAY_WEAK_ROTATION_ENABLED;
    let mod = await import('./intradayWeakRotation.js');
    expect(mod.isIntradayWeakRotationEnabled()).toBe(false);
    vi.resetModules();
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = '1';
    mod = await import('./intradayWeakRotation.js');
    expect(mod.isIntradayWeakRotationEnabled()).toBe(false);
    vi.resetModules();
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    mod = await import('./intradayWeakRotation.js');
    expect(mod.isIntradayWeakRotationEnabled()).toBe(true);
  });

  it('getWeakRotationMaxPerCycle — 기본 3, 0 이하/NaN → 3, override floor', async () => {
    delete process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE;
    let mod = await import('./intradayWeakRotation.js');
    expect(mod.getWeakRotationMaxPerCycle()).toBe(3);
    vi.resetModules();
    process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE = '0';
    mod = await import('./intradayWeakRotation.js');
    expect(mod.getWeakRotationMaxPerCycle()).toBe(3);
    vi.resetModules();
    process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE = '5.9';
    mod = await import('./intradayWeakRotation.js');
    expect(mod.getWeakRotationMaxPerCycle()).toBe(5);
  });

  it('상수 — MARGIN=2.0, GRACE_MS=10분', async () => {
    const { WEAK_ROTATION_STRENGTH_MARGIN, WEAK_ROTATION_GRACE_MS } = await import('./intradayWeakRotation.js');
    expect(WEAK_ROTATION_STRENGTH_MARGIN).toBe(2.0);
    expect(WEAK_ROTATION_GRACE_MS).toBe(10 * 60 * 1000);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// B. leadershipBridge 통합 — getOpenPositions/getScreenerCache mock
// ──────────────────────────────────────────────────────────────────────────────
const mockState = {
  openPositions: [] as Array<{ trade: { stockCode: string } }>,
  screener: [] as Array<{ code: string; changeRate: number }>,
};

vi.mock('../persistence/shadowPositionLedger.js', () => ({
  getOpenPositions: () => mockState.openPositions,
}));
vi.mock('./stockScreener.js', () => ({
  getScreenerCache: () => mockState.screener,
}));

describe('leadershipBridge — D5 회전 통합', () => {
  // watchlist 영속 funnel(KRX master 검증 등) 최초 import warmup 비용 흡수.
  vi.setConfig({ testTimeout: 20_000 });
  let tmpDir: string;
  const origFlag = process.env.INTRADAY_WEAK_ROTATION_ENABLED;

  function writeWatchlist(entries: WatchlistEntry[]) {
    fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), JSON.stringify(entries));
  }
  function readWatchlist(): WatchlistEntry[] {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, 'watchlist.json'), 'utf-8'));
  }
  // MOMENTUM cap(50) 만석 채우기 (gateScore 높게 → tryEvictWeakest 가 신규를 못 밀어내게)
  const MOM_CAP = 50;
  function fillMomentum(count: number, opts: { weakest?: string } = {}): WatchlistEntry[] {
    const out: WatchlistEntry[] = [];
    for (let i = 0; i < count; i++) {
      const code = String(100000 + i);
      out.push(momEntry({ code, name: `M${i}`, gateScore: 9.0 }));
    }
    if (opts.weakest) out[0].code = opts.weakest;
    return out;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weakrot-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    mockState.openPositions = [];
    mockState.screener = [];
    process.env.LEADERSHIP_BRIDGE_ENABLED = 'true';
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.LEADERSHIP_BRIDGE_ENABLED;
    if (origFlag === undefined) delete process.env.INTRADAY_WEAK_ROTATION_ENABLED;
    else process.env.INTRADAY_WEAK_ROTATION_ENABLED = origFlag;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  // (1) flag OFF → byte-identical (회전 미주입, 만석 → momentum_full)
  it('(1) flag OFF → 만석 시 momentum_full, 회전 0 (byte-identical)', async () => {
    delete process.env.INTRADAY_WEAK_ROTATION_ENABLED;
    // 만석 + 모든 멤버 gateScore 9.0(신규 5.5 가 못 밀어냄) — 약세 screener 가 있어도 무시돼야 함
    writeWatchlist(fillMomentum(MOM_CAP, { weakest: '111111' }));
    mockState.screener = [{ code: '111111', changeRate: -9 }]; // 약세지만 flag OFF → 무시
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '리더', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 10, currentPrice: 60_000 },
    ], { kospiDayReturn: 0 });
    expect(res.added).toBe(0);
    expect(res.skippedByReason.momentum_full).toBe(1);
    expect(readWatchlist().some((w) => w.code === '111111')).toBe(true); // evict 안 됨
  });

  // (2) flag ON + 만석 + 강한 리더 → 최약체 evict + 리더 admit
  it('(2) flag ON + 만석 + 강한 리더 → 최약체 evict + 리더 admit', async () => {
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    writeWatchlist(fillMomentum(MOM_CAP, { weakest: '111111' }));
    mockState.screener = [{ code: '111111', changeRate: -9 }]; // rel = -9-0 = -9 (최약체)
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '리더', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 5, currentPrice: 60_000 },
    ], { kospiDayReturn: 0 }); // leaderStrength 5 > -9 + 2.0 → 회전
    expect(res.added).toBe(1);
    const list = readWatchlist();
    expect(list.some((w) => w.code === '111111')).toBe(false); // evict 됨
    expect(list.some((w) => w.code === '005930')).toBe(true);  // admit
  });

  // (3) flag ON + margin 미달 → evict 안 함 + momentum_full
  it('(3) flag ON + 리더 강도 ≤ 최약체+margin → evict 0, momentum_full', async () => {
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    writeWatchlist(fillMomentum(MOM_CAP, { weakest: '111111' }));
    mockState.screener = [{ code: '111111', changeRate: 0 }]; // rel = 0; 0 + 2.0 = 2.0
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '리더', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 1.5, currentPrice: 60_000 },
    ], { kospiDayReturn: 0 }); // 1.5 ≤ 2.0 → 미달
    expect(res.added).toBe(0);
    expect(res.skippedByReason.momentum_full).toBe(1);
    expect(readWatchlist().some((w) => w.code === '111111')).toBe(true); // 보존
  });

  // (4) 보호 목록 — 보유/MANUAL 은 가장 약해도 보존, 차약체가 evict 됨
  it('(4) 보호 목록(보유·MANUAL) 제외 — 보호 멤버는 최약체여도 보존', async () => {
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    const list = fillMomentum(MOM_CAP);
    list[0] = momEntry({ code: '111111', name: 'held', gateScore: 9.0 });     // 최약 screener but 보유
    list[1] = momEntry({ code: '222222', name: 'manual', gateScore: 9.0, addedBy: 'MANUAL' }); // 보호
    list[2] = momEntry({ code: '333333', name: 'evictable', gateScore: 9.0 }); // 적격 최약체
    writeWatchlist(list);
    mockState.openPositions = [{ trade: { stockCode: '111111' } }];
    mockState.screener = [
      { code: '111111', changeRate: -20 }, // 가장 약함이나 보유 보호
      { code: '222222', changeRate: -15 }, // MANUAL 보호
      { code: '333333', changeRate: -5 },  // 적격 최약체
    ];
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '리더', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 10, currentPrice: 60_000 },
    ], { kospiDayReturn: 0 });
    expect(res.added).toBe(1);
    const after = readWatchlist();
    expect(after.some((w) => w.code === '111111')).toBe(true);  // 보유 보존
    expect(after.some((w) => w.code === '222222')).toBe(true);  // MANUAL 보존
    expect(after.some((w) => w.code === '333333')).toBe(false); // 적격 최약체 evict
  });

  // (5) 사이클 상한 3 — 4개 리더 admit 시도 시 evict 최대 3
  it('(5) 사이클당 상한 3 초과 안 함', async () => {
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE = '3';
    // 만석 18, 모두 약세 screener (전부 evictable)
    const list = fillMomentum(MOM_CAP);
    writeWatchlist(list);
    mockState.screener = list.map((w, i) => ({ code: w.code, changeRate: -10 - i }));
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const leaders = Array.from({ length: 4 }, (_, i) => ({
      code: String(900001 + i), name: `L${i}`, gateScore: 5.5, mtas: 7,
      sectorRelativeStrength: 50, currentPrice: 60_000,
    }));
    const res = bridgeLeadersToMomentum(leaders, { kospiDayReturn: 0 });
    expect(res.added).toBe(3); // 상한 3
    expect(res.skippedByReason.momentum_full).toBe(1); // 4번째는 fallback
    delete process.env.INTRADAY_WEAK_ROTATION_MAX_PER_CYCLE;
  });

  // (6) 신선신호 부재 → composite(기존 tryEvictWeakest) fallback
  it('(6) 신선 changeRate 부재(screener 미수록) → 회전 제외, momentum_full', async () => {
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    writeWatchlist(fillMomentum(MOM_CAP, { weakest: '111111' })); // gateScore 9.0
    mockState.screener = []; // 신선신호 전무 → 적격 후보 0 → strategy null → momentum_full
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '리더', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 50, currentPrice: 60_000 },
    ], { kospiDayReturn: 0 });
    expect(res.added).toBe(0);
    expect(res.skippedByReason.momentum_full).toBe(1);
    expect(readWatchlist()).toHaveLength(MOM_CAP); // 변화 0
  });

  // (7) ledger 보존 — evict 해도 getOpenPositions 원천(mock 데이터) 변경 0 (read-only)
  it('(7) ledger 보존 — evict 후에도 openPositions read-only(변경 0)', async () => {
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    writeWatchlist(fillMomentum(MOM_CAP, { weakest: '111111' }));
    mockState.openPositions = [{ trade: { stockCode: '999999' } }]; // 무관 보유
    const ledgerSnapshot = JSON.stringify(mockState.openPositions);
    mockState.screener = [{ code: '111111', changeRate: -9 }];
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    bridgeLeadersToMomentum([
      { code: '005930', name: '리더', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 50, currentPrice: 60_000 },
    ], { kospiDayReturn: 0 });
    // evict 가 발생했어도 ledger(보유 원장)는 read-only — 변경 0 (불변식 #2)
    expect(JSON.stringify(mockState.openPositions)).toBe(ledgerSnapshot);
    expect(readWatchlist().some((w) => w.code === '111111')).toBe(false); // watchlist 멤버십만 제거
  });

  // (8) 보유 종목 절대 evict 금지 — 최약체여도 보존, admit 실패
  it('(8) 보유 종목은 relativeChangeRate 최저여도 절대 evict 안 됨', async () => {
    process.env.INTRADAY_WEAK_ROTATION_ENABLED = 'true';
    // 만석 18, 단 1개만 screener 수록(=유일 적격 후보)인데 그게 보유 종목 → 적격 0
    const list = fillMomentum(MOM_CAP, { weakest: '111111' });
    writeWatchlist(list);
    mockState.openPositions = [{ trade: { stockCode: '111111' } }];
    mockState.screener = [{ code: '111111', changeRate: -30 }]; // 극약세지만 보유 → 차단
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '리더', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 50, currentPrice: 60_000 },
    ], { kospiDayReturn: 0 });
    expect(res.added).toBe(0);
    expect(res.skippedByReason.momentum_full).toBe(1);
    expect(readWatchlist().some((w) => w.code === '111111')).toBe(true); // 보유 보존
  });
});
