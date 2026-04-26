/**
 * @responsibility portfolioRiskGate 단위 테스트 — 차단 / 경고 / 통과 3 분기
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../portfolioRiskEngine.js', () => ({
  evaluatePortfolioRisk: vi.fn(),
}));

const { portfolioRiskGate } = await import('../portfolioRiskGate.js');
const { makeMockCtx, makeMockStock } = await import('./_testHelpers.js');
const { evaluatePortfolioRisk } = await import('../../../portfolioRiskEngine.js');

describe('portfolioRiskGate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('entryAllowed=true + warnings 빈 → 조용히 pass', async () => {
    (evaluatePortfolioRisk as any).mockResolvedValue({
      entryAllowed: true, blockReasons: [], warnings: [],
    });
    const r = await portfolioRiskGate(makeMockCtx());
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passWarnMessage).toBeUndefined();
      expect(r.passLogMessage).toBeUndefined();
    }
  });

  it('entryAllowed=false → 차단 + stageLog.portfolioRisk + pushTrace', async () => {
    (evaluatePortfolioRisk as any).mockResolvedValue({
      entryAllowed: false,
      blockReasons: ['섹터 45%', '베타 1.8'],
      warnings: [],
    });
    const r = await portfolioRiskGate(makeMockCtx({ stock: makeMockStock({ name: '삼성전자' }) }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('PortfolioRisk');
      expect(r.logMessage).toContain('삼성전자');
      expect(r.logMessage).toContain('섹터 45%');
      expect(r.logMessage).toContain('베타 1.8');
      expect(r.stageLog?.key).toBe('portfolioRisk');
      expect(r.stageLog?.value).toBe('섹터 45%; 베타 1.8');
      expect(r.pushTrace).toBe(true);
    }
  });

  it('entryAllowed=true + warnings 존재 → pass with passWarnMessage', async () => {
    (evaluatePortfolioRisk as any).mockResolvedValue({
      entryAllowed: true,
      blockReasons: [],
      warnings: ['일일 손실 -2.1%', '섹터 35% 근접'],
    });
    const r = await portfolioRiskGate(makeMockCtx({ stock: makeMockStock({ name: '삼성전자' }) }));
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passWarnMessage).toContain('PortfolioRisk');
      expect(r.passWarnMessage).toContain('삼성전자');
      expect(r.passWarnMessage).toContain('경고');
      expect(r.passWarnMessage).toContain('일일 손실 -2.1%');
    }
  });

  it('evaluatePortfolioRisk 호출 시 stock.sector 정확 전달', async () => {
    (evaluatePortfolioRisk as any).mockResolvedValue({
      entryAllowed: true, blockReasons: [], warnings: [],
    });
    await portfolioRiskGate(makeMockCtx({ stock: makeMockStock({ sector: '바이오' }) }));
    expect(evaluatePortfolioRisk).toHaveBeenCalledWith('바이오');
  });

  it('차단 시 telegramMessage 미정의 (텔레그램 전송 안 함)', async () => {
    (evaluatePortfolioRisk as any).mockResolvedValue({
      entryAllowed: false, blockReasons: ['x'], warnings: [],
    });
    const r = await portfolioRiskGate(makeMockCtx());
    if (!r.pass) {
      expect(r.telegramMessage).toBeUndefined();
    }
  });
});
