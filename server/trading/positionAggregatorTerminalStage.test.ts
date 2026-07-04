// @responsibility positionAggregator terminal 스냅샷 stage 정렬 + 승률 분모 회귀 (2026-07-04 Position Truth 발산 인시던트).

import { describe, expect, it, vi, beforeEach } from 'vitest';

// 영속 밀폐 — 실 data/ 접근 0. loadShadowTrades / SHADOW_LOG_FILE(fs) 모두 mock.
const loadShadowTradesMock = vi.fn<() => any[]>(() => []);
vi.mock('../persistence/shadowTradeRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persistence/shadowTradeRepo.js')>();
  return { ...actual, loadShadowTrades: () => loadShadowTradesMock() };
});

let shadowLogRows: any[] = [];
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: unknown) =>
        String(p).endsWith('shadow-log.json') ? true : actual.existsSync(p as any),
      readFileSync: (p: unknown, enc?: unknown) =>
        String(p).endsWith('shadow-log.json')
          ? JSON.stringify(shadowLogRows)
          : (actual.readFileSync as any)(p, enc),
    },
  };
});

import {
  aggregateAllPositions,
  computePositionStats,
} from './positionAggregator.js';
import { detectPositionTruthDivergence } from '../persistence/positionTruth.js';

const snap = (over: Record<string, unknown>) => ({
  id: 'pos-1',
  stockCode: '000850',
  stockName: '화천기공',
  status: 'ACTIVE',
  quantity: 10,
  originalQuantity: 10,
  shadowEntryPrice: 10_000,
  signalTime: '2026-07-01T00:30:00.000Z',
  mode: 'SHADOW',
  fills: [],
  ...over,
});

const entryLog = (id: string, code = '000850') => ({
  id,
  event: 'SHADOW_ENTRY',
  stockCode: code,
  stockName: '테스트',
  quantity: 10,
  originalQuantity: 10,
  shadowEntryPrice: 10_000,
  signalTime: '2026-07-01T00:30:00.000Z',
  ts: '2026-07-01T00:30:00.000Z',
  mode: 'SHADOW',
});

beforeEach(() => {
  loadShadowTradesMock.mockReset().mockReturnValue([]);
  shadowLogRows = [];
});

describe('snapshotOnlyStage — terminal(비-open) status 전부 CLOSED', () => {
  it('스냅샷만 있는 REJECTED → stage CLOSED (활성 집계 제외)', () => {
    loadShadowTradesMock.mockReturnValue([snap({ id: 'r1', status: 'REJECTED' })]);
    const all = aggregateAllPositions();
    expect(all).toHaveLength(1);
    expect(all[0].stage).toBe('CLOSED');
  });

  it('QUARANTINED_BAD_ENTRY / INCONSISTENT 도 CLOSED', () => {
    loadShadowTradesMock.mockReturnValue([
      snap({ id: 'q1', status: 'QUARANTINED_BAD_ENTRY' }),
      snap({ id: 'q2', stockCode: '001450', status: 'INCONSISTENT' }),
    ]);
    const stages = aggregateAllPositions().map((s) => s.stage);
    expect(stages).toEqual(['CLOSED', 'CLOSED']);
  });

  it('open status(ACTIVE/PENDING) 스냅샷은 ENTRY 유지 — 무회귀', () => {
    loadShadowTradesMock.mockReturnValue([
      snap({ id: 'a1', status: 'ACTIVE' }),
      snap({ id: 'p1', stockCode: '001450', status: 'PENDING' }),
    ]);
    const stages = aggregateAllPositions().map((s) => s.stage);
    expect(stages).toEqual(['ENTRY', 'ENTRY']);
  });
});

describe('이벤트 존재 + terminal 스냅샷 — 표시 stage 정렬', () => {
  it('REJECTED 스냅샷 + entry 이벤트(SELL 없음) → CLOSED + integrity 사유 기록', () => {
    loadShadowTradesMock.mockReturnValue([snap({ id: 'r2', status: 'REJECTED' })]);
    shadowLogRows = [entryLog('r2')];
    const all = aggregateAllPositions();
    expect(all).toHaveLength(1);
    expect(all[0].stage).toBe('CLOSED');
    expect(all[0].integrityIssues.join(' ')).toMatch(/terminal status\(REJECTED\)/);
  });

  it('ACTIVE 스냅샷 + entry 이벤트 → ENTRY 유지 (byte-identical 무회귀)', () => {
    loadShadowTradesMock.mockReturnValue([snap({ id: 'a2', status: 'ACTIVE' })]);
    shadowLogRows = [entryLog('a2')];
    const all = aggregateAllPositions();
    expect(all[0].stage).toBe('ENTRY');
    expect(all[0].integrityIssues).toHaveLength(0);
  });

  it('HIT_TARGET + 전량 SELL 이벤트 → 기존 CLOSED 경로 무회귀 (정렬 사유 미기록)', () => {
    loadShadowTradesMock.mockReturnValue([snap({ id: 'h1', status: 'HIT_TARGET' })]);
    shadowLogRows = [
      entryLog('h1'),
      {
        id: 'h1',
        event: 'HIT_TARGET',
        stockCode: '000850',
        quantity: 10,
        sellPrice: 11_000,
        returnPct: 10,
        ts: '2026-07-02T05:00:00.000Z',
      },
    ];
    const all = aggregateAllPositions();
    expect(all[0].stage).toBe('CLOSED');
    expect(all[0].integrityIssues.join(' ')).not.toMatch(/terminal status/);
  });
});

describe('positionTruth 발산 수렴 + 승률 분모', () => {
  it('REJECTED 잔존 시나리오 — (a)=open 1 vs (b)=active 1 로 수렴 (divergent=false)', () => {
    loadShadowTradesMock.mockReturnValue([
      snap({ id: 'a3', status: 'ACTIVE' }),
      snap({ id: 'r3', stockCode: '001450', status: 'REJECTED' }),
      snap({ id: 'r4', stockCode: '207940', status: 'REJECTED' }),
    ]);
    shadowLogRows = [entryLog('r3', '001450'), entryLog('r4', '207940')];
    const report = detectPositionTruthDivergence();
    expect(report.shadowOpenCount).toBe(1);
    expect(report.aggregateActiveCount).toBe(1);
    expect(report.divergent).toBe(false);
    expect(report.divergentStockCodes).toEqual([]);
  });

  it('승률/평균수익 분모는 체결 실적(realizedQty>0) 종결만 — REJECTED 희석 차단', () => {
    loadShadowTradesMock.mockReturnValue([
      snap({ id: 'w1', status: 'HIT_TARGET' }),
      snap({ id: 'r5', stockCode: '001450', status: 'REJECTED' }),
    ]);
    shadowLogRows = [
      entryLog('w1'),
      {
        id: 'w1',
        event: 'HIT_TARGET',
        stockCode: '000850',
        quantity: 10,
        sellPrice: 11_000,
        returnPct: 10,
        ts: '2026-07-02T05:00:00.000Z',
      },
    ];
    const stats = computePositionStats(aggregateAllPositions());
    expect(stats.closedPositions).toBe(2); // 종결 카운트에는 REJECTED 포함
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBe(100); // 분모 1 (REJECTED 미희석 — 기존이면 50%)
    expect(stats.activePositions).toBe(0);
  });
});
