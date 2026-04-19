import { describe, it, expect } from 'vitest';
import {
  needsRecovery,
  isReadyForRetry,
  OCO_RECOVERY_MAX_ATTEMPTS,
  OCO_RECOVERY_BACKOFF_MINUTES,
} from '../trading/ocoRecoveryAgent';
import type { OcoOrderPair } from '../trading/ocoCloseLoop';

function makePair(overrides: Partial<OcoOrderPair> = {}): OcoOrderPair {
  return {
    id: 'trade-1',
    stockCode: '005930',
    stockName: '삼성전자',
    quantity: 10,
    entryPrice: 70000,
    stopOrdNo: 'S1', stopPrice: 65000, stopStatus: 'PENDING',
    profitOrdNo: 'P1', profitPrice: 80000, profitStatus: 'PENDING',
    createdAt: new Date().toISOString(),
    pollCount: 0,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('needsRecovery — 복구 대상 판정', () => {
  it('정상 ACTIVE + 양쪽 PENDING — 대상 아님', () => {
    expect(needsRecovery(makePair())).toBe(false);
  });

  it('status=ERROR — 대상', () => {
    expect(needsRecovery(makePair({ status: 'ERROR', stopStatus: 'FAILED', profitStatus: 'FAILED' }))).toBe(true);
  });

  it('ACTIVE + 손절만 FAILED — 대상', () => {
    expect(needsRecovery(makePair({ stopStatus: 'FAILED' }))).toBe(true);
  });

  it('ACTIVE + 익절만 FAILED — 대상', () => {
    expect(needsRecovery(makePair({ profitStatus: 'FAILED' }))).toBe(true);
  });

  it('이미 RECOVERED — 대상 아님 (재시도 차단)', () => {
    const pair = makePair({
      stopStatus: 'FAILED',
      recovery: { attempts: 1, status: 'RECOVERED' },
    });
    expect(needsRecovery(pair)).toBe(false);
  });

  it('이미 FALLBACK_DONE — 대상 아님 (시장가 청산 종료)', () => {
    const pair = makePair({
      status: 'BOTH_CANCELLED',
      recovery: { attempts: 3, status: 'FALLBACK_DONE' },
    });
    expect(needsRecovery(pair)).toBe(false);
  });

  it('STOP_FILLED — 대상 아님 (이미 한쪽 체결로 자연 종결)', () => {
    expect(needsRecovery(makePair({ status: 'STOP_FILLED' }))).toBe(false);
  });
});

describe('isReadyForRetry — 지수 백오프 게이트', () => {
  const T0 = 1_700_000_000_000;

  it('recovery 미존재 — 즉시 가능', () => {
    expect(isReadyForRetry(makePair({ stopStatus: 'FAILED' }), T0)).toBe(true);
  });

  it('attempts=0 — 즉시 가능', () => {
    const pair = makePair({
      stopStatus: 'FAILED',
      recovery: { attempts: 0, status: 'AWAITING' },
    });
    expect(isReadyForRetry(pair, T0)).toBe(true);
  });

  it('attempts=1, 4분 경과 — 아직 미가능 (5분 백오프)', () => {
    const lastAttemptAt = new Date(T0 - 4 * 60_000).toISOString();
    const pair = makePair({
      stopStatus: 'FAILED',
      recovery: { attempts: 1, lastAttemptAt, status: 'AWAITING' },
    });
    expect(isReadyForRetry(pair, T0)).toBe(false);
  });

  it('attempts=1, 5분 경과 — 가능', () => {
    const lastAttemptAt = new Date(T0 - 5 * 60_000).toISOString();
    const pair = makePair({
      stopStatus: 'FAILED',
      recovery: { attempts: 1, lastAttemptAt, status: 'AWAITING' },
    });
    expect(isReadyForRetry(pair, T0)).toBe(true);
  });

  it('attempts=2, 14분 경과 — 아직 미가능 (15분 백오프)', () => {
    const lastAttemptAt = new Date(T0 - 14 * 60_000).toISOString();
    const pair = makePair({
      stopStatus: 'FAILED',
      recovery: { attempts: 2, lastAttemptAt, status: 'AWAITING' },
    });
    expect(isReadyForRetry(pair, T0)).toBe(false);
  });

  it('attempts=2, 15분 경과 — 가능', () => {
    const lastAttemptAt = new Date(T0 - 15 * 60_000).toISOString();
    const pair = makePair({
      stopStatus: 'FAILED',
      recovery: { attempts: 2, lastAttemptAt, status: 'AWAITING' },
    });
    expect(isReadyForRetry(pair, T0)).toBe(true);
  });

  it('attempts=한도 도달 (=MAX) — 항상 가능 (fallback 라운드 진입)', () => {
    const pair = makePair({
      stopStatus: 'FAILED',
      recovery: { attempts: OCO_RECOVERY_MAX_ATTEMPTS, status: 'EXHAUSTED' },
    });
    expect(isReadyForRetry(pair, T0)).toBe(true);
  });
});

describe('OCO_RECOVERY 정책 상수', () => {
  it('최대 시도 3회', () => {
    expect(OCO_RECOVERY_MAX_ATTEMPTS).toBe(3);
  });

  it('백오프 시퀀스 0/5/15분 — 즉시 → 5분 → 15분 → fallback', () => {
    expect(OCO_RECOVERY_BACKOFF_MINUTES).toEqual([0, 5, 15]);
  });
});
