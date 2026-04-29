// @responsibility fomcDayLiquidation.ts 회귀 테스트 (PR-1, ADR-0061)
/**
 * fomcDayLiquidation.test.ts — liquidateAllForFomc 5중 가드 / 활성 포지션 0건 분기 /
 * 다중 SHADOW 청산 / dryRun / reserveSell 실패 흡수 / formatLiquidationResultMessage
 * / attribution 부착 / 사전 경보 함수.
 *
 * vi.mock 으로 외부 의존성 격리:
 *   - placeKisSellOrder (kisClient) — KIS 호출 0건
 *   - reserveSell (exitEngine/helpers) — fill 영속 호출 격리
 *   - sendPrivateAlert (telegramClient) — 텔레그램 발송 격리
 *   - loadShadowTrades / getRemainingQty / appendShadowLog / syncPositionCache /
 *     buildExitAttribution (shadowTradeRepo)
 *   - getEmergencyStop (state)
 *   - addSellOrder (fillMonitor)
 *   - loadMacroState / getLiveRegime
 *   - getFomcProximity / shouldExecuteLiquidationAt 는 vi.mock 으로 분기 강제
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── vi.mock 선언 (호이스팅) ───────────────────────────────────────────────────

vi.mock('../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(),
}));

vi.mock('./exitEngine/helpers/reserveSell.js', () => ({
  reserveSell: vi.fn(),
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendPrivateAlert: vi.fn().mockResolvedValue(undefined),
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../state.js', () => ({
  getEmergencyStop: vi.fn(() => false),
}));

vi.mock('./fillMonitor.js', () => ({
  addSellOrder: vi.fn(),
}));

vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(() => null),
}));

vi.mock('./regimeBridge.js', () => ({
  getLiveRegime: vi.fn(() => 'R2_BULL'),
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn(() => []),
  saveShadowTrades: vi.fn(),
  getRemainingQty: vi.fn((t: { quantity?: number }) => t?.quantity ?? 0),
  appendShadowLog: vi.fn(),
  syncPositionCache: vi.fn(),
  buildExitAttribution: vi.fn((ruleId: string, conditions: string[], regime: string) => ({
    ruleId,
    contributingConditions: conditions,
    regime,
    attachedAt: new Date().toISOString(),
  })),
}));

vi.mock('./fomcCalendar.js', async () => {
  const actual = await vi.importActual<typeof import('./fomcCalendar.js')>('./fomcCalendar.js');
  return {
    ...actual,
    getFomcProximity: vi.fn(() => ({
      phase: 'DAY',
      daysUntil: 0,
      daysAfter: null,
      nextFomcDate: '2026-04-29',
      lastFomcDate: null,
      kellyMultiplier: 0,
      noNewEntry: true,
      hedgeSignal: false,
      description: 'FOMC 발표일',
    })),
    shouldExecuteLiquidationAt: vi.fn(() => ({ execute: true, reason: 'OK' })),
  };
});

// 실 모듈 import — vi.mock 이후
import {
  liquidateAllForFomc,
  formatLiquidationResultMessage,
  runFomcDayMorningAlert,
  runFomcDayPreLiquidationAlert,
} from './fomcDayLiquidation.js';
import { placeKisSellOrder } from '../clients/kisClient.js';
import { reserveSell } from './exitEngine/helpers/reserveSell.js';
import { sendPrivateAlert } from '../alerts/telegramClient.js';
import { addSellOrder } from './fillMonitor.js';
import {
  loadShadowTrades,
  saveShadowTrades,
  buildExitAttribution,
  syncPositionCache,
  appendShadowLog,
} from '../persistence/shadowTradeRepo.js';
import {
  shouldExecuteLiquidationAt,
  getFomcProximity,
} from './fomcCalendar.js';

// ── 픽스처 ────────────────────────────────────────────────────────────────────

function makeMockTrade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-04-29T00:00:00Z',
    signalPrice: 70000,
    shadowEntryPrice: 70000,
    quantity: 10,
    stopLoss: 65000,
    targetPrice: 80000,
    mode: 'SHADOW',
    status: 'ACTIVE',
    fills: [],
    ...overrides,
  };
}

const SAMPLE_DATE_KST = new Date('2026-04-29T05:30:00Z'); // KST 14:30

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 가드 분기 테스트 ──────────────────────────────────────────────────────────

describe('liquidateAllForFomc — 5중 가드 분기 (silent return)', () => {
  it('NOT_DAY_PHASE → executed=false + 결과 빈 배열 + reserveSell 미호출', async () => {
    vi.mocked(shouldExecuteLiquidationAt).mockReturnValueOnce({
      execute: false,
      reason: 'NOT_DAY_PHASE',
    });
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.executed).toBe(false);
    expect(r.guardReason).toBe('NOT_DAY_PHASE');
    expect(r.totalActive).toBe(0);
    expect(r.results).toEqual([]);
    expect(reserveSell).not.toHaveBeenCalled();
    expect(placeKisSellOrder).not.toHaveBeenCalled();
    expect(sendPrivateAlert).not.toHaveBeenCalled();
  });

  it('DISABLED → executed=false', async () => {
    vi.mocked(shouldExecuteLiquidationAt).mockReturnValueOnce({
      execute: false,
      reason: 'DISABLED',
    });
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.guardReason).toBe('DISABLED');
    expect(reserveSell).not.toHaveBeenCalled();
  });

  it('AUTO_TRADE_DISABLED → executed=false', async () => {
    vi.mocked(shouldExecuteLiquidationAt).mockReturnValueOnce({
      execute: false,
      reason: 'AUTO_TRADE_DISABLED',
    });
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.guardReason).toBe('AUTO_TRADE_DISABLED');
  });

  it('EMERGENCY_STOP → executed=false', async () => {
    vi.mocked(shouldExecuteLiquidationAt).mockReturnValueOnce({
      execute: false,
      reason: 'EMERGENCY_STOP',
    });
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.guardReason).toBe('EMERGENCY_STOP');
  });

  it('BEFORE_START_TIME → executed=false (cron 일찍 발동된 race)', async () => {
    vi.mocked(shouldExecuteLiquidationAt).mockReturnValueOnce({
      execute: false,
      reason: 'BEFORE_START_TIME',
    });
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.guardReason).toBe('BEFORE_START_TIME');
  });
});

// ── 활성 포지션 분기 테스트 ───────────────────────────────────────────────────

describe('liquidateAllForFomc — 활성 포지션 처리', () => {
  it('활성 0건 → executed=true + totalActive=0 + 텔레그램 안내 1회 (CRITICAL 아님)', async () => {
    vi.mocked(loadShadowTrades).mockReturnValueOnce([]);
    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.executed).toBe(true);
    expect(r.totalActive).toBe(0);
    expect(r.results).toEqual([]);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(1);
    const args = vi.mocked(sendPrivateAlert).mock.calls[0];
    expect(String(args?.[0])).toContain('활성 포지션 0건');
    // priority 'NORMAL' (활성 0건은 CRITICAL 아님)
    const opts = args?.[1] as { priority?: string } | undefined;
    expect(opts?.priority).toBe('NORMAL');
  });

  it('다중 SHADOW 활성 → reserveSell 각각 호출 + buildExitAttribution 부착 + dispatchAlert 1회 결과', async () => {
    const t1 = makeMockTrade({ id: 't-1', stockCode: '005930', stockName: '삼성', quantity: 10 });
    const t2 = makeMockTrade({ id: 't-2', stockCode: '000660', stockName: '하이닉스', quantity: 5 });
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1, t2] as never);
    vi.mocked(placeKisSellOrder).mockResolvedValue({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' });
    vi.mocked(reserveSell).mockReturnValue({
      kind: 'SHADOW',
      recorded: true,
      remainingQty: 0,
      statusPrefix: '🎭',
      statusSuffix: '',
    } as never);

    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.executed).toBe(true);
    expect(r.totalActive).toBe(2);
    expect(r.successCount).toBe(2);
    expect(r.failedCount).toBe(0);
    expect(reserveSell).toHaveBeenCalledTimes(2);
    expect(placeKisSellOrder).toHaveBeenCalledTimes(2);
    expect(syncPositionCache).toHaveBeenCalledTimes(2);
    expect(addSellOrder).not.toHaveBeenCalled(); // SHADOW 는 LIVE 폴링 등록 미수행
    // attribution 부착 검증
    expect(buildExitAttribution).toHaveBeenCalledWith(
      'FOMC_DAY_LIQUIDATION',
      ['fomc_day_force_close'],
      'R2_BULL',
    );
    // appendShadowLog FOMC_DAY_LIQUIDATION event 부착
    expect(appendShadowLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'FOMC_DAY_LIQUIDATION', regime: 'R2_BULL' }),
    );
    // 결과 알림 1회 (HIGH, 실패 0건이라 CRITICAL 아님)
    expect(sendPrivateAlert).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(sendPrivateAlert).mock.calls[0]?.[1] as { priority?: string } | undefined;
    expect(opts?.priority).toBe('HIGH');
  });

  it('dryRun=true → reserveSell 미호출 + status=SUCCESS + reason=DRY_RUN', async () => {
    const t1 = makeMockTrade();
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1] as never);

    const r = await liquidateAllForFomc(SAMPLE_DATE_KST, { dryRunOverride: true });
    expect(r.dryRun).toBe(true);
    expect(r.successCount).toBe(1);
    expect(r.results[0]).toEqual(
      expect.objectContaining({ status: 'SUCCESS', reason: 'DRY_RUN', qty: 10 }),
    );
    expect(reserveSell).not.toHaveBeenCalled();
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('reserveSell FAILED → 결과 status=FAILED + reason 부착 + CRITICAL 알림', async () => {
    const t1 = makeMockTrade();
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1] as never);
    vi.mocked(placeKisSellOrder).mockResolvedValue({
      ordNo: null,
      placed: false,
      outcome: 'LIVE_FAILED',
      failureReason: 'KIS 토큰 만료',
    });
    vi.mocked(reserveSell).mockReturnValue({
      kind: 'FAILED',
      recorded: false,
      remainingQty: 10,
      statusPrefix: '❌',
      statusSuffix: '',
      reason: 'KIS 토큰 만료',
    } as never);

    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.failedCount).toBe(1);
    expect(r.results[0]?.status).toBe('FAILED');
    expect(r.results[0]?.reason).toBe('KIS 토큰 만료');
    // priority CRITICAL (실패 ≥ 1)
    const opts = vi.mocked(sendPrivateAlert).mock.calls[0]?.[1] as { priority?: string } | undefined;
    expect(opts?.priority).toBe('CRITICAL');
  });

  it('placeKisSellOrder throw → 결과 status=FAILED + reason=Error 메시지', async () => {
    const t1 = makeMockTrade();
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1] as never);
    vi.mocked(placeKisSellOrder).mockRejectedValueOnce(new Error('네트워크 오류'));

    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.failedCount).toBe(1);
    expect(r.results[0]?.status).toBe('FAILED');
    expect(r.results[0]?.reason).toContain('네트워크 오류');
  });

  it('LIVE_ORDERED (kind=PENDING) → addSellOrder 호출 + status=SUCCESS', async () => {
    const t1 = makeMockTrade({ mode: 'LIVE' });
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1] as never);
    vi.mocked(placeKisSellOrder).mockResolvedValue({
      ordNo: 'ODNO-12345',
      placed: true,
      outcome: 'LIVE_ORDERED',
    });
    vi.mocked(reserveSell).mockReturnValue({
      kind: 'PENDING',
      recorded: true,
      remainingQty: 0,
      statusPrefix: '⏳',
      statusSuffix: '',
      ordNo: 'ODNO-12345',
    } as never);

    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    expect(r.successCount).toBe(1);
    expect(r.failedCount).toBe(0);
    expect(addSellOrder).toHaveBeenCalledTimes(1);
    const args = vi.mocked(addSellOrder).mock.calls[0]?.[0] as { ordNo?: string; relatedTradeId?: string };
    expect(args.ordNo).toBe('ODNO-12345');
    expect(args.relatedTradeId).toBe('t-1');
  });
});

// ── ADR-0104 hotfix (2026-04-29): saveShadowTrades 영속화 ────────────────────
// 사용자 보고: 14:30 KST 청산 알림 5건 발송됐지만 /pos /pnl 잔고 그대로.
// 원인: reserveSell 가 in-memory trade.fills 변경했지만 saveShadowTrades 호출
// 부재 → 다음 cron 시 원본 수량 재로드. 본 describe 가 영구 회귀 차단.

describe('liquidateAllForFomc — saveShadowTrades 영속화 (ADR-0104 hotfix)', () => {
  it('SHADOW 청산 후 saveShadowTrades(trades) 호출 — in-memory 변경 디스크 영속', async () => {
    const t1 = makeMockTrade({ id: 't-1', stockCode: '192820' });
    const t2 = makeMockTrade({ id: 't-2', stockCode: '161890' });
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1, t2] as never);
    vi.mocked(placeKisSellOrder).mockResolvedValue({
      ordNo: null,
      placed: false,
      outcome: 'SHADOW_ONLY',
    });
    vi.mocked(reserveSell).mockReturnValue({
      kind: 'SHADOW',
      recorded: true,
      remainingQty: 0,
      statusPrefix: '🎭',
      statusSuffix: '',
    } as never);

    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);

    expect(r.successCount).toBe(2);
    expect(saveShadowTrades).toHaveBeenCalledTimes(1);
    // saveShadowTrades 인자가 loadShadowTrades 결과(=trades 전체)
    const savedTrades = vi.mocked(saveShadowTrades).mock.calls[0]?.[0] as Array<{ id: string }>;
    expect(savedTrades).toHaveLength(2);
    expect(savedTrades[0].id).toBe('t-1');
    expect(savedTrades[1].id).toBe('t-2');
  });

  it('LIVE 청산 후에도 saveShadowTrades 호출 — PROVISIONAL fill 영속', async () => {
    const t1 = makeMockTrade({ mode: 'LIVE' });
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1] as never);
    vi.mocked(placeKisSellOrder).mockResolvedValue({
      ordNo: 'ODNO-99',
      placed: true,
      outcome: 'LIVE_ORDERED',
    });
    vi.mocked(reserveSell).mockReturnValue({
      kind: 'PENDING',
      recorded: true,
      remainingQty: 0,
      statusPrefix: '⏳',
      statusSuffix: '',
      ordNo: 'ODNO-99',
    } as never);

    await liquidateAllForFomc(SAMPLE_DATE_KST);

    expect(saveShadowTrades).toHaveBeenCalledTimes(1);
  });

  it('dryRun=true 시 saveShadowTrades 미호출 — 변경 0건 idempotent 보장', async () => {
    const t1 = makeMockTrade();
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1] as never);

    await liquidateAllForFomc(SAMPLE_DATE_KST, { dryRunOverride: true });

    expect(saveShadowTrades).not.toHaveBeenCalled();
  });

  it('활성 포지션 0건 시 saveShadowTrades 미호출 — 변경 0건 short-circuit', async () => {
    vi.mocked(loadShadowTrades).mockReturnValueOnce([]);

    await liquidateAllForFomc(SAMPLE_DATE_KST);

    expect(saveShadowTrades).not.toHaveBeenCalled();
  });

  it('saveShadowTrades throw 시 catch 후 결과 반환 흐름 유지 — graceful degradation', async () => {
    const t1 = makeMockTrade();
    vi.mocked(loadShadowTrades).mockReturnValueOnce([t1] as never);
    vi.mocked(placeKisSellOrder).mockResolvedValue({
      ordNo: null,
      placed: false,
      outcome: 'SHADOW_ONLY',
    });
    vi.mocked(reserveSell).mockReturnValue({
      kind: 'SHADOW',
      recorded: true,
      remainingQty: 0,
      statusPrefix: '🎭',
      statusSuffix: '',
    } as never);
    vi.mocked(saveShadowTrades).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const r = await liquidateAllForFomc(SAMPLE_DATE_KST);
    // saveShadowTrades 가 throw 해도 결과 객체는 정상 반환 (텔레그램 발송 흐름 보호).
    expect(r.executed).toBe(true);
    expect(r.successCount).toBe(1);
    expect(saveShadowTrades).toHaveBeenCalledTimes(1);
  });
});

// ── 메시지 포맷터 ─────────────────────────────────────────────────────────────

describe('formatLiquidationResultMessage — 분기 (dryRun / 정상 / 실패)', () => {
  it('dryRun=true 메시지는 "🟢 [FOMC DAY 청산 — dryRun]" + "실행 안 됨"', () => {
    const msg = formatLiquidationResultMessage({
      totalActive: 3,
      results: [],
      successCount: 0,
      failedCount: 0,
      dryRun: true,
    });
    expect(msg).toContain('🟢');
    expect(msg).toContain('dryRun');
    expect(msg).toContain('대상: 3건');
    expect(msg).toContain('실행 안 됨');
  });

  it('정상 완료 (실패 0건) → "🔴 [FOMC DAY 청산 완료]" + ⚠️ 미포함', () => {
    const msg = formatLiquidationResultMessage({
      totalActive: 2,
      results: [],
      successCount: 2,
      failedCount: 0,
      dryRun: false,
    });
    expect(msg).toContain('🔴');
    expect(msg).toContain('청산 완료');
    expect(msg).toContain('성공: 2건 / 실패: 0건');
    expect(msg).not.toContain('⚠️');
  });

  it('일부 실패 (failedCount>0) → "일부 실패" 헤더 + "⚠️ 수동 청산 필요" 추가', () => {
    const msg = formatLiquidationResultMessage({
      totalActive: 3,
      results: [],
      successCount: 1,
      failedCount: 2,
      dryRun: false,
    });
    expect(msg).toContain('일부 실패');
    expect(msg).toContain('성공: 1건 / 실패: 2건');
    expect(msg).toContain('⚠️ 실패 종목 수동 청산 필요');
  });
});

// ── 사전 경보 함수 ────────────────────────────────────────────────────────────

describe('runFomcDayMorningAlert / runFomcDayPreLiquidationAlert — DAY phase 게이트', () => {
  it('runFomcDayMorningAlert: DAY phase 면 sendPrivateAlert 1회 + HIGH priority + dedupeKey', async () => {
    vi.mocked(getFomcProximity).mockReturnValueOnce({
      phase: 'DAY',
      daysUntil: 0,
      daysAfter: null,
      nextFomcDate: '2026-04-29',
      lastFomcDate: null,
      kellyMultiplier: 0,
      noNewEntry: true,
      hedgeSignal: false,
      description: '',
    });
    await runFomcDayMorningAlert(SAMPLE_DATE_KST);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(1);
    const args = vi.mocked(sendPrivateAlert).mock.calls[0];
    expect(String(args?.[0])).toContain('FOMC 발표 당일');
    const opts = args?.[1] as { priority?: string; dedupeKey?: string };
    expect(opts.priority).toBe('HIGH');
    expect(opts.dedupeKey).toContain('fomc_day_morning:');
  });

  it('runFomcDayMorningAlert: 비-DAY phase (NORMAL) 이면 미발송', async () => {
    vi.mocked(getFomcProximity).mockReturnValueOnce({
      phase: 'NORMAL',
      daysUntil: null,
      daysAfter: null,
      nextFomcDate: null,
      lastFomcDate: null,
      kellyMultiplier: 1.0,
      noNewEntry: false,
      hedgeSignal: false,
      description: '',
    });
    await runFomcDayMorningAlert(SAMPLE_DATE_KST);
    expect(sendPrivateAlert).not.toHaveBeenCalled();
  });

  it('runFomcDayPreLiquidationAlert: DAY phase + 활성 N건 → 메시지에 카운트 포함', async () => {
    vi.mocked(getFomcProximity).mockReturnValueOnce({
      phase: 'DAY',
      daysUntil: 0,
      daysAfter: null,
      nextFomcDate: '2026-04-29',
      lastFomcDate: null,
      kellyMultiplier: 0,
      noNewEntry: true,
      hedgeSignal: false,
      description: '',
    });
    vi.mocked(loadShadowTrades).mockReturnValueOnce([
      makeMockTrade({ id: 't-a' }),
      makeMockTrade({ id: 't-b', status: 'PARTIALLY_FILLED' }),
      makeMockTrade({ id: 't-c', status: 'HIT_TARGET' }), // closed — 카운트 제외
    ] as never);
    await runFomcDayPreLiquidationAlert(SAMPLE_DATE_KST);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(1);
    const msg = String(vi.mocked(sendPrivateAlert).mock.calls[0]?.[0]);
    expect(msg).toContain('포지션 2건');
    expect(msg).toContain('30분 후');
  });
});
