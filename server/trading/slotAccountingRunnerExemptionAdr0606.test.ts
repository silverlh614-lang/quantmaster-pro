/**
 * @responsibility ADR-0606 러너 슬롯 제외 — computeSlotConsumption eligible 필터 ENV 게이트 + runnerCount additive 집계 회귀 테스트
 *
 * 검증 축:
 *   ① exemption ON + isRunner → eligible 제외 (consumed/rawCount 감소, isFull 해제).
 *   ② exemption OFF(기본) → 러너 미제외 — 기존 회계 byte-equivalent.
 *   ③ runnerCount = open 상태 + isRunner 집계 (flag 무관 항상, 표시 전용).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeSlotConsumption } from './slotAccounting.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

// slotAccounting.test.ts 와 동일 패턴 — fills SSOT 명시 (getRemainingQty fills 우선).
function makeShadow(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  const quantity = overrides.quantity ?? 100;
  const originalQuantity = overrides.originalQuantity ?? quantity;
  return {
    id: 't1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-06-12T00:00:00Z',
    signalPrice: 50000,
    shadowEntryPrice: 50000,
    quantity,
    stopLoss: 47000,
    targetPrice: 55000,
    status: 'ACTIVE',
    originalQuantity,
    fills: [
      {
        id: 'f1',
        type: 'BUY',
        qty: originalQuantity,
        price: 50000,
        timestamp: '2026-06-12T00:00:00Z',
        status: 'CONFIRMED',
      },
    ],
    ...overrides,
  } as ServerShadowTrade;
}

const SAVED_KEYS = ['RUNNER_SLOT_EXEMPTION_ENABLED', 'SLOT_CAPITAL_WEIGHTED_DISABLED'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of SAVED_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of SAVED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('computeSlotConsumption — ADR-0606 러너 슬롯 제외 + runnerCount', () => {
  it('exemption ON: open 러너는 eligible 제외 — consumed/rawCount 감소 + detail 미포함 + runnerCount=1', () => {
    process.env.RUNNER_SLOT_EXEMPTION_ENABLED = 'true';
    const runner = makeShadow({ id: 't-run', stockCode: '000001', isRunner: true });
    const normal = makeShadow({ id: 't-norm', stockCode: '000002' });
    const result = computeSlotConsumption([runner, normal], 8);
    expect(result.consumed).toBe(1);
    expect(result.rawCount).toBe(1);
    expect(result.available).toBe(7);
    expect(result.detail).toHaveLength(1);
    expect(result.detail[0].stockCode).toBe('000002');
    expect(result.runnerCount).toBe(1);
  });

  it('exemption OFF(기본): 러너 미제외 — 기존 회계 byte-equivalent + runnerCount 는 항상 집계', () => {
    const runner = makeShadow({ id: 't-run', stockCode: '000001', isRunner: true });
    const normal = makeShadow({ id: 't-norm', stockCode: '000002' });
    const result = computeSlotConsumption([runner, normal], 8);
    expect(result.consumed).toBe(2);
    expect(result.rawCount).toBe(2);
    expect(result.available).toBe(6);
    expect(result.isFull).toBe(false);
    expect(result.runnerCount).toBe(1); // 표시 전용 — 분모/필터 무영향
  });

  it('exemption ON: 만재 8 중 러너 1 → consumed 7, isFull 해제 (신규 진입 가용 인식)', () => {
    process.env.RUNNER_SLOT_EXEMPTION_ENABLED = 'true';
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeShadow({ id: `t${i}`, stockCode: `code${i}`, isRunner: i === 0 ? true : undefined })
    );
    const result = computeSlotConsumption(trades, 8);
    expect(result.consumed).toBe(7);
    expect(result.rawCount).toBe(7);
    expect(result.isFull).toBe(false);
    expect(result.available).toBe(1);
    expect(result.runnerCount).toBe(1);
  });

  it('exemption OFF: 만재 8 중 러너 1 → consumed 8, isFull 유지 (회귀 가드)', () => {
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeShadow({ id: `t${i}`, stockCode: `code${i}`, isRunner: i === 0 ? true : undefined })
    );
    const result = computeSlotConsumption(trades, 8);
    expect(result.consumed).toBe(8);
    expect(result.isFull).toBe(true);
    expect(result.runnerCount).toBe(1);
  });

  it('runnerCount 는 open 상태만 집계 — closed 러너(HIT_TARGET) 제외', () => {
    process.env.RUNNER_SLOT_EXEMPTION_ENABLED = 'true';
    const closedRunner = makeShadow({ id: 't-closed', stockCode: '000003', status: 'HIT_TARGET', isRunner: true });
    const openRunner = makeShadow({ id: 't-open', stockCode: '000004', isRunner: true });
    const result = computeSlotConsumption([closedRunner, openRunner], 8);
    expect(result.runnerCount).toBe(1);
    expect(result.consumed).toBe(0); // open 러너는 exemption 으로 제외, closed 는 status 로 제외
  });

  it('INTRADAY 러너: eligible 은 기존 정책으로 이미 제외, runnerCount(open+isRunner)에는 포함', () => {
    process.env.RUNNER_SLOT_EXEMPTION_ENABLED = 'true';
    const intradayRunner = makeShadow({ id: 't-intra', stockCode: '000005', watchlistSource: 'INTRADAY', isRunner: true });
    const swing = makeShadow({ id: 't-swing', stockCode: '000006' });
    const result = computeSlotConsumption([intradayRunner, swing], 8);
    expect(result.rawCount).toBe(1);
    expect(result.consumed).toBe(1);
    expect(result.runnerCount).toBe(1);
  });

  it('isRunner 미설정/false: exemption ON 이어도 점유 유지 (비러너 무영향)', () => {
    process.env.RUNNER_SLOT_EXEMPTION_ENABLED = 'true';
    const explicitFalse = makeShadow({ id: 't-f', stockCode: '000007', isRunner: false });
    const unset = makeShadow({ id: 't-u', stockCode: '000008' });
    const result = computeSlotConsumption([explicitFalse, unset], 8);
    expect(result.consumed).toBe(2);
    expect(result.rawCount).toBe(2);
    expect(result.runnerCount).toBe(0);
  });

  it('빈 배열: runnerCount=0 (additive 필드 기본값 안전)', () => {
    const result = computeSlotConsumption([], 8);
    expect(result.runnerCount).toBe(0);
    expect(result.consumed).toBe(0);
  });
});
