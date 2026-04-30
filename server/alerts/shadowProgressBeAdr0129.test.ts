/**
 * shadowProgressBeAdr0129.test.ts — ADR-0129 trade 단위 BE 분리 회귀
 *
 * 사용자 4/30 첨부 Image 1 — "WIN 2 / LOSS 8" 중 일부는 BE (PROFIT_PROTECTION).
 * trade 단위 status (HIT_TARGET / HIT_STOP) 와 ADR-0112 exitOutcome 결합 검증.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  _classifyTradeOutcomeForTests,
  _computeProgressFromShadows,
  formatShadowProgress,
} from './shadowProgressBriefing.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

// 최소 fixture
const baseTrade = (overrides: Partial<ServerShadowTrade> & { status: ServerShadowTrade['status']; }): ServerShadowTrade => ({
  id: 't' + Math.random(),
  stockCode: '005930',
  stockName: '삼성전자',
  signalType: 'BUY' as const,
  signalTime: '2026-04-29T01:00:00Z',
  shadowEntryPrice: 70_000,
  stopLoss: 65_000,
  targetPrice: 80_000,
  quantity: 10,
  rrr: 2,
  signalScore: 18,
  conditionKeys: [],
  fills: [],
  ...overrides,
} as ServerShadowTrade);

describe('ADR-0129 classifyTradeOutcome SSOT', () => {
  afterEach(() => {
    delete process.env.BE_CLASSIFICATION_DISABLED;
  });

  it('HIT_TARGET + exitOutcome=BE → BE 카운트 (WIN 아님)', () => {
    const shadows = [
      baseTrade({ status: 'HIT_TARGET', exitOutcome: 'BE' } as any),
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.beCount).toBe(1);
    expect(r.winCount).toBe(0);
    expect(r.lossCount).toBe(0);
  });

  it('HIT_STOP + exitOutcome=BE → BE 카운트 (LOSS 아님) — 사용자 보고 시나리오', () => {
    const shadows = [
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any),
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any),
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.beCount).toBe(2);
    expect(r.lossCount).toBe(0);
  });

  it('HIT_TARGET + exitOutcome=WIN → WIN 카운트', () => {
    const shadows = [
      baseTrade({ status: 'HIT_TARGET', exitOutcome: 'WIN' } as any),
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.winCount).toBe(1);
    expect(r.beCount).toBe(0);
  });

  it('HIT_STOP + exitOutcome=LOSS → LOSS 카운트', () => {
    const shadows = [
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'LOSS' } as any),
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.lossCount).toBe(1);
    expect(r.beCount).toBe(0);
  });

  it('exitOutcome 부재 → status 단독 분기 (legacy 호환)', () => {
    const shadows = [
      baseTrade({ status: 'HIT_TARGET' }), // exitOutcome 미설정
      baseTrade({ status: 'HIT_STOP' }),
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.winCount).toBe(1);
    expect(r.lossCount).toBe(1);
    expect(r.beCount).toBe(0);
  });

  it('BE_CLASSIFICATION_DISABLED=true ENV → legacy fallback (BE 무시)', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'true';
    const shadows = [
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any),
      baseTrade({ status: 'HIT_TARGET', exitOutcome: 'BE' } as any),
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.beCount).toBe(0);
    expect(r.winCount).toBe(1); // HIT_TARGET 그대로 WIN
    expect(r.lossCount).toBe(1); // HIT_STOP 그대로 LOSS
  });

  it('PENDING/ACTIVE 상태 → 모든 카운터 0 영향 없음', () => {
    const shadows = [
      baseTrade({ status: 'PENDING' }),
      baseTrade({ status: 'ACTIVE' }),
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.winCount).toBe(0);
    expect(r.lossCount).toBe(0);
    expect(r.beCount).toBe(0);
  });

  it('사용자 4/30 보고 시나리오 — WIN 2 / LOSS 6 / BE 2', () => {
    const shadows = [
      baseTrade({ status: 'HIT_TARGET' }),                        // WIN 1
      baseTrade({ status: 'HIT_TARGET' }),                        // WIN 2
      baseTrade({ status: 'HIT_STOP' }),                          // LOSS 1
      baseTrade({ status: 'HIT_STOP' }),                          // LOSS 2
      baseTrade({ status: 'HIT_STOP' }),                          // LOSS 3
      baseTrade({ status: 'HIT_STOP' }),                          // LOSS 4
      baseTrade({ status: 'HIT_STOP' }),                          // LOSS 5
      baseTrade({ status: 'HIT_STOP' }),                          // LOSS 6
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any), // BE 1
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any), // BE 2
    ];
    const r = _classifyTradeOutcomeForTests(shadows);
    expect(r.winCount).toBe(2);
    expect(r.lossCount).toBe(6);
    expect(r.beCount).toBe(2);
  });
});

describe('ADR-0129 _computeProgressFromShadows BE wiring', () => {
  it('BE trade 가 totalClosed/winRate 분모에서 제외', () => {
    const shadows = [
      baseTrade({ status: 'HIT_TARGET' }),                        // WIN
      baseTrade({ status: 'HIT_STOP' }),                          // LOSS
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any), // BE
    ];
    const p = _computeProgressFromShadows(shadows, new Date('2026-04-30T07:00:00Z'));
    expect(p.winCount).toBe(1);
    expect(p.lossCount).toBe(1);
    expect(p.beCount).toBe(1);
    expect(p.totalClosed).toBe(2); // BE 제외
    expect(p.winRatePct).toBeCloseTo(50, 5);
  });

  it('beCount 0 시 옵셔널 필드 0', () => {
    const shadows = [baseTrade({ status: 'HIT_TARGET' })];
    const p = _computeProgressFromShadows(shadows, new Date('2026-04-30T07:00:00Z'));
    expect(p.beCount).toBe(0);
  });
});

describe('ADR-0129 formatShadowProgress BE 라인 노출', () => {
  it('beCount > 0 시 ⚪ BE: N건 라인 노출', () => {
    const shadows = [
      baseTrade({ status: 'HIT_TARGET' }),
      baseTrade({ status: 'HIT_STOP' }),
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any),
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any),
    ];
    const p = _computeProgressFromShadows(shadows, new Date('2026-04-30T07:00:00Z'));
    const msg = formatShadowProgress(p);
    expect(msg).toContain('⚪ BE: 2건');
    expect(msg).toContain('✅ WIN: 1건');
    expect(msg).toContain('❌ LOSS: 1건');
  });

  it('beCount=0 시 BE 라인 미노출 (자연 호환)', () => {
    const shadows = [baseTrade({ status: 'HIT_TARGET' })];
    const p = _computeProgressFromShadows(shadows, new Date('2026-04-30T07:00:00Z'));
    const msg = formatShadowProgress(p);
    expect(msg).not.toContain('⚪ BE');
    expect(msg).not.toContain('BE: ');
  });

  it('승률 분모는 BE 제외 — 1WIN / 1LOSS / 2BE → 50% (4건 25% 아님)', () => {
    const shadows = [
      baseTrade({ status: 'HIT_TARGET' }),
      baseTrade({ status: 'HIT_STOP' }),
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any),
      baseTrade({ status: 'HIT_STOP', exitOutcome: 'BE' } as any),
    ];
    const p = _computeProgressFromShadows(shadows, new Date('2026-04-30T07:00:00Z'));
    expect(p.winRatePct).toBeCloseTo(50, 5); // 1/2 = 50% (BE 제외)
    const msg = formatShadowProgress(p);
    expect(msg).toContain('승률 50.0%');
  });
});
