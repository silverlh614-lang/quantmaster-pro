/**
 * @responsibility ADR-0624 shakeoutStopForwardLabeler 회귀 — ENV gate / 셰이크아웃 산식 / KIS read-only / 성숙 전이 / 원본 불변
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEY = 'SHAKEOUT_STOP_FORWARD_LABELER_ENABLED';

// PERSIST_DATA_DIR 격리 — 모듈 import 전 설정 의무 (paths.ts DATA_DIR 은 const).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakeout-labeler-'));
process.env.PERSIST_DATA_DIR = tmpDir;

let mod: typeof import('./shakeoutStopForwardLabeler.js');
let repo: typeof import('../persistence/shakeoutStopOutcomeRepo.js');
let shadowRepo: typeof import('../persistence/shadowTradeRepo.js');

type Trade = import('../persistence/shadowTradeRepo.js').ServerShadowTrade;

function makeTrade(partial: Partial<Trade>): Trade {
  return {
    id: 'T1',
    stockCode: '219130',
    stockName: '타이거일렉',
    signalTime: '2026-06-01T00:00:00.000Z',
    signalPrice: 10000,
    shadowEntryPrice: 10000,
    quantity: 0,
    stopLoss: 9500,
    targetPrice: 12000,
    status: 'HIT_STOP',
    exitPrice: 10000,
    exitTime: '2026-06-02T06:00:00.000Z', // KST 2026-06-02 15:00
    exitOutcome: 'LOSS',
    stopLossExitType: 'INITIAL',
    ...partial,
  } as Trade;
}

beforeEach(async () => {
  delete process.env[ENV_KEY];
  vi.resetModules();
  mod = await import('./shakeoutStopForwardLabeler.js');
  repo = await import('../persistence/shakeoutStopOutcomeRepo.js');
  shadowRepo = await import('../persistence/shadowTradeRepo.js');
  repo.__resetShakeoutStopOutcomeLedgerForTests();
  shadowRepo.saveShadowTrades([]);
});

afterEach(() => {
  delete process.env[ENV_KEY];
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
});

// now far enough past exit so all horizons (≤10 business days) reached.
const NOW = new Date('2026-07-15T08:00:00.000Z');

describe('shakeoutStopForwardLabeler (ADR-0624)', () => {
  it('labeler_envOff_noop: ENV OFF → fetch 0·repo 미변경·durationMs 0', async () => {
    shadowRepo.saveShadowTrades([makeTrade({})]);
    const fetcher = vi.fn().mockResolvedValue(10600);
    const res = await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher });
    expect(res.durationMs).toBe(0);
    expect(res.totalCandidates).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(repo.loadLabels()).toHaveLength(0);
  });

  it('labeler_shakeout_threshold: max forwardClose 10600 → 6% ≥5 → isShakeout=true', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([makeTrade({ exitPrice: 10000 })]);
    // all horizons return 10600 → recovery 6%.
    const fetcher = vi.fn().mockResolvedValue(10600);
    const res = await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher });
    expect(res.resolvedNow).toBe(1);
    expect(res.shakeoutCount).toBe(1);
    const [label] = repo.loadLabels();
    expect(label.maturity).toBe('RESOLVED');
    expect(label.isShakeout).toBe(true);
    expect(label.maxRecoveryPct).toBeCloseTo(6, 5);
  });

  it('labeler_not_shakeout: max forwardClose 10300 → 3% <5 → isShakeout=false', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([makeTrade({ exitPrice: 10000 })]);
    const fetcher = vi.fn().mockResolvedValue(10300);
    const res = await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher });
    expect(res.resolvedNow).toBe(1);
    expect(res.shakeoutCount).toBe(0);
    const [label] = repo.loadLabels();
    expect(label.isShakeout).toBe(false);
    expect(label.maxRecoveryPct).toBeCloseTo(3, 5);
  });

  it('labeler_kis_readonly: 모듈 소스에 KIS 주문 함수 import 0건', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'shakeoutStopForwardLabeler.ts'),
      'utf-8',
    );
    for (const banned of [
      'placeKisMarketOrder',
      'placeKisSellOrder',
      'cancelKisOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
    ]) {
      // import 가드 — 함수명 등장 0 (호출자 표시 주석 포함 0).
      expect(src.includes(banned)).toBe(false);
    }
  });

  it('labeler_fetcher_missing: fetcher 미전달 → 전건 errors·repo 미변경', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([makeTrade({}), makeTrade({ id: 'T2', stockCode: '000660' })]);
    const res = await mod.runShakeoutStopForwardLabeler({ now: NOW });
    expect(res.errors).toBe(2);
    expect(res.totalCandidates).toBe(2);
    expect(repo.loadLabels()).toHaveLength(0);
  });

  it('labeler_provider_null_skip: fetcher null → horizon skip·errors++·약세변환 0·PENDING 유지', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([makeTrade({ exitPrice: 10000 })]);
    const fetcher = vi.fn().mockResolvedValue(null);
    const res = await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher });
    expect(res.errors).toBeGreaterThan(0);
    expect(res.resolvedNow).toBe(0);
    const labels = repo.loadLabels();
    // PENDING (null 종가 → 미충족) — isShakeout 미확정 (약세 변환 없음).
    expect(labels[0]?.maturity).toBe('PENDING');
    expect(labels[0]?.isShakeout).toBeUndefined();
  });

  it('labeler_maturity: 일부 horizon 도달·전 horizon 미충족 → PENDING·isShakeout 미확정', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([makeTrade({ exitPrice: 10000 })]);
    // now 가 청산 직후 5거래일만 경과 → 10d 미도달.
    const partialNow = new Date('2026-06-10T08:00:00.000Z');
    const fetcher = vi.fn().mockResolvedValue(10600);
    const res = await mod.runShakeoutStopForwardLabeler({ now: partialNow, fetcher });
    expect(res.resolvedNow).toBe(0);
    expect(res.pending).toBe(1);
    const [label] = repo.loadLabels();
    expect(label.maturity).toBe('PENDING');
    expect(label.isShakeout).toBeUndefined();
    // 10d 미도달이므로 forwardClose10d 미채움.
    expect(label.forwardClose10d).toBeUndefined();
  });

  it('labeler_origin_immutable: shadow-trades.json 무수정 (별도 repo 만 변경)', async () => {
    process.env[ENV_KEY] = 'true';
    const seed = [makeTrade({ exitPrice: 10000 })];
    shadowRepo.saveShadowTrades(seed);
    const before = JSON.stringify(shadowRepo.loadShadowTrades());
    const fetcher = vi.fn().mockResolvedValue(10600);
    await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher });
    const after = JSON.stringify(shadowRepo.loadShadowTrades());
    expect(after).toBe(before);
    expect(repo.loadLabels()).toHaveLength(1);
  });

  it('labeler_resolved_immutable: RESOLVED 라벨 재방문 skip (불변성)', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([makeTrade({ exitPrice: 10000 })]);
    const fetcher1 = vi.fn().mockResolvedValue(10600);
    await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher: fetcher1 });
    expect(repo.loadLabels()[0].isShakeout).toBe(true);

    // 2차 run — fetcher 가 다른 값을 줘도 RESOLVED 라벨은 불변 (skip).
    const fetcher2 = vi.fn().mockResolvedValue(20000);
    const res2 = await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher: fetcher2 });
    expect(res2.resolvedNow).toBe(0);
    expect(fetcher2).not.toHaveBeenCalled();
    expect(repo.loadLabels()[0].maxRecoveryPct).toBeCloseTo(6, 5);
  });

  it('labeler_target_filter: exitOutcome=BE (본절) 대상 제외', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([
      makeTrade({ id: 'BE1', exitOutcome: 'BE', stopLossExitType: 'PROFIT_PROTECTION' }),
      makeTrade({ id: 'L1', exitOutcome: 'LOSS', exitPrice: 10000 }),
    ]);
    const fetcher = vi.fn().mockResolvedValue(10600);
    const res = await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher });
    expect(res.totalCandidates).toBe(1);
    const labels = repo.loadLabels();
    expect(labels).toHaveLength(1);
    expect(labels[0].tradeId).toBe('L1');
  });

  it('labeler_non_hitstop_excluded: ACTIVE/HIT_TARGET 등 비-HIT_STOP 제외', async () => {
    process.env[ENV_KEY] = 'true';
    shadowRepo.saveShadowTrades([
      makeTrade({ id: 'A1', status: 'ACTIVE', exitTime: undefined, exitOutcome: undefined }),
      makeTrade({ id: 'TT', status: 'HIT_TARGET', exitOutcome: 'WIN', exitPrice: 12000 }),
      makeTrade({ id: 'S1', status: 'HIT_STOP', exitOutcome: 'LOSS', exitPrice: 10000 }),
    ]);
    const fetcher = vi.fn().mockResolvedValue(10600);
    const res = await mod.runShakeoutStopForwardLabeler({ now: NOW, fetcher });
    // HIT_TARGET 은 status≠HIT_STOP 이라 제외, ACTIVE 제외 → 1건.
    expect(res.totalCandidates).toBe(1);
    expect(repo.loadLabels()[0].tradeId).toBe('S1');
  });
});
