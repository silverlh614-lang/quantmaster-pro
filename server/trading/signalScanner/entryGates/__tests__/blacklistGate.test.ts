/**
 * @responsibility blacklistGate 단위 테스트 — isBlacklisted 응답 분기
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../persistence/blacklistRepo.js', () => ({
  isBlacklisted: vi.fn(),
}));

const { blacklistGate } = await import('../blacklistGate.js');
const { makeMockCtx, makeMockStock } = await import('./_testHelpers.js');
const { isBlacklisted } = await import('../../../../persistence/blacklistRepo.js');

describe('blacklistGate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('블랙리스트 미등재 → pass=true', () => {
    (isBlacklisted as any).mockReturnValue(false);
    const r = blacklistGate(makeMockCtx());
    expect(r.pass).toBe(true);
  });

  it('블랙리스트 등재 → pass=false + 차단 메시지', () => {
    (isBlacklisted as any).mockReturnValue(true);
    const r = blacklistGate(makeMockCtx());
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('블랙리스트');
      expect(r.logMessage).toContain('진입 차단');
      expect(r.logMessage).toContain('005930');
      expect(r.logMessage).toContain('삼성전자');
    }
  });

  it('isBlacklisted 호출 시 stock.code 정확 전달', () => {
    (isBlacklisted as any).mockReturnValue(false);
    const stock = makeMockStock({ code: '000660', name: 'SK하이닉스' });
    blacklistGate(makeMockCtx({ stock }));
    expect(isBlacklisted).toHaveBeenCalledWith('000660');
  });

  it('차단 시 부수효과 없음 (counter/stageLog/pushTrace 모두 미정의)', () => {
    (isBlacklisted as any).mockReturnValue(true);
    const r = blacklistGate(makeMockCtx());
    if (!r.pass) {
      expect(r.counter).toBeUndefined();
      expect(r.stageLog).toBeUndefined();
      expect(r.pushTrace).toBeUndefined();
    }
  });
});
