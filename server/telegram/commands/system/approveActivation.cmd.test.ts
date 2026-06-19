// @responsibility ADR-0636 /approve_activation 게이팅 회귀 — 비-operator 거부·confirm 없으면 무변경·LIVE_ADJACENT_REVIEW confirm 만 승인(영속+env). CH4 통지 mock·env 격리.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// CH4 통지 + 영속 record — 네트워크/디스크 회피 위해 mock (호출 인자만 검증).
const { sendTelegramAlert, recordApproval } = vi.hoisted(() => ({
  sendTelegramAlert: vi.fn(async () => 1),
  recordApproval: vi.fn(() => ({ approvedAt: new Date().toISOString(), approvedBy: 'mock' })),
}));
vi.mock('../../../alerts/telegramClient.js', () => ({ sendTelegramAlert }));
vi.mock('../../../persistence/autoActivationApprovalRepo.js', () => ({ recordApproval }));

import approveActivation from './approveActivation.cmd.js';
import type { CommandContext } from '../_types.js';

const T2_ENV = 'R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED';
const T2_ID = 'R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592';
const OP_KEYS = ['TELEGRAM_OPERATOR_USER_IDS', 'TELEGRAM_ADMIN_USER_IDS', 'TELEGRAM_CHAT_ID'];

function makeCtx(
  args: string[],
  userId?: string,
  chatId?: string,
): { ctx: CommandContext; replies: string[] } {
  const replies: string[] = [];
  const ctx: CommandContext = {
    args,
    userId,
    chatId,
    reply: async (m: string) => {
      replies.push(m);
    },
  };
  return { ctx, replies };
}

beforeEach(() => {
  sendTelegramAlert.mockClear();
  recordApproval.mockClear();
  for (const k of OP_KEYS) delete process.env[k];
  delete process.env[T2_ENV];
});

afterEach(() => {
  for (const k of OP_KEYS) delete process.env[k];
  delete process.env[T2_ENV];
});

describe('/approve_activation — metadata', () => {
  it('riskLevel 2, ADMIN, LRN', () => {
    expect(approveActivation.name).toBe('/approve_activation');
    expect(approveActivation.riskLevel).toBe(2);
    expect(approveActivation.visibility).toBe('ADMIN');
    expect(approveActivation.category).toBe('LRN');
  });
});

describe('/approve_activation — operator 게이팅', () => {
  it('allowlist 설정 + 비-operator userId → UNAUTHORIZED, mutate 0', async () => {
    process.env.TELEGRAM_OPERATOR_USER_IDS = '111';
    const { ctx, replies } = makeCtx([T2_ID, 'confirm'], '999');
    await approveActivation.execute(ctx);
    expect(replies[0]).toContain('UNAUTHORIZED_ACTIVATION_ACTION');
    expect(process.env[T2_ENV]).toBeUndefined();
    expect(recordApproval).not.toHaveBeenCalled();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('allowlist 설정 + operator userId → 인가 통과', async () => {
    process.env.TELEGRAM_OPERATOR_USER_IDS = '111';
    const { ctx, replies } = makeCtx([T2_ID, 'confirm'], '111');
    await approveActivation.execute(ctx);
    expect(replies[0]).not.toContain('UNAUTHORIZED');
    expect(process.env[T2_ENV]).toBe('true');
  });

  it('allowlist 미설정 + 소유자 chat + 숫자 userId → 인가 통과 (ADR-0636 addendum)', async () => {
    process.env.TELEGRAM_CHAT_ID = '555';
    const { ctx, replies } = makeCtx([T2_ID, 'confirm'], '123456789', '555');
    await approveActivation.execute(ctx);
    expect(replies[0]).not.toContain('UNAUTHORIZED');
    expect(replies[0]).toContain('verdict: APPROVED');
    expect(process.env[T2_ENV]).toBe('true');
  });

  it('allowlist 미설정 + 비-소유자 chat + 숫자 userId → UNAUTHORIZED, mutate 0', async () => {
    process.env.TELEGRAM_CHAT_ID = '555';
    const { ctx, replies } = makeCtx([T2_ID, 'confirm'], '123456789', '111');
    await approveActivation.execute(ctx);
    expect(replies[0]).toContain('UNAUTHORIZED_ACTIVATION_ACTION');
    expect(process.env[T2_ENV]).toBeUndefined();
    expect(recordApproval).not.toHaveBeenCalled();
  });
});

describe('/approve_activation — confirm 게이팅', () => {
  it('confirm 없으면 → evidence/확인요청만, env 무접촉·record 0·통지 0', async () => {
    const { ctx, replies } = makeCtx([T2_ID], 'operator');
    await approveActivation.execute(ctx);
    expect(replies[0]).toContain('확인 필요');
    expect(replies[0]).toContain('mutation=false');
    expect(process.env[T2_ENV]).toBeUndefined();
    expect(recordApproval).not.toHaveBeenCalled();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('T2 confirm → APPROVED, env=true, recordApproval 호출, CH4 통지', async () => {
    const { ctx, replies } = makeCtx([T2_ID, 'confirm'], 'operator');
    await approveActivation.execute(ctx);
    expect(replies[0]).toContain('완료');
    expect(replies[0]).toContain('verdict: APPROVED');
    expect(process.env[T2_ENV]).toBe('true');
    expect(recordApproval).toHaveBeenCalledWith(T2_ID, 'operator');
    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
    const opts = (sendTelegramAlert.mock.calls[0] as unknown[])[1] as {
      executionImpact?: string;
      dedupeKey?: string;
    };
    expect(opts.executionImpact).toBe('NONE');
    expect(opts.dedupeKey).toContain('operator_activation:APPROVED');
  });

  it('LIVE_SAFE confirm → 거부(REJECTED_NOT_REVIEWABLE), env·record·통지 0', async () => {
    const { ctx, replies } = makeCtx(['PRICE_CORRECTION_SHADOW_ADR0623', 'confirm'], 'operator');
    await approveActivation.execute(ctx);
    expect(replies[0]).toContain('거부');
    expect(replies[0]).toContain('REJECTED_NOT_REVIEWABLE');
    expect(process.env.PRICE_CORRECTION_SHADOW_ENABLED).toBeUndefined();
    expect(recordApproval).not.toHaveBeenCalled();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });
});