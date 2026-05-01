// @responsibility ServerShadowTrade entryConditionScores 영속 schema 회귀 가드 (PR-1, ADR-0006)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

let tmpDir: string;
const _origDataDir = process.env.PERSIST_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-entry-scores-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (_origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = _origDataDir;
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function fresh() {
  // 모듈 캐시 격리 — PERSIST_DATA_DIR 변경 후 paths.ts 재평가.
  const { loadShadowTrades, saveShadowTrades } = await import(
    '../persistence/shadowTradeRepo.ts?t=' + Date.now()
  ).catch(async () => import('../persistence/shadowTradeRepo.js'));
  return { loadShadowTrades, saveShadowTrades };
}

describe('ServerShadowTrade.entryConditionScores schema (PR-1, ADR-0006)', () => {
  it('entryConditionScores 영속 round-trip (27 키 모두)', async () => {
    const { loadShadowTrades, saveShadowTrades } = await fresh();
    const scores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) scores[i] = 5;
    // ADR-0149: schema round-trip 만 검증 — ID 위치는 임의. 의미 매핑은
    // server/learning/conditionMappingFix.test.ts 가 별도 검증.
    scores[9] = 7;  // 클라 ID 9 = notPreviousLeader (임의 HIGH)
    scores[18] = 7; // 클라 ID 18 = turtleBreakout (임의 HIGH)

    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      signalTime: new Date().toISOString(), signalPrice: 100, shadowEntryPrice: 100,
      quantity: 10, stopLoss: 90, targetPrice: 120, status: 'PENDING',
      entryConditionScores: scores,
    };
    saveShadowTrades([trade]);

    const loaded = loadShadowTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].entryConditionScores).toBeDefined();
    expect(Object.keys(loaded[0].entryConditionScores!)).toHaveLength(27);
    expect(loaded[0].entryConditionScores![9]).toBe(7);
    expect(loaded[0].entryConditionScores![18]).toBe(7);
    expect(loaded[0].entryConditionScores![1]).toBe(5);
  });

  it('entryConditionScores 미설정 시 undefined (후방호환)', async () => {
    const { loadShadowTrades, saveShadowTrades } = await fresh();
    const trade: any = {
      id: 't2', stockCode: '000660', stockName: 'SK하이닉스',
      signalTime: new Date().toISOString(), signalPrice: 100, shadowEntryPrice: 100,
      quantity: 5, stopLoss: 90, targetPrice: 120, status: 'PENDING',
      // entryConditionScores 명시 미설정
    };
    saveShadowTrades([trade]);

    const loaded = loadShadowTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].entryConditionScores).toBeUndefined();
  });

  it('빈 entryConditionScores 객체 영속 가능 (옵셔널 — emit*Attribution 가 빈 객체 시 null 반환으로 학습 오염 차단)', async () => {
    const { loadShadowTrades, saveShadowTrades } = await fresh();
    const trade: any = {
      id: 't3', stockCode: '247540', stockName: '에코프로비엠',
      signalTime: new Date().toISOString(), signalPrice: 100, shadowEntryPrice: 100,
      quantity: 5, stopLoss: 90, targetPrice: 120, status: 'PENDING',
      entryConditionScores: {},
    };
    saveShadowTrades([trade]);
    const loaded = loadShadowTrades();
    expect(loaded[0].entryConditionScores).toEqual({});
  });

  it('schema 확장 — 기존 다른 필드 (entryRegime / profileType) 영향 0', async () => {
    const { loadShadowTrades, saveShadowTrades } = await fresh();
    const trade: any = {
      id: 't4', stockCode: '005930', stockName: '삼성전자',
      signalTime: new Date().toISOString(), signalPrice: 100, shadowEntryPrice: 100,
      quantity: 10, stopLoss: 90, targetPrice: 120, status: 'PENDING',
      entryRegime: 'R2_BULL',
      profileType: 'A',
      entryConditionScores: { 9: 7 },
    };
    saveShadowTrades([trade]);
    const loaded = loadShadowTrades();
    expect(loaded[0].entryRegime).toBe('R2_BULL');
    expect(loaded[0].profileType).toBe('A');
    expect(loaded[0].entryConditionScores).toEqual({ 9: 7 });
  });
});
