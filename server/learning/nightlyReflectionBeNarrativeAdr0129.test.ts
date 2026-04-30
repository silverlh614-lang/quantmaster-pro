/**
 * nightlyReflectionBeNarrativeAdr0129.test.ts — ADR-0129 narrative BE 라벨 회귀
 *
 * 사용자 4/30 첨부 Image 2 — "에코프로에이치엔은 '전량손절'로 분류되었음에도
 * 불구하고 3.35%의 수익을 실현하여 전체 일일 P&L을 긍정적으로 마감했습니다."
 *
 * status === 'HIT_STOP' 이지만 fills 가중평균 pct 가 +3.35% (BE 영역 외 양수) →
 * 라벨이 '전량익절' 로 격상되어야 함. 또는 pct 가 -0.5~+1.0 영역이면 '전량본절'.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  summarizeTodaysRealizationsForLearning,
} from './nightlyReflectionEngine.js';
import type { ServerShadowTrade, PositionFill } from '../persistence/shadowTradeRepo.js';

const isoToday = '2026-04-30T07:00:00Z';
const dateKst = '2026-04-30';

const fill = (overrides: { type: 'BUY' | 'SELL'; qty?: number; price?: number; pnl?: number; pnlPct?: number; }): PositionFill => ({
  id: 'f' + Math.random(),
  type: overrides.type,
  qty: overrides.qty ?? 10,
  price: overrides.price ?? 70_000,
  pnl: overrides.pnl ?? 0,
  pnlPct: overrides.pnlPct ?? 0,
  status: 'CONFIRMED',
  timestamp: isoToday,
  confirmedAt: isoToday,
} as PositionFill);

const baseTrade = (overrides: Partial<ServerShadowTrade> & { status: ServerShadowTrade['status']; }): ServerShadowTrade => ({
  id: 't' + Math.random(),
  stockCode: '247540',
  stockName: '에코프로에이치엔',
  signalType: 'BUY' as const,
  signalTime: '2026-04-29T01:00:00Z',
  exitTime: isoToday,
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

// ReflectionInputs 의 모든 필수 필드 충족 (회귀 테스트 격리 — 외부 데이터 미사용)
const buildInputs = (closedTrades: ServerShadowTrade[]): Parameters<typeof summarizeTodaysRealizationsForLearning>[0] => ({
  date: dateKst,
  closedTrades,
  partialRealizationsToday: [],
  attributionToday: [] as never,
  incidentsToday: [] as never,
  missedSignals: [],
  knownSourceIds: new Set<string>(),
  manualExitsToday: [],
} as unknown as Parameters<typeof summarizeTodaysRealizationsForLearning>[0]);

describe('ADR-0129 nightlyReflection narrative BE 라벨', () => {
  afterEach(() => {
    delete process.env.BE_CLASSIFICATION_DISABLED;
  });

  it('사용자 보고 시나리오 — HIT_STOP + fills 가중 +3.35% → 전량익절', () => {
    // 에코프로에이치엔 status=HIT_STOP 이지만 fills 가중평균 +3.35% (BE 영역 외 양수)
    const trade = baseTrade({
      status: 'HIT_STOP',
      fills: [
        fill({ type: 'BUY', qty: 10, price: 70_000 }),
        fill({ type: 'SELL', qty: 10, price: 72_345, pnl: 23_450, pnlPct: 3.35 }),
      ],
    });
    const summary = summarizeTodaysRealizationsForLearning(buildInputs([trade]));
    const label = summary.labels[0];
    expect(label).toContain('전량익절');
    expect(label).not.toContain('전량손절');
    expect(label).toContain('+3.35%');
  });

  it('HIT_STOP + fills 가중 -0.30% (BE 영역) → 전량본절', () => {
    const trade = baseTrade({
      status: 'HIT_STOP',
      fills: [
        fill({ type: 'BUY', qty: 10, price: 70_000 }),
        fill({ type: 'SELL', qty: 10, price: 69_790, pnl: -2_100, pnlPct: -0.30 }),
      ],
    });
    const summary = summarizeTodaysRealizationsForLearning(buildInputs([trade]));
    const label = summary.labels[0];
    expect(label).toContain('전량본절');
    expect(label).not.toContain('전량손절');
    expect(label).not.toContain('전량익절');
  });

  it('HIT_STOP + fills 가중 -7.42% → 전량손절', () => {
    const trade = baseTrade({
      status: 'HIT_STOP',
      fills: [
        fill({ type: 'BUY', qty: 10, price: 70_000 }),
        fill({ type: 'SELL', qty: 10, price: 64_806, pnl: -51_940, pnlPct: -7.42 }),
      ],
    });
    const summary = summarizeTodaysRealizationsForLearning(buildInputs([trade]));
    const label = summary.labels[0];
    expect(label).toContain('전량손절');
    expect(label).not.toContain('전량본절');
  });

  it('HIT_TARGET + fills 가중 +5.00% → 전량익절', () => {
    const trade = baseTrade({
      status: 'HIT_TARGET',
      fills: [
        fill({ type: 'BUY', qty: 10, price: 70_000 }),
        fill({ type: 'SELL', qty: 10, price: 73_500, pnl: 35_000, pnlPct: 5.00 }),
      ],
    });
    const summary = summarizeTodaysRealizationsForLearning(buildInputs([trade]));
    expect(summary.labels[0]).toContain('전량익절');
  });

  it('BE 영역 boundary +0.5% → 전량본절', () => {
    const trade = baseTrade({
      status: 'HIT_STOP',
      fills: [
        fill({ type: 'BUY', qty: 10, price: 70_000 }),
        fill({ type: 'SELL', qty: 10, price: 70_350, pnl: 3_500, pnlPct: 0.5 }),
      ],
    });
    const summary = summarizeTodaysRealizationsForLearning(buildInputs([trade]));
    expect(summary.labels[0]).toContain('전량본절');
  });

  it('BE 영역 +0.99% (boundary 직전) → 전량본절 (보수적 fallback)', () => {
    // ADR-0112: pct >= -0.5 && pct <= 1.0 → BE 보수적 분기
    const trade = baseTrade({
      status: 'HIT_STOP',
      fills: [
        fill({ type: 'BUY', qty: 10, price: 70_000 }),
        fill({ type: 'SELL', qty: 10, price: 70_693, pnl: 6_930, pnlPct: 0.99 }),
      ],
    });
    const summary = summarizeTodaysRealizationsForLearning(buildInputs([trade]));
    expect(summary.labels[0]).toContain('전량본절');
  });

  it('BE_CLASSIFICATION_DISABLED=true ENV → legacy fallback (status 단독)', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'true';
    const trade = baseTrade({
      status: 'HIT_STOP',
      fills: [
        fill({ type: 'BUY', qty: 10, price: 70_000 }),
        fill({ type: 'SELL', qty: 10, price: 72_345, pnl: 23_450, pnlPct: 3.35 }),
      ],
    });
    const summary = summarizeTodaysRealizationsForLearning(buildInputs([trade]));
    expect(summary.labels[0]).toContain('전량손절'); // legacy 동작 — status 단독
  });
});
