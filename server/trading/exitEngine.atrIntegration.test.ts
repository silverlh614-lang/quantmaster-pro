import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

// ─── 모듈 모킹 (exitEngine의 외부 의존성) ─────────────────────────────���──────────

vi.mock('../clients/kisClient.js', () => ({
  fetchCurrentPrice: vi.fn(),
  placeKisSellOrder: vi.fn().mockResolvedValue({ ordNo: null, placed: false }),
}));

// Phase 3-⑨ 도입 이후 exitEngine.updateShadowResults 가 coldstartBootstrap 경로를
// 거쳐 kisStreamClient.subscribeStock 을 참조한다. 테스트에서 WS 구독 부작용을 차단.
vi.mock('../clients/kisStreamClient.js', () => ({
  getRealtimePrice: vi.fn(() => null),
  subscribeStock:   vi.fn(),
}));

vi.mock('./fillMonitor.js', () => ({
  addSellOrder: vi.fn(),
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
  sendPrivateAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../alerts/channelPipeline.js', () => ({
  channelSellSignal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../persistence/shadowTradeRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persistence/shadowTradeRepo.js')>();
  return { ...actual, appendShadowLog: vi.fn() };
});

vi.mock('../persistence/blacklistRepo.js', () => ({
  addToBlacklist: vi.fn(),
}));

vi.mock('./riskManager.js', () => ({
  checkEuphoria: vi.fn().mockReturnValue({ triggered: false, count: 0, signals: [] }),
}));

import { updateShadowResults } from './exitEngine.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';

const mockFetchCurrentPrice = vi.mocked(fetchCurrentPrice);

// ─── 헬퍼: 기본 ACTIVE Shadow 거래 생성 ─────────────────────────���────────────

function makeShadow(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'test-001',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: new Date(Date.now() - 10 * 60_000).toISOString(),
    signalPrice: 50000,
    shadowEntryPrice: 50000,
    quantity: 10,
    stopLoss: 45000,
    initialStopLoss: 45000,
    regimeStopLoss: 45000,
    hardStopLoss: 45000,
    targetPrice: 65000,
    status: 'ACTIVE',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── ATR 동적 손절 갱신 테스트 ─────────────────────────────────────────────────

describe('exitEngine — ATR 동적 손절 갱신', () => {
  it('entryATR14 없는 포지션은 hardStopLoss 변경 없음 (하위 호환)', async () => {
    const shadow = makeShadow(); // entryATR14 미설정
    mockFetchCurrentPrice.mockResolvedValue(52000);

    await updateShadowResults([shadow], 'R2_BULL');

    expect(shadow.hardStopLoss).toBe(45000);
  });

  it('+5% 미만 수익: ATR 기본 손절이 hardStopLoss 미만이면 갱신 없음', async () => {
    // ATR = 1500, R2_BULL → RISK_ON ×2.0
    // 기본 동적 손절 = 50000 - 1500×2.0 = 47000
    // hardStopLoss는 이미 47000 (진입 시 ATR 반영)
    const shadow = makeShadow({
      entryATR14: 1500,
      hardStopLoss: 47000,
      dynamicStopPrice: 47000,
    });
    // 현재가 51000 (+2%) — 트레일링 미활성
    mockFetchCurrentPrice.mockResolvedValue(51000);

    await updateShadowResults([shadow], 'R2_BULL');

    // 기본 동적 손절 47000 ≤ hardStopLoss 47000 → 변경 없음
    expect(shadow.hardStopLoss).toBe(47000);
  });

  it('+5% 수익 시 BEP 보호 활성화 → hardStopLoss 진입가로 상향', async () => {
    const shadow = makeShadow({
      entryATR14: 1500,
      hardStopLoss: 47000,
      dynamicStopPrice: 47000,
    });
    // 현재가 52500 (+5%) → BEP 보호 활성
    // trailingStopPrice = round(50000) = 50000
    mockFetchCurrentPrice.mockResolvedValue(52500);

    await updateShadowResults([shadow], 'R2_BULL');

    // 50000 > 47000 → hardStopLoss 상향
    expect(shadow.hardStopLoss).toBe(50000);
    expect(shadow.dynamicStopPrice).toBe(50000);
  });

  it('+10% 수익 시 Lock-in 활성화 → hardStopLoss +3%로 상향', async () => {
    const shadow = makeShadow({
      entryATR14: 1500,
      hardStopLoss: 47000,
      dynamicStopPrice: 47000,
    });
    // 현재가 55000 (+10%) → +3% Lock-in
    // trailingStopPrice = round(50000 × 1.03) = 51500
    mockFetchCurrentPrice.mockResolvedValue(55000);

    await updateShadowResults([shadow], 'R2_BULL');

    expect(shadow.hardStopLoss).toBe(51500);
    expect(shadow.dynamicStopPrice).toBe(51500);
  });

  it('hardStopLoss는 래칫 — 이전보다 낮은 값으로는 절대 갱신되지 않음', async () => {
    // 이미 BEP 보호로 50000까지 올라간 상태에서 가격이 다시 하락
    const shadow = makeShadow({
      entryATR14: 1500,
      hardStopLoss: 50000, // 이미 BEP 보호로 올라간 상태
      dynamicStopPrice: 50000,
    });
    // 현재가 51000 (+2%) — 트레일링 미활성, 기본 동적 손절 47000
    mockFetchCurrentPrice.mockResolvedValue(51000);

    await updateShadowResults([shadow], 'R2_BULL');

    // 47000 < 50000 → 래칫에 의해 변경 없음
    expect(shadow.hardStopLoss).toBe(50000);
  });

  it('레짐 변경 시 ATR 배수 반영 (CRISIS ×1.0 → 더 타이트한 기본 손절)', async () => {
    // ATR = 1500, R5_CAUTION → CRISIS ×1.0
    // 기본 동적 손절 = 50000 - 1500×1.0 = 48500
    const shadow = makeShadow({
      entryATR14: 1500,
      hardStopLoss: 47000, // RISK_ON 기준으로 설정된 상태
      dynamicStopPrice: 47000,
    });
    // 현재가 50500 (+1%) — 트레일링 미활성
    mockFetchCurrentPrice.mockResolvedValue(50500);

    await updateShadowResults([shadow], 'R5_CAUTION');

    // CRISIS 기본 손절 48500 > 47000 → 상향
    expect(shadow.hardStopLoss).toBe(48500);
    expect(shadow.dynamicStopPrice).toBe(48500);
  });

  it('PROFIT_PROTECTION exit type: ATR 트레일링이 초기/레짐 손절보다 높으면 HIT_STOP 시 PROFIT_PROTECTION', async () => {
    const shadow = makeShadow({
      entryATR14: 1500,
      hardStopLoss: 47000,
      dynamicStopPrice: 47000,
    });

    // 1차 호출: +10% → Lock-in으로 hardStopLoss 51500으로 상향
    mockFetchCurrentPrice.mockResolvedValue(55000);
    await updateShadowResults([shadow], 'R2_BULL');
    expect(shadow.hardStopLoss).toBe(51500);

    // 2차 호출: 가격이 51500 이하로 하락 → HIT_STOP
    mockFetchCurrentPrice.mockResolvedValue(51400);
    await updateShadowResults([shadow], 'R2_BULL');

    expect(shadow.status).toBe('HIT_STOP');
    // hardStopLoss(51500) > initialStopLoss(45000) && > regimeStopLoss(45000)
    // → PROFIT_PROTECTION
    expect(shadow.stopLossExitType).toBe('PROFIT_PROTECTION');
  });

  it('entryATR14 = 0 이면 동적 손절 미적용 (하위 호환)', async () => {
    const shadow = makeShadow({ entryATR14: 0 });
    mockFetchCurrentPrice.mockResolvedValue(52000);

    await updateShadowResults([shadow], 'R2_BULL');

    expect(shadow.hardStopLoss).toBe(45000);
  });
});
