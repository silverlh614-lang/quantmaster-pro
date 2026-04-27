/**
 * @responsibility 청산 규칙 stdout stockCode 포함 회귀 가드 — 2026-04-27 진단 갭 해소
 *
 * Railway 로그에서 손절 종목 식별을 위해 모든 청산 규칙의 [AutoTrade] stdout 라인이
 * `${stockName} (${stockCode})` 형식으로 stockCode 6자리를 포함해야 한다.
 * 텔레그램에만 종목명, stdout 미노출이라 운영자가 손절 종목 식별 불가능했던 기존 갭 차단.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 공통 mock — 모든 외부 부수효과 격리
vi.mock('../../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
}));
vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
  sendPrivateAlert: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../../alerts/channelPipeline.js', () => ({
  channelSellSignal: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../../alerts/stopLossTransparencyReport.js', () => ({
  sendStopLossTransparencyReport: vi.fn(() => Promise.resolve()),
}));
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
vi.mock('../../../preMortemStructured.js', () => ({
  matchExitInvalidation: vi.fn(() => null),
  promoteInvalidationPatternIfRepeated: vi.fn(),
}));
vi.mock('../../../../learning/kellyDriftFailurePromotion.js', () => ({
  promoteKellyDriftPattern: vi.fn(),
}));
vi.mock('../../../blacklistManager.js', () => ({
  addToBlacklist: vi.fn(),
  isBlacklisted: vi.fn(() => false),
}));

const { hardStopLoss } = await import('../hardStopLoss.js');
const { r6EmergencyExit } = await import('../r6EmergencyExit.js');
const { cascadeFinal } = await import('../cascadeFinal.js');
const { cascadeHalf } = await import('../cascadeHalf.js');
const { trailingStop } = await import('../trailingStop.js');
const { legacyTakeProfit } = await import('../legacyTakeProfit.js');
const { makeMockShadow, makeMockCtx } = await import('./_testHelpers.js');

/**
 * 한 청산 규칙 호출 후 console.log spy 에서 [AutoTrade] 라인을 추출.
 * stockCode 가 stockName 직후 괄호 안에 등장하는지 검증.
 */
function findAutoTradeLogLine(spy: ReturnType<typeof vi.spyOn>): string | undefined {
  return spy.mock.calls
    .map((c: unknown[]) => String(c[0] ?? ''))
    .find((s: string) => s.startsWith('[AutoTrade]'));
}

describe('exitEngine 청산 규칙 stdout stockCode 포함 (2026-04-27 진단 갭)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('hardStopLoss: [AutoTrade] 라인에 (005930) 포함', async () => {
    const shadow = makeMockShadow({ stockCode: '005930', stockName: '삼성전자', quantity: 100 });
    await hardStopLoss(makeMockCtx({
      shadow, currentPrice: 89, hardStopLoss: 90,
      initialStopLoss: 90, regimeStopLoss: 90,
    }));
    const line = findAutoTradeLogLine(logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('삼성전자 (005930)');
    expect(line).toContain('하드 스톱');
  });

  it('r6EmergencyExit: stockCode 포함', async () => {
    const shadow = makeMockShadow({ stockCode: '006490', stockName: '인스코비', quantity: 100 });
    await r6EmergencyExit(makeMockCtx({
      shadow, currentPrice: 95, currentRegime: 'R6_DEFENSE' as any,
    }));
    const line = findAutoTradeLogLine(logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('인스코비 (006490)');
    expect(line).toContain('R6 긴급 청산');
  });

  it('cascadeFinal: stockCode 포함', async () => {
    const shadow = makeMockShadow({ stockCode: '035420', stockName: 'NAVER', quantity: 100 });
    await cascadeFinal(makeMockCtx({
      shadow, currentPrice: 73, returnPct: -27,
    }));
    const line = findAutoTradeLogLine(logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('NAVER (035420)');
    expect(line).toContain('Cascade');
    expect(line).toContain('전량 청산');
  });

  it('cascadeHalf: stockCode 포함', async () => {
    const shadow = makeMockShadow({
      stockCode: '247540', stockName: '에코프로비엠', quantity: 100, cascadeStep: 0,
    });
    await cascadeHalf(makeMockCtx({
      shadow, currentPrice: 84, returnPct: -16,
    }));
    const line = findAutoTradeLogLine(logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('에코프로비엠 (247540)');
    expect(line).toContain('Cascade -15%');
  });

  it('trailingStop: stockCode 포함', async () => {
    const shadow = makeMockShadow({
      stockCode: '373220', stockName: 'LG에너지솔루션', quantity: 100,
      trailingEnabled: true, trailingHighWaterMark: 110, trailPct: 0.10,
    });
    // trailFloor = 110 × 0.90 = 99 → currentPrice 98 ≤ 99 트리거
    await trailingStop(makeMockCtx({
      shadow, currentPrice: 98, returnPct: -2,
    }));
    const line = findAutoTradeLogLine(logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('LG에너지솔루션 (373220)');
    expect(line).toContain('L3 트레일링 스톱');
  });

  it('legacyTakeProfit: stockCode 포함', async () => {
    const shadow = makeMockShadow({
      stockCode: '000660', stockName: 'SK하이닉스', quantity: 100, targetPrice: 120,
    });
    await legacyTakeProfit(makeMockCtx({
      shadow, currentPrice: 121, returnPct: 21,
    }));
    const line = findAutoTradeLogLine(logSpy);
    expect(line).toBeDefined();
    expect(line).toContain('SK하이닉스 (000660)');
    expect(line).toContain('목표가 달성');
  });

  it('회귀 가드: 6 청산 규칙 stdout 형식 일관성 — "stockName (stockCode)" 패턴', async () => {
    const cases: Array<{ run: () => Promise<unknown>; expectedCode: string; expectedName: string }> = [
      {
        run: () => hardStopLoss(makeMockCtx({
          shadow: makeMockShadow({ stockCode: '111111', stockName: 'A종목', quantity: 100 }),
          currentPrice: 89, hardStopLoss: 90,
          initialStopLoss: 90, regimeStopLoss: 90,
        })),
        expectedCode: '111111', expectedName: 'A종목',
      },
      {
        run: () => legacyTakeProfit(makeMockCtx({
          shadow: makeMockShadow({ stockCode: '222222', stockName: 'B종목', quantity: 100, targetPrice: 120 }),
          currentPrice: 121, returnPct: 21,
        })),
        expectedCode: '222222', expectedName: 'B종목',
      },
    ];

    for (const c of cases) {
      logSpy.mockClear();
      await c.run();
      const line = findAutoTradeLogLine(logSpy);
      expect(line).toBeDefined();
      // 형식: "[AutoTrade] <icon> <stockName> (<stockCode>) ..."
      expect(line).toMatch(new RegExp(`${c.expectedName} \\(${c.expectedCode}\\)`));
    }
  });
});
