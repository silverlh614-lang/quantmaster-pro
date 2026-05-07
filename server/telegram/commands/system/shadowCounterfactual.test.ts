// @responsibility ADR-0431 /shadow_counterfactual 텔레그램 명령 회귀 테스트.
//
// 메타데이터 + execute 동작 + rate-limit + throw graceful + KIS 주문 함수 import 0건.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

vi.mock('../../../persistence/counterfactualShadowLearningRepo.js', () => ({
  loadCounterfactualShadowLearningLedger: vi.fn(() => []),
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
  formatCounterfactualShadowPerformanceMessage: vi.fn(
    () =>
      '🧠 <b>Counterfactual Shadow Report (ADR-0431)</b>\n  • <i>아직 counterfactual shadow learning entry 가 없습니다.</i>',
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

import shadowCounterfactual, {
  __resetShadowCounterfactualRateLimitForTests,
} from './shadowCounterfactual.cmd.js';
import { loadCounterfactualShadowLearningLedger } from '../../../persistence/counterfactualShadowLearningRepo.js';
import {
  buildCounterfactualShadowPerformanceReport,
  formatCounterfactualShadowPerformanceMessage,
} from '../../../learning/counterfactualShadowLearningPerformanceReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CMD_PATH = join(__dirname, 'shadowCounterfactual.cmd.ts');
const CMD_SOURCE = readFileSync(CMD_PATH, 'utf-8');

describe('ADR-0431 /shadow_counterfactual 텔레그램 명령', () => {
  beforeEach(() => {
    __resetShadowCounterfactualRateLimitForTests();
    vi.clearAllMocks();
  });

  it('메타데이터 — name, aliases, category, riskLevel, visibility', () => {
    expect(shadowCounterfactual.name).toBe('/shadow_counterfactual');
    expect(shadowCounterfactual.aliases).toEqual([
      '/counterfactual_shadow',
      '/shadow_learning',
      '/learning_shadow',
    ]);
    expect(shadowCounterfactual.category).toBe('SYS');
    expect(shadowCounterfactual.riskLevel).toBe(0);
    expect(shadowCounterfactual.visibility).toBe('ADMIN');
    expect(shadowCounterfactual.description).toContain('Counterfactual Shadow Performance Report');
    expect(shadowCounterfactual.description).toContain('ADR-0431');
    expect(shadowCounterfactual.description).toContain('read-only');
  });

  it('execute — 정상 호출 시 reply 1회 (formatter 결과)', async () => {
    const reply = vi.fn();
    await shadowCounterfactual.execute({ args: [], reply });
    expect(loadCounterfactualShadowLearningLedger).toHaveBeenCalled();
    expect(buildCounterfactualShadowPerformanceReport).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [] }),
    );
    expect(formatCounterfactualShadowPerformanceMessage).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain('Counterfactual Shadow Report (ADR-0431)');
  });

  it('rate-limit — 5분 이내 재호출 차단', async () => {
    const reply = vi.fn();
    await shadowCounterfactual.execute({ args: [], reply });
    await shadowCounterfactual.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(2);
    const second = (reply.mock.calls[1] as unknown[])[0] as string;
    expect(second).toContain('5분 이내 재호출 차단');
    expect(buildCounterfactualShadowPerformanceReport).toHaveBeenCalledTimes(1);
  });

  it('reset 후 재호출 가능', async () => {
    const reply = vi.fn();
    await shadowCounterfactual.execute({ args: [], reply });
    __resetShadowCounterfactualRateLimitForTests();
    await shadowCounterfactual.execute({ args: [], reply });
    expect(buildCounterfactualShadowPerformanceReport).toHaveBeenCalledTimes(2);
  });

  it('throw graceful — buildReport 실패 시 ❌ 메시지', async () => {
    const reply = vi.fn();
    (
      buildCounterfactualShadowPerformanceReport as unknown as { mockRejectedValueOnce: (e: Error) => void }
    ).mockRejectedValueOnce(new Error('mock build failure'));
    await shadowCounterfactual.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('mock build failure');
  });

  describe('정적 grep 가드 — 매매 정책 변경 0', () => {
    it('KIS 주문 함수 5종 import 0건', () => {
      expect(CMD_SOURCE).not.toMatch(
        /placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/,
      );
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
      expect(CMD_SOURCE).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
    });

    it('shadowTradeRepo / appendShadow import 0건 — 일반 shadow 무수정', () => {
      expect(CMD_SOURCE).not.toMatch(/shadowTradeRepo|appendShadow|saveShadowTrades/);
    });

    it('aliases 중복 없음 + 사용자 명시 4종', () => {
      const all = [shadowCounterfactual.name, ...(shadowCounterfactual.aliases ?? [])];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toContain('/shadow_counterfactual');
      expect(all).toContain('/counterfactual_shadow');
      expect(all).toContain('/shadow_learning');
      expect(all).toContain('/learning_shadow');
    });
  });
});
