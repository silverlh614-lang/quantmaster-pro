import { describe, expect, it } from 'vitest';

import type { TelegramPositionEntry, PnlSourceSnapshot } from './shadowPositionSources.js';
import { renderPnlSummary, renderPositionLine } from './positionOutputFormatters.js';
import {
  attachDualPositionDisplay,
  buildPositionDisplayTags,
  formatPriceSourceTag,
} from '../../positionDisplayTags.js';

function entry(overrides: Partial<TelegramPositionEntry> = {}): TelegramPositionEntry {
  const base: TelegramPositionEntry = {
    source: 'ShadowPositionLedger',
    positionKind: 'SHADOW',
    accountKind: 'VIRTUAL_SHADOW',
    origin: 'SHADOW_POSITION_LEDGER',
    engineMode: 'SHADOW_ONLY',
    effectiveRegime: 'R6_DEFENSE',
    entrySource: 'SHADOW_BUY_SIGNAL',
    priceSource: 'KIS',
    pnlKind: 'VIRTUAL_UNREALIZED',
    liveOrderSent: false,
    executionImpact: 'NONE',
    sizingSource: 'LIVE_SIZING_MIRROR',
    displayTags: [],
    tradeId: 't1',
    stockCode: '017670',
    stockName: 'SK텔레콤',
    qty: 1,
    entryPrice: 99700,
    currentPrice: 100500,
    currentPriceSource: 'KIS_REST',
    unrealizedPnl: 800,
    unrealizedPct: 0.802,
    rMultiple: 0.11,
    status: 'ACTIVE',
  };
  const merged = { ...base, ...overrides };
  merged.displayTags = overrides.displayTags ?? buildPositionDisplayTags(merged);
  return merged;
}

describe('Position display tags', () => {
  it('ShadowPositionLedger 포지션은 SHADOW 태그와 Virtual Shadow 계좌를 표시한다', () => {
    const text = renderPositionLine(entry(), 3);
    expect(text).toContain('[SHADOW');
    expect(text).toContain('계좌: Virtual Shadow');
    expect(text).toContain('source: ShadowPositionLedger');
    expect(text).toContain('executionImpact: NONE');
  });

  it('KIS live holding 포지션은 LIVE 태그를 표시한다', () => {
    const live = entry({
      source: 'KISLiveHolding',
      positionKind: 'LIVE',
      accountKind: 'KIS_LIVE',
      origin: 'KIS_HOLDING',
      engineMode: 'NORMAL',
      effectiveRegime: 'NORMAL',
      entrySource: 'KIS_HOLDING',
      pnlKind: 'UNREALIZED_LIVE',
      liveOrderSent: true,
      executionImpact: 'LIVE_POSITION',
    });
    const text = renderPositionLine(live, 0);
    expect(text).toContain('[LIVE · 실주문]');
    expect(text).toContain('계좌: KIS Live');
  });

  it('R6 counterfactual 포지션은 SHADOW · R6_COUNTERFACTUAL · 실주문없음으로 표시한다', () => {
    const r6 = entry({
      entrySource: 'R6_COUNTERFACTUAL_BUY',
      effectiveRegime: 'R6_DEFENSE',
    });
    const text = renderPositionLine(r6, 0);
    expect(text).toContain('[SHADOW · R6_DEFENSE · R6_COUNTERFACTUAL · 실주문없음]');
    expect(text).toContain('sizingSource: LIVE_SIZING_MIRROR');
    expect(text).toContain('[가상손익]');
  });

  it('priceSource=KIS이면 현재가 옆에 KIS_PRICE가 표시된다', () => {
    expect(renderPositionLine(entry({ priceSource: 'KIS' }), 0)).toContain('현재가: 100,500원 (KIS_PRICE)');
  });

  it('priceSource=STALE이면 STALE_PRICE와 지연 경고가 표시된다', () => {
    const text = renderPositionLine(entry({
      priceSource: 'STALE',
      priceAgeSeconds: 45,
    }), 0);
    expect(text).toContain('STALE_PRICE, 45초 전');
    expect(text).toContain('현재가 지연 가능');
  });

  it('/pnl에서 Live 손익과 Shadow 손익을 합산 표시하지 않는다', () => {
    const snapshot: PnlSourceSnapshot = {
      mode: {
        modeLabel: 'SHADOW_ONLY',
        liveTradingEnabled: false,
        paperTradingEnabled: true,
        shadowLearningEnabled: true,
        marketState: null,
      },
      account: null,
      openTrades: [],
      closedTrades: [],
      counts: {
        shadowRealizedCount: 1,
        shadowOpenCount: 1,
        virtualAccountAvailable: true,
        paperLedgerCount: 0,
        livePnlSkipped: true,
        totalPnl: -82776,
      },
      pnl: {
        realizedPnl: 12300,
        unrealizedPnl: -82776,
        todayPnl: 0,
        cumulativePnl: -70476,
        liveRealizedPnl: 0,
        liveUnrealizedPnl: 0,
        shadowRealizedPnl: 12300,
        shadowUnrealizedPnl: -82776,
        shadowTodayPnl: 0,
        virtualCash: 99632397,
        virtualTotalAssets: 101858247,
        closedTradeCount: 1,
      },
    };
    const text = renderPnlSummary(snapshot);
    expect(text).toContain('[LIVE] 실계좌 손익: 0원');
    expect(text).toContain('[SHADOW] 가상 미실현손익: -82,776원');
    expect(text).toContain('[SHADOW] 가상 실현손익: +12,300원');
    expect(text).toContain('Live 손익과 Shadow 손익은 하나의 총손익으로 합산하지 않습니다.');
  });

  it('같은 종목이 Live와 Shadow에 동시에 있으면 DUAL 태그를 표시한다', () => {
    const [shadow, live] = attachDualPositionDisplay([
      entry({ stockCode: '005930', positionKind: 'SHADOW', qty: 3 }),
      entry({
        stockCode: '005930',
        source: 'KISLiveHolding',
        positionKind: 'LIVE',
        accountKind: 'KIS_LIVE',
        origin: 'KIS_HOLDING',
        pnlKind: 'UNREALIZED_LIVE',
        liveOrderSent: true,
        executionImpact: 'LIVE_POSITION',
        qty: 10,
      }),
    ]);
    expect(shadow.displayTags).toEqual(['DUAL: LIVE+SHADOW']);
    expect(renderPositionLine(live, 0)).toContain('[DUAL: LIVE+SHADOW]');
    expect(renderPositionLine(live, 0)).toContain('Live 수량: 10');
    expect(renderPositionLine(live, 0)).toContain('Shadow 수량: 3');
  });

  it('SHADOW_ONLY 모드에서는 Shadow 포지션에 liveOrderSent=false와 executionImpact=NONE이 표시된다', () => {
    const text = renderPositionLine(entry({
      engineMode: 'SHADOW_ONLY',
      liveOrderSent: false,
      executionImpact: 'NONE',
    }), 0);
    expect(text).toContain('liveOrderSent: false');
    expect(text).toContain('executionImpact: NONE');
  });

  it('price source helper formats CACHE age without hiding the source', () => {
    expect(formatPriceSourceTag('CACHE', 45)).toBe('CACHE_PRICE, 45초 전');
  });
});
