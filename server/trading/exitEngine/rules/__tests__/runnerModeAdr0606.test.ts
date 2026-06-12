/**
 * @responsibility ADR-0606 러너 모드 — trancheTakeProfitLimit 승격/전량 트랜치 스킵 + trailingStop 러너 폭 적용 회귀 테스트
 *
 * 검증 축:
 *   ① flag OFF(기본) byte-equivalent — 기존 트랜치 익절/트레일링 전이 무변경, 러너 필드 stamp 0.
 *   ② flag ON 승격 두 사유 — FINAL_TRANCHE_REACHED / RETURN_THRESHOLD.
 *   ③ 잔량 전량(ratio≥0.999) 트랜치 스킵 — 매도 0 · taken 보류 · 잔량 보존 (HIT_TARGET 미도달).
 *   ④ trailingStop trailFloor — runnerTrailPct ?? trailPct ?? 0.10 fallback 체인.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', async () => {
  const actual = await vi.importActual<any>('../../../../clients/kisClient.js');
  return {
    ...actual,
    placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
  };
});
vi.mock('../../../../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../alerts/telegramEventRouter.js', () => ({ emitTelegramEvent: vi.fn(() => Promise.resolve(1)) }));
vi.mock('../../../../alerts/channelPipeline.js', () => ({ channelSellSignal: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    appendShadowLog: vi.fn(),
    syncPositionCache: vi.fn(),
    appendFill: vi.fn((s: any, f: any) => { s.fills = [...(s.fills ?? []), { ...f, id: 'mid' }]; }),
    updateShadow: vi.fn((s: any, p: any) => { Object.assign(s, p); }),
    getRemainingQty: vi.fn((s: any) => s.quantity),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});
vi.mock('../../../fillMonitor.js', () => ({ addSellOrder: vi.fn() }));
vi.mock('../../../tradeEventLog.js', () => ({ appendTradeEvent: vi.fn() }));
// trailingStop FAILED 분기 rollbackFullCloseOnFailure 의 real-fs 플레이크 차단 (기존 패턴).
vi.mock('../../helpers/rollbackFullClose.js', () => ({
  captureFullCloseSnapshot: vi.fn(() => ({ status: 'ACTIVE', quantity: 100 })),
  rollbackFullCloseOnFailure: vi.fn(),
}));

const { trancheTakeProfitLimit } = await import('../trancheTakeProfitLimit.js');
const { trailingStop } = await import('../trailingStop.js');
const { makeMockShadow, makeMockCtx } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { appendShadowLog, updateShadow } = await import('../../../../persistence/shadowTradeRepo.js');

const RUNNER_ENVS = [
  'RUNNER_MODE_ENABLED',
  'RUNNER_SLOT_EXEMPTION_ENABLED',
  'RUNNER_PROMOTE_RETURN_PCT',
  'RUNNER_TRAIL_PCT_BONUS',
  'RUNNER_TRAIL_PCT_FLOOR',
] as const;
const savedEnv: Record<string, string | undefined> = {};

function hasShadowLogEvent(event: string): boolean {
  return vi.mocked(appendShadowLog).mock.calls.some(([entry]: any[]) => entry?.event === event);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of RUNNER_ENVS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of RUNNER_ENVS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('trancheTakeProfitLimit — ADR-0606 러너 승격', () => {
  it('flag OFF: 모든 트랜치 소화 → 기존 trailingEnabled 전이만, 러너 필드 stamp 0 (byte-equivalent)', async () => {
    const shadow = makeMockShadow({
      id: 'RUN-OFF-1', stockCode: '900001',
      quantity: 100, originalQuantity: 100, trailPct: 0.10,
      profitTranches: [{ price: 110, ratio: 0.3, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 115 }));
    expect(shadow.trailingEnabled).toBe(true);
    expect(shadow.trailingHighWaterMark).toBe(115);
    expect(shadow.isRunner).toBeUndefined();
    expect(shadow.runnerActivatedAt).toBeUndefined();
    expect(shadow.runnerTrailPct).toBeUndefined();
    expect(shadow.runnerPromotedReturnPct).toBeUndefined();
    expect(shadow.runnerPromotionReason).toBeUndefined();
    expect(hasShadowLogEvent('TRAILING_ACTIVATED')).toBe(true);
    expect(hasShadowLogEvent('RUNNER_PROMOTED')).toBe(false);
  });

  it('flag OFF: returnPct 30% + 전량(ratio 1.0) 트랜치 → 스킵 없이 기존 매도 실행 (byte-equivalent)', async () => {
    const shadow = makeMockShadow({
      id: 'RUN-OFF-2', stockCode: '900002',
      quantity: 100, originalQuantity: 100,
      profitTranches: [{ price: 110, ratio: 1.0, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 130 }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('900002', '삼성전자', 100, 'TAKE_PROFIT');
    expect(shadow.profitTranches![0].taken).toBe(true);
    expect(shadow.isRunner).toBeUndefined();
  });

  it('flag ON: 모든 LIMIT 트랜치 소화(returnPct<임계) → FINAL_TRANCHE_REACHED 승격 + 필드 5종 + RUNNER_PROMOTED', async () => {
    process.env.RUNNER_MODE_ENABLED = 'true';
    const shadow = makeMockShadow({
      id: 'RUN-ON-1', stockCode: '900003',
      quantity: 100, originalQuantity: 100, trailPct: 0.10,
      profitTranches: [
        { price: 110, ratio: 0.3, taken: true },
        { price: 112, ratio: 0.3, taken: false },
      ],
    });
    // returnPct 15 < 기본 임계 18 → 사유가 RETURN_THRESHOLD 가 아닌 FINAL_TRANCHE_REACHED 임을 보장.
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 115 }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('900003', '삼성전자', 30, 'TAKE_PROFIT');
    expect(shadow.isRunner).toBe(true);
    expect(shadow.runnerPromotionReason).toBe('FINAL_TRANCHE_REACHED');
    expect(shadow.runnerTrailPct).toBeCloseTo(0.15, 10); // max(0.10+0.05, floor 0.15) = 0.15
    expect(shadow.runnerPromotedReturnPct).toBe(15);
    expect(shadow.runnerActivatedAt).toBeTruthy();
    expect(shadow.trailingEnabled).toBe(true);
    expect(shadow.trailingHighWaterMark).toBe(115);
    expect(hasShadowLogEvent('RUNNER_PROMOTED')).toBe(true);
  });

  it('flag ON: returnPct≥18 + 트랜치 미발화 → RETURN_THRESHOLD 조기 승격 + 트레일링 활성화', async () => {
    process.env.RUNNER_MODE_ENABLED = 'true';
    const shadow = makeMockShadow({
      id: 'RUN-ON-2', stockCode: '900004',
      quantity: 70, originalQuantity: 100, trailPct: 0.08,
      profitTranches: [
        { price: 110, ratio: 0.3, taken: true },
        { price: 150, ratio: 0.3, taken: false }, // 미도달 LIMIT
      ],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 120 })); // returnPct 20
    expect(placeKisSellOrder).not.toHaveBeenCalled();
    expect(shadow.isRunner).toBe(true);
    expect(shadow.runnerPromotionReason).toBe('RETURN_THRESHOLD');
    expect(shadow.runnerPromotedReturnPct).toBe(20);
    expect(shadow.runnerTrailPct).toBeCloseTo(0.15, 10); // max(0.08+0.05, 0.15) = 0.15
    expect(shadow.trailingEnabled).toBe(true);
    expect(shadow.trailingHighWaterMark).toBe(120);
    expect(hasShadowLogEvent('RUNNER_PROMOTED')).toBe(true);
  });

  it('flag ON: 전량(ratio 1.0) 트랜치 도달 + returnPct≥18 → 매도 0·taken 보류·잔량 보존 + 승격', async () => {
    process.env.RUNNER_MODE_ENABLED = 'true';
    const shadow = makeMockShadow({
      id: 'RUN-ON-3', stockCode: '900005',
      quantity: 100, originalQuantity: 100, trailPct: 0.10,
      profitTranches: [{ price: 110, ratio: 1.0, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 125 })); // returnPct 25
    expect(placeKisSellOrder).not.toHaveBeenCalled();           // 매도 주문 0
    expect(shadow.profitTranches![0].taken).toBe(false);        // taken 보류
    expect(shadow.quantity).toBe(100);                          // 잔량 보존
    expect(updateShadow).not.toHaveBeenCalled();                // HIT_TARGET 전량 종료 미도달
    expect(shadow.status).toBe('ACTIVE');
    expect(shadow.isRunner).toBe(true);
    expect(shadow.runnerPromotionReason).toBe('RETURN_THRESHOLD');
    expect(shadow.trailingEnabled).toBe(true);
  });

  it('flag ON: 같은 tick 초기 소량 LIMIT(0.3) 익절 실행 + 전량(1.0) 트랜치만 스킵 (혼합)', async () => {
    process.env.RUNNER_MODE_ENABLED = 'true';
    const shadow = makeMockShadow({
      id: 'RUN-ON-4', stockCode: '900006',
      quantity: 100, originalQuantity: 100, trailPct: 0.10,
      profitTranches: [
        { price: 110, ratio: 0.3, taken: false },
        { price: 115, ratio: 1.0, taken: false },
      ],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 120 })); // returnPct 20
    expect(placeKisSellOrder).toHaveBeenCalledTimes(1);
    expect(placeKisSellOrder).toHaveBeenCalledWith('900006', '삼성전자', 30, 'TAKE_PROFIT');
    expect(shadow.profitTranches![0].taken).toBe(true);   // 초기 소량 LIMIT 은 유지(익절)
    expect(shadow.profitTranches![1].taken).toBe(false);  // 전량 트랜치는 스킵
    expect(shadow.isRunner).toBe(true);
    expect(shadow.runnerPromotionReason).toBe('RETURN_THRESHOLD');
  });

  it('flag ON: returnPct<임계 + 트랜치 미소진 → 미승격 (기존 동작 유지)', async () => {
    process.env.RUNNER_MODE_ENABLED = 'true';
    const shadow = makeMockShadow({
      id: 'RUN-ON-5', stockCode: '900007',
      quantity: 100, originalQuantity: 100,
      profitTranches: [{ price: 150, ratio: 0.3, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 115 })); // returnPct 15
    expect(placeKisSellOrder).not.toHaveBeenCalled();
    expect(shadow.isRunner).toBeUndefined();
    expect(shadow.trailingEnabled).toBeUndefined();
    expect(hasShadowLogEvent('RUNNER_PROMOTED')).toBe(false);
  });

  it('flag ON: RUNNER_PROMOTE_RETURN_PCT=25 커스텀 임계 — 20% 미승격 / 26% 승격', async () => {
    process.env.RUNNER_MODE_ENABLED = 'true';
    process.env.RUNNER_PROMOTE_RETURN_PCT = '25';
    const below = makeMockShadow({
      id: 'RUN-ON-6a', stockCode: '900008',
      quantity: 100, originalQuantity: 100,
      profitTranches: [{ price: 150, ratio: 0.3, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow: below, currentPrice: 120 })); // 20%
    expect(below.isRunner).toBeUndefined();

    const above = makeMockShadow({
      id: 'RUN-ON-6b', stockCode: '900009',
      quantity: 100, originalQuantity: 100,
      profitTranches: [{ price: 150, ratio: 0.3, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow: above, currentPrice: 126 })); // 26%
    expect(above.isRunner).toBe(true);
    expect(above.runnerPromotionReason).toBe('RETURN_THRESHOLD');
  });
});

describe('trailingStop — ADR-0606 러너 trailPct 적용', () => {
  it('러너: runnerTrailPct 0.15 우선 — floor 110.5: 111 NO_OP / 110 발동', async () => {
    const base = {
      quantity: 100, trailingEnabled: true, trailingHighWaterMark: 130,
      trailPct: 0.05, runnerTrailPct: 0.15, isRunner: true,
    };
    // 기존 trailPct 0.05 였다면 floor 123.5 → 111 에서 이미 발동했을 것 — runnerTrailPct 우선 증명.
    const noFire = makeMockShadow({ id: 'TR-RUN-1', stockCode: '910001', ...base });
    const r1 = await trailingStop(makeMockCtx({ shadow: noFire, currentPrice: 111 }));
    expect(r1.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();

    const fire = makeMockShadow({ id: 'TR-RUN-2', stockCode: '910002', ...base });
    const r2 = await trailingStop(makeMockCtx({ shadow: fire, currentPrice: 110 }));
    expect(r2.skipRest).toBe(true);
    expect(placeKisSellOrder).toHaveBeenCalledWith('910002', '삼성전자', 100, 'TAKE_PROFIT');
    expect(fire.status).toBe('HIT_TARGET');
    expect(fire.exitRuleTag).toBe('TRAILING_PROTECTIVE_STOP');
  });

  it('비러너: runnerTrailPct 부재 → 기존 trailPct 0.05 경로 (byte-equivalent)', async () => {
    const base = { quantity: 100, trailingEnabled: true, trailingHighWaterMark: 130, trailPct: 0.05 };
    // floor = 130 * 0.95 = 123.5
    const noFire = makeMockShadow({ id: 'TR-LEG-1', stockCode: '910003', ...base });
    await trailingStop(makeMockCtx({ shadow: noFire, currentPrice: 124 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();

    const fire = makeMockShadow({ id: 'TR-LEG-2', stockCode: '910004', ...base });
    await trailingStop(makeMockCtx({ shadow: fire, currentPrice: 123 }));
    expect(placeKisSellOrder).toHaveBeenCalledOnce();
  });

  it('runnerTrailPct·trailPct 모두 부재 → 0.10 default fallback', async () => {
    const base = { quantity: 100, trailingEnabled: true, trailingHighWaterMark: 130 };
    // floor = 130 * 0.90 = 117
    const noFire = makeMockShadow({ id: 'TR-DEF-1', stockCode: '910005', ...base });
    await trailingStop(makeMockCtx({ shadow: noFire, currentPrice: 118 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();

    const fire = makeMockShadow({ id: 'TR-DEF-2', stockCode: '910006', ...base });
    await trailingStop(makeMockCtx({ shadow: fire, currentPrice: 117 }));
    expect(placeKisSellOrder).toHaveBeenCalledOnce();
  });
});
