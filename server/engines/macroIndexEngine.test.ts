/**
 * macroIndexEngine.test.ts — 아이디어 11: MHS 결정적 계산 검증
 *
 * 검증 목표:
 *   1. ECOS/FRED 양쪽 전면 실패 시 MHS=50 (NEUTRAL_HIGH) 폴백 + buyingHalted=false.
 *   2. Bull 시나리오(금리 인하 + 수출 호조 + 저변동성) → MHS>=70.
 *   3. Bear 시나리오(금리 인상 + 수출 급감 + 고변동성 + HY 급등) → MHS<30, buyingHalted=true.
 *   4. 축별 점수는 0~25 범위를 벗어나지 않는다.
 *   5. drivers 배열은 빈 상황에서도 최소 1개 이상의 설명을 포함.
 *   6. buildMacroInterpretContext(): 모든 섹션이 문자열에 포함.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ECOS/FRED 는 외부 네트워크 의존 — 전부 mock.
vi.mock('../clients/ecosClient.js', () => ({
  fetchEcosSnapshot: vi.fn(),
  resetEcosCache: vi.fn(),
}));
vi.mock('../clients/fredClient.js', () => ({
  fetchFredSnapshot: vi.fn(),
  resetFredCache: vi.fn(),
}));
// Gemini 해석 코멘트 mock — 기본 null, 개별 테스트에서 override.
vi.mock('../clients/geminiClient.js', () => ({
  callGeminiInterpret: vi.fn(async () => null),
}));

import { fetchEcosSnapshot } from '../clients/ecosClient.js';
import { fetchFredSnapshot } from '../clients/fredClient.js';
import {
  computeMacroIndex,
  buildMacroInterpretContext,
  generateMacroCommentary,
} from './macroIndexEngine.js';
import { callGeminiInterpret } from '../clients/geminiClient.js';

const emptyEcos = {
  bokRate: null,
  m2YoyPct: null,
  nominalGdpGrowth: null,
  exportGrowth3mAvg: null,
  bankLendingYoyPct: null,
  usdKrw: null,
  fetchedAt: new Date().toISOString(),
  errors: [] as string[],
};
const emptyFred = {
  yieldCurve10y2y: null,
  hySpreadPct: null,
  sofrPct: null,
  financialStress: null,
  wtiCrude: null,
  fetchedAt: new Date().toISOString(),
  errors: [] as string[],
};

describe('macroIndexEngine — MHS 결정적 계산', () => {
  beforeEach(() => {
    vi.mocked(fetchEcosSnapshot).mockReset();
    vi.mocked(fetchFredSnapshot).mockReset();
    vi.mocked(callGeminiInterpret).mockReset().mockResolvedValue(null);
  });

  it('ECOS/FRED 전부 실패 시 MHS 50(NEUTRAL_HIGH) 폴백', async () => {
    vi.mocked(fetchEcosSnapshot).mockResolvedValue({ ...emptyEcos });
    vi.mocked(fetchFredSnapshot).mockResolvedValue({ ...emptyFred });

    const idx = await computeMacroIndex();
    expect(idx.mhs).toBe(50);
    expect(idx.regime).toBe('NEUTRAL_HIGH');
    expect(idx.buyingHalted).toBe(false);
    expect(idx.sourcesOk.ecos).toBe(false);
    expect(idx.sourcesOk.fred).toBe(false);
    expect(idx.drivers.some(d => d.includes('폴백'))).toBe(true);
  });

  it('Bull 시나리오: 금리 인하 + 수출 호조 → MHS >= 70', async () => {
    vi.mocked(fetchEcosSnapshot).mockResolvedValue({
      ...emptyEcos,
      // BOK 인하 + US short rate 낮음 → 스프레드 역전 없음.
      bokRate: { date: '20250401', rate: 3.50, direction: 'CUTTING' },
      m2YoyPct: 8.0,            // M2 > GDP (유동성 잉여)
      nominalGdpGrowth: 3.5,
      exportGrowth3mAvg: 12.0,  // 수출 급등
      bankLendingYoyPct: 7.0,
    });
    vi.mocked(fetchFredSnapshot).mockResolvedValue({
      ...emptyFred,
      yieldCurve10y2y: 0.5,
      sofrPct: 3.00,            // krUsSpread = 0.5 (역전 없음)
      hySpreadPct: 3.2,
      financialStress: -0.5,
    });

    const idx = await computeMacroIndex({
      vkospi: 15, vix: 14, samsungIri: 1.1, us10yYield: 4.0,
    });
    expect(idx.mhs).toBeGreaterThanOrEqual(70);
    expect(idx.regime).toBe('BULL');
    expect(idx.buyingHalted).toBe(false);
    expect(idx.axis.interestRate).toBeGreaterThanOrEqual(20);
    expect(idx.axis.economy).toBeGreaterThan(20);
  });

  it('Bear 시나리오: 금리 인상 + 수출 급감 + 고공포 → MHS < 30, buyingHalted', async () => {
    vi.mocked(fetchEcosSnapshot).mockResolvedValue({
      ...emptyEcos,
      bokRate: { date: '20250401', rate: 5.50, direction: 'HIKING' },
      m2YoyPct: 2.0,
      nominalGdpGrowth: 4.0,    // M2 < GDP (유동성 긴축)
      exportGrowth3mAvg: -10.0, // 수출 급감
      bankLendingYoyPct: -2.0,  // 대출 역성장
    });
    vi.mocked(fetchFredSnapshot).mockResolvedValue({
      ...emptyFred,
      yieldCurve10y2y: -0.8,
      sofrPct: 5.25,
      hySpreadPct: 8.0,          // 극단 스트레스
      financialStress: 2.0,      // 극단 스트레스
    });

    const idx = await computeMacroIndex({ vkospi: 38, vix: 35, samsungIri: 0.6 });
    expect(idx.mhs).toBeLessThan(30);
    expect(idx.regime).toBe('DEFENSE');
    expect(idx.buyingHalted).toBe(true);
  });

  it('축별 점수는 항상 0~25 범위 클램프', async () => {
    // 더 극단 케이스 — 클램프 검증용
    vi.mocked(fetchEcosSnapshot).mockResolvedValue({
      ...emptyEcos,
      bokRate: { date: '20250401', rate: 8.00, direction: 'HIKING' },
      m2YoyPct: -10.0,
      nominalGdpGrowth: 10.0,
      exportGrowth3mAvg: -50.0,
      bankLendingYoyPct: -30.0,
    });
    vi.mocked(fetchFredSnapshot).mockResolvedValue({
      ...emptyFred,
      sofrPct: 7.0,
      hySpreadPct: 15.0,
      financialStress: 5.0,
      yieldCurve10y2y: -2.0,
    });

    const idx = await computeMacroIndex({ vkospi: 60, vix: 60, samsungIri: 0.3, us10yYield: 6.0 });
    expect(idx.axis.interestRate).toBeGreaterThanOrEqual(0);
    expect(idx.axis.interestRate).toBeLessThanOrEqual(25);
    expect(idx.axis.liquidity).toBeGreaterThanOrEqual(0);
    expect(idx.axis.liquidity).toBeLessThanOrEqual(25);
    expect(idx.axis.economy).toBeGreaterThanOrEqual(0);
    expect(idx.axis.economy).toBeLessThanOrEqual(25);
    expect(idx.axis.risk).toBeGreaterThanOrEqual(0);
    expect(idx.axis.risk).toBeLessThanOrEqual(25);
    expect(idx.mhs).toBeGreaterThanOrEqual(0);
    expect(idx.mhs).toBeLessThanOrEqual(100);
  });

  it('buildMacroInterpretContext: 모든 섹션 포함', async () => {
    vi.mocked(fetchEcosSnapshot).mockResolvedValue({
      ...emptyEcos,
      bokRate: { date: '20250401', rate: 3.25, direction: 'HOLDING' },
      m2YoyPct: 6.0,
      nominalGdpGrowth: 3.5,
      usdKrw: 1385.5,
    });
    vi.mocked(fetchFredSnapshot).mockResolvedValue({ ...emptyFred, sofrPct: 4.30, hySpreadPct: 3.5 });

    const idx = await computeMacroIndex({ vkospi: 18, vix: 17, samsungIri: 1.0 });
    const ctx = buildMacroInterpretContext(idx);
    expect(ctx).toContain('## MHS (자체 계산)');
    expect(ctx).toContain('## ECOS (한국은행)');
    expect(ctx).toContain('## FRED (미국 연준)');
    expect(ctx).toContain('## 시장 보조 (호출자 주입)');
    expect(ctx).toContain('BOK 기준금리');
    expect(ctx).toContain('1385.5');   // usdKrw 가 포맷되어 등장
  });

  it('generateMacroCommentary: Gemini 키 없으면 null 로 수렴', async () => {
    vi.mocked(fetchEcosSnapshot).mockResolvedValue({ ...emptyEcos });
    vi.mocked(fetchFredSnapshot).mockResolvedValue({ ...emptyFred });
    vi.mocked(callGeminiInterpret).mockResolvedValue(null);

    const idx = await computeMacroIndex();
    const comment = await generateMacroCommentary(idx);
    expect(comment).toBeNull();
    expect(vi.mocked(callGeminiInterpret)).toHaveBeenCalledTimes(1);
  });
});
