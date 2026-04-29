// @responsibility channelSellSignal 누적 부분청산 잔량 회귀 (ADR-0092 사용자 보고)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: vi.fn(() => Promise.resolve()),
}));

// channelPipeline 의 isChannelEnabled 는 process.env.CHANNEL_ENABLED='true' 필요
process.env.CHANNEL_ENABLED = 'true';

const { channelSellSignal } = await import('./channelPipeline.js');
const { dispatchAlert } = await import('./alertRouter.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function lastDispatchedMessage(): string {
  const calls = (dispatchAlert as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  if (calls.length === 0) throw new Error('dispatchAlert not called');
  const lastCall = calls[calls.length - 1];
  return String(lastCall[1]);
}

describe('channelSellSignal — 사용자 보고 시나리오 (4주 SK이노베이션 누적 부분청산)', () => {
  it('1차: 50% 청산 (2주/원래 4주, 잔여 2주) → "잔여 보유: 2주"', async () => {
    await channelSellSignal({
      stockName: 'SK이노베이션',
      stockCode: '096770',
      exitPrice: 142400,
      entryPrice: 128986,
      pnlPct: 10.4,
      reason: 'TRANCHE',
      holdingDays: 8,
      soldQty: 2,
      originalQty: 4,
      remainingQtyAfter: 2,
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('[부분청산 50%]');
    expect(msg).toContain('청산 수량: 2주 / 원래 4주');
    expect(msg).toContain('잔여 보유: 2주');
    expect(msg).not.toContain('잔여 보유: 3주'); // 회귀 가드
  });

  it('2차: 25% RRR 붕괴 (1주/원래 4주, 누적 후 잔여 1주) → "잔여 보유: 1주" (이미지 버그 차단)', async () => {
    // 사용자 보고 핵심 — 기존 코드는 "잔여 보유: 3주" 잘못 표기 (4 - 1 = 3)
    // 본 PR 후 — remainingQtyAfter=1 (fills SSOT 누적 반영) 정확히 표기
    await channelSellSignal({
      stockName: 'SK이노베이션',
      stockCode: '096770',
      exitPrice: 144300,
      entryPrice: 128986,
      pnlPct: 11.9,
      reason: 'RRR_COLLAPSE',
      holdingDays: 8,
      soldQty: 1,
      originalQty: 4,
      remainingQtyAfter: 1, // 50% 청산 후 2주 잔여 → RRR 25% 추가 청산 → 1주
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('[부분청산 25%]');
    expect(msg).toContain('잔여 보유: 1주');
    expect(msg).not.toContain('잔여 보유: 3주'); // 사용자 보고 버그 차단
  });

  it('3차: 25% 분할 익절 (1주/원래 4주, 누적 후 잔여 0주) → 부분청산 헤더 X (전량청산)', async () => {
    // 누적 잔여가 0 이면 isPartial=false → 부분청산 라벨 미표기
    await channelSellSignal({
      stockName: 'SK이노베이션',
      stockCode: '096770',
      exitPrice: 145700,
      entryPrice: 128986,
      pnlPct: 13.0,
      reason: 'TRANCHE',
      holdingDays: 8,
      soldQty: 1,
      originalQty: 4,
      remainingQtyAfter: 0,
    });
    const msg = lastDispatchedMessage();
    expect(msg).not.toContain('[부분청산');
    expect(msg).toContain('[청산]');
    expect(msg).not.toContain('잔여 보유'); // 전량청산 시 잔여 라인 제거
  });
});

describe('channelSellSignal — remainingQtyAfter 미명시 후방호환', () => {
  it('remainingQtyAfter 미전달 시 기존 originalQty - soldQty 폴백', async () => {
    await channelSellSignal({
      stockName: 'SK이노베이션',
      stockCode: '096770',
      exitPrice: 142400,
      entryPrice: 128986,
      pnlPct: 10.4,
      reason: 'TRANCHE',
      holdingDays: 8,
      soldQty: 2,
      originalQty: 4,
      // remainingQtyAfter 부재 — 기존 동작 (originalQty - soldQty = 2)
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('잔여 보유: 2주');
  });

  it('soldQty / originalQty / remainingQtyAfter 모두 없으면 전량청산 라벨', async () => {
    await channelSellSignal({
      stockName: 'SK이노베이션',
      stockCode: '096770',
      exitPrice: 145700,
      entryPrice: 128986,
      pnlPct: 13.0,
      reason: 'TARGET',
      holdingDays: 8,
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('[청산]');
    expect(msg).not.toContain('[부분청산');
  });
});

describe('channelSellSignal — remainingQtyAfter 안전 가드', () => {
  it('remainingQtyAfter=NaN 시 후방호환 폴백 사용', async () => {
    await channelSellSignal({
      stockName: 'TEST',
      stockCode: 'X',
      exitPrice: 100,
      entryPrice: 100,
      pnlPct: 0,
      reason: 'STOP',
      holdingDays: 1,
      soldQty: 1,
      originalQty: 4,
      remainingQtyAfter: NaN,
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('잔여 보유: 3주'); // 폴백 (originalQty - soldQty)
  });

  it('remainingQtyAfter=음수 시 후방호환 폴백 사용', async () => {
    await channelSellSignal({
      stockName: 'TEST',
      stockCode: 'X',
      exitPrice: 100,
      entryPrice: 100,
      pnlPct: 0,
      reason: 'STOP',
      holdingDays: 1,
      soldQty: 1,
      originalQty: 4,
      remainingQtyAfter: -1, // 손상 입력
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('잔여 보유: 3주'); // 폴백
  });

  it('remainingQtyAfter=0 + 부분청산 의도 → 전량청산 라벨로 자동 격상', async () => {
    // 누적 잔여 0 = 마지막 회차 = 전량청산. 호출자가 부분청산으로 호출했어도 자연 격상.
    await channelSellSignal({
      stockName: 'TEST',
      stockCode: 'X',
      exitPrice: 150,
      entryPrice: 100,
      pnlPct: 50,
      reason: 'TRANCHE',
      holdingDays: 5,
      soldQty: 1,
      originalQty: 4,
      remainingQtyAfter: 0,
    });
    const msg = lastDispatchedMessage();
    expect(msg).not.toContain('[부분청산');
    expect(msg).toContain('[청산]');
  });
});

describe('channelSellSignal — 5 전량청산 호출자 패턴 (cascadeFinal/trailing/ma60Death/legacyTP/hardStop)', () => {
  it('originalQty 미명시 + remainingQtyAfter=0 → 전량청산', async () => {
    await channelSellSignal({
      stockName: 'TEST',
      stockCode: 'X',
      exitPrice: 90,
      entryPrice: 100,
      pnlPct: -10,
      reason: 'STOP',
      holdingDays: 3,
      remainingQtyAfter: 0,
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('[청산]');
  });

  it('originalQty 미명시 + remainingQtyAfter>0 (LIVE 부분 체결) → 부분청산 자동 격상', async () => {
    // LIVE 모드에서 KIS 가 부분 체결만 응답한 경우 — 자동 부분청산 라벨
    await channelSellSignal({
      stockName: 'TEST',
      stockCode: 'X',
      exitPrice: 90,
      entryPrice: 100,
      pnlPct: -10,
      reason: 'TRAILING',
      holdingDays: 3,
      remainingQtyAfter: 1, // 의도하지 않은 부분 체결
    });
    const msg = lastDispatchedMessage();
    expect(msg).toContain('[부분청산');
    expect(msg).toContain('잔여 보유: 1주');
  });
});
