// @responsibility ADR-0432 /shadow_promotion 텔레그램 명령 회귀 테스트.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

vi.mock('../../../persistence/provisionalShadowLedger.js', () => ({
  loadProvisionalShadowLedger: vi.fn(() => []),
}));

vi.mock('../../../persistence/counterfactualShadowLearningRepo.js', () => ({
  loadCounterfactualShadowLearningLedger: vi.fn(() => []),
}));

vi.mock('../../../learning/provisionalShadowPerformanceReport.js', () => ({
  buildProvisionalShadowPerformanceReport: vi.fn(async () => ({
    totalEntries: 0,
    observedEntries: 0,
    pendingEntries: 0,
    labelBreakdown: {},
    avgReturnByHorizon: {},
    winRateByHorizon: {},
    topWinners: [],
    topLosers: [],
    generatedAtKst: '2026-05-08T10:00:00+09:00',
  })),
}));

vi.mock('../../../learning/counterfactualShadowLearningPerformanceReport.js', () => ({
  buildCounterfactualShadowPerformanceReport: vi.fn(async () => ({
    totalEntries: 0,
    observedEntries: 0,
    pendingEntries: 0,
    insufficientDataEntries: 0,
    labelBreakdown: {},
    blockedByBreakdown: {},
    avgReturnByHorizon: {},
    winRateByHorizon: {},
    topWinners: [],
    topLosers: [],
    generatedAtKst: '2026-05-08T10:00:00+09:00',
  })),
}));

vi.mock('../../../learning/shadowLearningPromotionRecommendation.js', () => ({
  buildShadowLearningPromotionRecommendations: vi.fn(() => ({
    generatedAtKst: '2026-05-08T10:00:00+09:00',
    totalEvaluated: 0,
    promoteToNormalShadowWatch: 0,
    promoteToEnhancedWatch: 0,
    keepLearningOnly: 0,
    rejectLearningHypothesis: 0,
    insufficientData: 0,
    pending: 0,
    candidates: [],
  })),
  formatShadowLearningPromotionMessage: vi.fn(
    () =>
      '🧪 <b>Shadow Learning Promotion Report (ADR-0432)</b>\n  • <i>recommendation-only — 매매 액션 0.</i>',
  ),
}));

vi.mock('../../../learning/provisionalShadowPriceProvider.js', () => ({
  createProvisionalShadowPriceProvider: vi.fn(() => async () => ({
    available: false,
    reason: 'mocked',
    status: 'DATA_UNAVAILABLE',
  })),
}));

vi.mock('../../../learning/counterfactualShadowPriceProviderAdapter.js', () => ({
  wrapProvisionalProviderForCounterfactual: vi.fn((p: unknown) => p),
  createCounterfactualShadowPriceProvider: vi.fn(() => async () => ({
    available: false,
    reason: 'mocked',
    status: 'DATA_UNAVAILABLE',
    source: 'NONE',
  })),
}));

vi.mock('../../commandRegistry.js', () => {
  const registry = new Map<string, unknown>();
  return {
    commandRegistry: {
      register: (cmd: { name: string }) => registry.set(cmd.name, cmd),
      resolve: (name: string) => registry.get(name),
      all: () => Array.from(registry.values()),
      clear: () => registry.clear(),
    },
  };
});

import shadowPromotion, {
  __resetShadowPromotionRateLimitForTests,
} from './shadowPromotion.cmd.js';
import { buildShadowLearningPromotionRecommendations } from '../../../learning/shadowLearningPromotionRecommendation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CMD_PATH = join(__dirname, 'shadowPromotion.cmd.ts');
const CMD_SOURCE = readFileSync(CMD_PATH, 'utf-8');

describe('ADR-0432 /shadow_promotion 텔레그램 명령', () => {
  beforeEach(() => {
    __resetShadowPromotionRateLimitForTests();
    vi.clearAllMocks();
  });

  it('메타데이터 — name + 3 aliases + category=SYS + riskLevel=0 + ADMIN', () => {
    expect(shadowPromotion.name).toBe('/shadow_promotion');
    expect(shadowPromotion.aliases).toEqual([
      '/shadow_learning_promotion',
      '/learning_promotion',
      '/shadow_promote_candidates',
    ]);
    expect(shadowPromotion.category).toBe('SYS');
    expect(shadowPromotion.riskLevel).toBe(0);
    expect(shadowPromotion.visibility).toBe('ADMIN');
    expect(shadowPromotion.description).toContain('Shadow Learning Promotion');
    expect(shadowPromotion.description).toContain('ADR-0432');
    expect(shadowPromotion.description).toContain('read-only');
  });

  it('execute — 정상 호출 시 reply 1회 (formatter 결과)', async () => {
    const reply = vi.fn();
    await shadowPromotion.execute({ args: [], reply });
    expect(buildShadowLearningPromotionRecommendations).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain('Shadow Learning Promotion Report (ADR-0432)');
  });

  it('rate-limit — 5분 이내 재호출 차단', async () => {
    const reply = vi.fn();
    await shadowPromotion.execute({ args: [], reply });
    await shadowPromotion.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(2);
    const second = (reply.mock.calls[1] as unknown[])[0] as string;
    expect(second).toContain('5분 이내 재호출 차단');
    expect(buildShadowLearningPromotionRecommendations).toHaveBeenCalledTimes(1);
  });

  it('reset 후 재호출 가능', async () => {
    const reply = vi.fn();
    await shadowPromotion.execute({ args: [], reply });
    __resetShadowPromotionRateLimitForTests();
    await shadowPromotion.execute({ args: [], reply });
    expect(buildShadowLearningPromotionRecommendations).toHaveBeenCalledTimes(2);
  });

  it('throw graceful — buildPromotion 실패 시 ❌ 메시지', async () => {
    const reply = vi.fn();
    (
      buildShadowLearningPromotionRecommendations as unknown as {
        mockImplementationOnce: (fn: () => unknown) => void;
      }
    ).mockImplementationOnce(() => {
      throw new Error('mock build failure');
    });
    await shadowPromotion.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('mock build failure');
  });

  describe('정적 grep 가드 — recommendation only', () => {
    it('KIS 주문 함수 5종 import 0건', () => {
      expect(CMD_SOURCE).not.toMatch(
        /placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/,
      );
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor / shadowTradeRepo import 0건', () => {
      expect(CMD_SOURCE).not.toMatch(
        /autoTradeEngine|orderExecutor|trancheExecutor|shadowTradeRepo|appendShadow|saveShadowTrades/,
      );
    });

    it('aliases 중복 없음 + 사용자 명시 4종', () => {
      const all = [shadowPromotion.name, ...(shadowPromotion.aliases ?? [])];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toContain('/shadow_promotion');
      expect(all).toContain('/shadow_learning_promotion');
      expect(all).toContain('/learning_promotion');
      expect(all).toContain('/shadow_promote_candidates');
    });

    it('promoteToLive / promoteToPaper / autoPromote 키워드 0건', () => {
      expect(CMD_SOURCE).not.toMatch(/promoteToLive|promoteToPaper|autoPromote/);
    });
  });
});
