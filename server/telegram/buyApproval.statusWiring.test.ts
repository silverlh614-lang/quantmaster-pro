/**
 * @responsibility buyApproval ADR-0077 wiring 회귀 — USER_APPROVED / BLOCKED 영속 호출 검증
 *
 * 검증:
 *   - signalId 전달 시 buy_approve callback → markUserApproved 호출
 *   - signalId 전달 시 buy_reject callback → markBlocked('USER_REJECT') 호출
 *   - signalId 전달 시 buy_skip callback → 영속 호출 0건 (SKIP 은 상태 전이 없음)
 *   - signalId 미전달 시 영속 호출 0건 (옵셔널 호환)
 *   - markUserApproved throw → callback resolution 차단 안 함 (try/catch 가드)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _markUserApproved = vi.fn();
const _markBlocked = vi.fn();
const _sendTelegramAlert = vi.fn(async () => 999);
const _editMessageText = vi.fn(async () => undefined);
const _answerCallbackQuery = vi.fn(async () => undefined);

vi.mock('../persistence/tradeSignalStatusRepo.js', () => ({
  markUserApproved: _markUserApproved,
  markBlocked: _markBlocked,
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: _sendTelegramAlert,
  answerCallbackQuery: _answerCallbackQuery,
  editMessageText: _editMessageText,
  escapeHtml: (s: string) => s,
}));

vi.mock('../clients/enemyCheckClient.js', () => ({
  formatEnemyCheckSummary: () => '',
}));

beforeEach(() => {
  vi.resetModules();
  _markUserApproved.mockReset();
  _markBlocked.mockReset();
  _sendTelegramAlert.mockReset();
  _sendTelegramAlert.mockResolvedValue(999);
  _editMessageText.mockReset();
  _answerCallbackQuery.mockReset();
});

async function setupApproval(opts: { signalId?: string }) {
  const mod = await import('./buyApproval.js');
  const { requestBuyApproval, handleBuyApprovalCallback } = mod;
  const promise = requestBuyApproval({
    tradeId: 'trade-1',
    stockCode: '005930',
    stockName: '삼성전자',
    currentPrice: 70000,
    quantity: 10,
    stopLoss: 65000,
    targetPrice: 80000,
    mode: 'SHADOW',
    gateScore: 12,
    regime: 'R6_DEFENSE', // 자동 승인 비활성 → 수동 승인 대기
    signalId: opts.signalId,
  });
  // Telegram 메시지가 발송될 시간 기다림 (Promise.resolve micro-task)
  await new Promise(r => setTimeout(r, 5));
  return { promise, handleBuyApprovalCallback };
}

describe('buyApproval ADR-0077 wiring', () => {
  it('signalId 전달 + buy_approve → markUserApproved 호출', async () => {
    const { promise, handleBuyApprovalCallback } = await setupApproval({
      signalId: '2026-04-27T05:00:00Z:005930',
    });
    const handled = await handleBuyApprovalCallback('cb-1', 'buy_approve:trade-1');
    expect(handled).toBe(true);
    await promise; // resolve 보장
    expect(_markUserApproved).toHaveBeenCalledWith({
      id: '2026-04-27T05:00:00Z:005930',
      approvedBy: 'telegram',
    });
    expect(_markBlocked).not.toHaveBeenCalled();
  });

  it('signalId 전달 + buy_reject → markBlocked(USER_REJECT) 호출', async () => {
    const { promise, handleBuyApprovalCallback } = await setupApproval({
      signalId: '2026-04-27T05:00:00Z:005930',
    });
    await handleBuyApprovalCallback('cb-2', 'buy_reject:trade-1');
    await promise;
    expect(_markBlocked).toHaveBeenCalledWith({
      id: '2026-04-27T05:00:00Z:005930',
      gate: 'USER_REJECT',
      reason: '사용자 거부 (텔레그램)',
    });
    expect(_markUserApproved).not.toHaveBeenCalled();
  });

  it('signalId 전달 + buy_skip → 영속 호출 0건 (상태 전이 없음)', async () => {
    const { promise, handleBuyApprovalCallback } = await setupApproval({
      signalId: '2026-04-27T05:00:00Z:005930',
    });
    await handleBuyApprovalCallback('cb-3', 'buy_skip:trade-1');
    await promise;
    expect(_markUserApproved).not.toHaveBeenCalled();
    expect(_markBlocked).not.toHaveBeenCalled();
  });

  it('signalId 미전달 → 영속 호출 0건 (옵셔널 호환)', async () => {
    const { promise, handleBuyApprovalCallback } = await setupApproval({});
    await handleBuyApprovalCallback('cb-4', 'buy_approve:trade-1');
    await promise;
    expect(_markUserApproved).not.toHaveBeenCalled();
    expect(_markBlocked).not.toHaveBeenCalled();
  });

  it('markUserApproved throw → callback resolution 차단 안 함 (try/catch 가드)', async () => {
    _markUserApproved.mockImplementation(() => {
      throw new Error('disk error');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { promise, handleBuyApprovalCallback } = await setupApproval({
      signalId: '2026-04-27T05:00:00Z:005930',
    });
    const handled = await handleBuyApprovalCallback('cb-5', 'buy_approve:trade-1');
    expect(handled).toBe(true);
    const action = await promise; // 정상 resolve
    expect(action).toBe('APPROVE');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
