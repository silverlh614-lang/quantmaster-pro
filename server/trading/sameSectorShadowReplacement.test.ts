// @responsibility ADR-0602 Phase 1 회귀 — flag OFF no-op·shadow 전용 교체 집행·LIVE 무접촉·일일 상한·결손 보류.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadModules() {
  const exec = await import('./sameSectorShadowReplacement.js');
  const repo = await import('../persistence/shadowTradeRepo.js');
  const replacement = await import('./tradeReplacement.js');
  return { exec, repo, replacement };
}

// warm-up 1회 — 최초 dynamic import transform 비용이 첫 테스트 timeout 을 소진하지 않도록.
const warmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-warm-'));
beforeAll(async () => {
  const prev = process.env.PERSIST_DATA_DIR;
  process.env.PERSIST_DATA_DIR = warmDir;
  try {
    await loadModules();
  } finally {
    if (prev === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = prev;
    vi.resetModules();
  }
}, 60_000);

describe('sameSectorShadowReplacement (ADR-0602 Phase 1)', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;
  const originalFlag = process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED;
  const originalMax = process.env.TRADE_REPLACEMENT_DAILY_MAX;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED;
    delete process.env.TRADE_REPLACEMENT_DAILY_MAX;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    if (originalFlag === undefined) delete process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED;
    else process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED = originalFlag;
    if (originalMax === undefined) delete process.env.TRADE_REPLACEMENT_DAILY_MAX;
    else process.env.TRADE_REPLACEMENT_DAILY_MAX = originalMax;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function seedHeld(repo: Awaited<ReturnType<typeof loadModules>>['repo'], overrides: Record<string, unknown> = {}) {
    const held = {
      id: 'shadow_1_005930',
      stockCode: '005930',
      stockName: '약자종목',
      signalTime: '2026-06-10T00:30:00.000Z',
      signalPrice: 10_000,
      shadowEntryPrice: 10_000,
      quantity: 10,
      originalQuantity: 10,
      stopLoss: 9_300,
      targetPrice: 11_500,
      status: 'ACTIVE',
      mode: 'SHADOW',
      sector: '반도체장비',
      ...overrides,
    };
    repo.saveShadowTrades([held as never]);
    return held;
  }

  const decision = (gateScore = 5) => ({
    proposed: true,
    targetToExit: {
      stockCode: '005930',
      stockName: '약자종목',
      entryPrice: 10_000,
      currentPrice: 10_100,
      gateScore,
      sector: '반도체장비',
    },
    reason: 'test',
    score: 30,
  });

  const candidate = () => ({
    stockCode: '042700',
    stockName: '강자종목',
    currentPrice: 20_000,
    gateScore: 8,
    sector: '반도체장비',
    targetPrice: 24_000,
    stopLoss: 18_500,
  });

  it('flag OFF(default) → 집행 0 (FLAG_OFF)', async () => {
    const { exec, repo } = await loadModules();
    seedHeld(repo);
    const result = exec.executeSameSectorShadowReplacement({ decision: decision(), candidate: candidate() });
    expect(result.executed).toBe(false);
    expect(result.skipReason).toBe('FLAG_OFF');
    expect(repo.loadShadowTrades()).toHaveLength(1);
  });

  it('flag ON → 약자 SHADOW 전량 청산(SECTOR_REPLACEMENT_EXIT) + 신규 PENDING shadow 생성', async () => {
    process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED = 'true';
    const { exec, repo } = await loadModules();
    seedHeld(repo);
    const result = exec.executeSameSectorShadowReplacement({ decision: decision(), candidate: candidate() });
    expect(result.executed).toBe(true);

    const trades = repo.loadShadowTrades();
    const closed = trades.find((t) => t.stockCode === '005930')!;
    expect(closed.exitRuleTag).toBe('SECTOR_REPLACEMENT_EXIT');
    expect(closed.status).toBe('HIT_TARGET'); // +1.00% → 비음수
    expect(closed.fills?.some((f) => f.type === 'SELL' && f.exitRuleTag === 'SECTOR_REPLACEMENT_EXIT')).toBe(true);

    const opened = trades.find((t) => t.stockCode === '042700')!;
    expect(opened.mode).toBe('SHADOW');
    expect(opened.status).toBe('PENDING');
    // 평가액 재배치: 10주×10,100 = 101,000 → 20,000원 후보 5주.
    expect(opened.quantity).toBe(5);
    expect(opened.entryGateScore).toBe(8);
  });

  it('LIVE trade 무접촉 — mode=LIVE 보유는 교체 대상에서 제외 (불변식 #8)', async () => {
    process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED = 'true';
    const { exec, repo } = await loadModules();
    seedHeld(repo, { mode: 'LIVE' });
    const result = exec.executeSameSectorShadowReplacement({ decision: decision(), candidate: candidate() });
    expect(result.executed).toBe(false);
    expect(result.skipReason).toBe('HELD_SHADOW_NOT_FOUND_OR_LIVE');
    expect(repo.loadShadowTrades()).toHaveLength(1);
  });

  it('일일 상한 — TRADE_REPLACEMENT_DAILY_MAX=1 이면 2번째 집행 차단', async () => {
    process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED = 'true';
    process.env.TRADE_REPLACEMENT_DAILY_MAX = '1';
    const { exec, repo, replacement } = await loadModules();
    seedHeld(repo);
    expect(exec.executeSameSectorShadowReplacement({ decision: decision(), candidate: candidate() }).executed).toBe(true);
    // 2번째 시도 — 쿨다운 영향 제거를 위해 별도 보유/후보로.
    replacement._resetReplacementCooldowns();
    seedHeld(repo, { id: 'shadow_2_000660', stockCode: '000660' });
    const second = exec.executeSameSectorShadowReplacement({
      decision: {
        ...decision(),
        targetToExit: { ...decision().targetToExit!, stockCode: '000660' },
      },
      candidate: { ...candidate(), stockCode: '035420', stockName: '강자2' },
    });
    expect(second.executed).toBe(false);
    expect(second.skipReason).toBe('DAILY_MAX_1');
  });

  it('결손 보류 — 후보 target/stop 부재 시 집행하지 않음 (불변식 #6)', async () => {
    process.env.TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED = 'true';
    const { exec, repo } = await loadModules();
    seedHeld(repo);
    const result = exec.executeSameSectorShadowReplacement({
      decision: decision(),
      candidate: { ...candidate(), targetPrice: undefined, stopLoss: undefined },
    });
    expect(result.executed).toBe(false);
    expect(result.skipReason).toBe('CANDIDATE_PLAN_MISSING');
  });
});
