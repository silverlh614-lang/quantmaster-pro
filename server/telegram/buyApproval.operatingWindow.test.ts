/**
 * @responsibility Patch-SHADOW-OPERATING-WINDOW-GATE — buyApproval SHADOW 카드 운영시간 억제 회귀.
 *
 * 검증:
 *   - SHADOW + operatorWindowOpen=false → 카드 미발송(deliverApprovalRequest 0회) + SKIP 반환
 *     (호출자 buyPipeline 이 executeShadowBuyOrder 미호출 → shadow pos/pnl 미반영)
 *   - SHADOW + operatorWindowOpen=true → 카드 발송 시도 (게이트 비적용)
 *   - SHADOW + operatorWindowOpen 미전달(undefined) → 발송 시도 (후방호환)
 *   - LIVE + operatorWindowOpen=false → 발송 시도 (LIVE 게이트 비적용)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _deliverApprovalRequest = vi.fn();

vi.mock('./approval/approvalDeliveryService.js', () => ({
  deliverApprovalRequest: _deliverApprovalRequest,
}));
vi.mock('../alerts/telegramClient.js', () => ({
  answerCallbackQuery: vi.fn(async () => undefined),
  editMessageText: vi.fn(async () => undefined),
  sendTelegramAlert: vi.fn(async () => 999),
  escapeHtml: (s: string) => s,
}));
vi.mock('../clients/enemyCheckClient.js', () => ({
  formatEnemyCheckSummary: () => '',
  buildPreMortem: (x: unknown) => x,
}));

beforeEach(() => {
  vi.resetModules();
  _deliverApprovalRequest.mockReset();
  // 발송 시도 시 DELIVERY_FAILED → requestBuyApprovalWithDelivery 가 즉시 APPROVE 반환 (테스트 무한 대기 방지).
  _deliverApprovalRequest.mockResolvedValue({ kind: 'DELIVERY_FAILED', reason: 'TEST_NO_HANG' });
});

const base = {
  tradeId: 't1',
  stockCode: '005930',
  stockName: '삼성전자',
  currentPrice: 70_000,
  quantity: 10,
  stopLoss: 65_000,
  targetPrice: 80_000,
  regime: 'R3_EARLY',
  tradeDate: '2026-05-25',
  marketSession: 'CLOSED',
};

describe('buyApproval 운영시간 게이트 (SHADOW 카드 억제)', () => {
  it('SHADOW + operatorWindowOpen=false → 카드 미발송 + SKIP', async () => {
    const { requestBuyApprovalWithDelivery } = await import('./buyApproval.js');
    const res = await requestBuyApprovalWithDelivery({ ...base, mode: 'SHADOW', operatorWindowOpen: false });
    expect(res.action).toBe('SKIP');
    expect(res.telegramDelivered).toBe(false);
    expect(_deliverApprovalRequest).not.toHaveBeenCalled();
  });

  it('SHADOW + operatorWindowOpen=true → 카드 발송 시도', async () => {
    const { requestBuyApprovalWithDelivery } = await import('./buyApproval.js');
    await requestBuyApprovalWithDelivery({ ...base, mode: 'SHADOW', operatorWindowOpen: true });
    expect(_deliverApprovalRequest).toHaveBeenCalledTimes(1);
  });

  it('SHADOW + operatorWindowOpen 미전달 → 발송 시도 (후방호환)', async () => {
    const { requestBuyApprovalWithDelivery } = await import('./buyApproval.js');
    await requestBuyApprovalWithDelivery({ ...base, mode: 'SHADOW' });
    expect(_deliverApprovalRequest).toHaveBeenCalledTimes(1);
  });

  it('LIVE + operatorWindowOpen=false → 발송 시도 (LIVE 게이트 비적용)', async () => {
    const { requestBuyApprovalWithDelivery } = await import('./buyApproval.js');
    await requestBuyApprovalWithDelivery({ ...base, mode: 'LIVE', operatorWindowOpen: false });
    expect(_deliverApprovalRequest).toHaveBeenCalledTimes(1);
  });
});
