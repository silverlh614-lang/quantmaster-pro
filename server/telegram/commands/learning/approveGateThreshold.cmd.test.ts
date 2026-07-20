/**
 * approveGateThreshold.cmd.test.ts — Phase L 명령 메타 + 인가 게이트 회귀.
 */
import { describe, it, expect, afterEach } from 'vitest';
import approveGateThreshold, { resolveApproveGatePermission } from './approveGateThreshold.cmd.js';

describe('/approve_gate_threshold — 메타 + 인가', () => {
  afterEach(() => {
    delete process.env.TELEGRAM_ADMIN_USER_IDS;
  });

  it('명령 메타 — LRN·ADMIN·riskLevel 2', () => {
    expect(approveGateThreshold.name).toBe('/approve_gate_threshold');
    expect(approveGateThreshold.category).toBe('LRN');
    expect(approveGateThreshold.visibility).toBe('ADMIN');
    expect(approveGateThreshold.riskLevel).toBe(2);
  });

  it('admin 화이트리스트 미설정 → 전역 chat 게이트 위임(허용)', () => {
    delete process.env.TELEGRAM_ADMIN_USER_IDS;
    expect(resolveApproveGatePermission({ userId: 'anyone' })).toBe(true);
  });

  it('admin 화이트리스트 설정 → 명단만 허용', () => {
    process.env.TELEGRAM_ADMIN_USER_IDS = '111,222';
    expect(resolveApproveGatePermission({ userId: '111' })).toBe(true);
    expect(resolveApproveGatePermission({ userId: '999' })).toBe(false);
    expect(resolveApproveGatePermission({ userId: undefined })).toBe(false);
  });

  it('status 서브커맨드 — 승인분 없어도 안전 렌더(throw 0)', async () => {
    const replies: string[] = [];
    await approveGateThreshold.execute({
      args: ['status'],
      reply: async (m: string) => { replies.push(m); },
    } as never);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('COUNTERFACTURE_GATE_APPLY_ENABLED');
  });
});
