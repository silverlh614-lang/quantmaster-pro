// @responsibility ADR-0428 /shadow_provisional 텔레그램 명령 회귀 테스트.

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../persistence/provisionalShadowLedger.js', () => ({
  loadProvisionalShadowLedger: vi.fn(() => []),
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
  formatProvisionalShadowPerformanceMessage: vi.fn(() => '🌱 <b>Provisional Shadow Report (ADR-0428)</b>\n  • <i>아직 provisional shadow entry 가 없습니다.</i>'),
}));

vi.mock('../../commandRegistry.js', () => {
  const registry = new Map();
  return {
    commandRegistry: {
      register: (cmd: { name: string }) => registry.set(cmd.name, cmd),
      resolve: (name: string) => registry.get(name),
      all: () => Array.from(registry.values()),
      clear: () => registry.clear(),
    },
  };
});

import shadowProvisional, { __resetShadowProvisionalRateLimitForTests } from './shadowProvisional.cmd.js';
import { loadProvisionalShadowLedger } from '../../../persistence/provisionalShadowLedger.js';
import {
  buildProvisionalShadowPerformanceReport,
  formatProvisionalShadowPerformanceMessage,
} from '../../../learning/provisionalShadowPerformanceReport.js';

describe('ADR-0428 /shadow_provisional 텔레그램 명령', () => {
  beforeEach(() => {
    __resetShadowProvisionalRateLimitForTests();
    vi.clearAllMocks();
  });

  describe('메타데이터', () => {
    it('name + aliases — /shadow_provisional / /shadow_provisional_report / /provisional_shadow', () => {
      expect(shadowProvisional.name).toBe('/shadow_provisional');
      expect(shadowProvisional.aliases).toEqual([
        '/shadow_provisional_report',
        '/provisional_shadow',
      ]);
    });

    it('category=SYS, riskLevel=0 (read-only), visibility=ADMIN', () => {
      expect(shadowProvisional.category).toBe('SYS');
      expect(shadowProvisional.riskLevel).toBe(0);
      expect(shadowProvisional.visibility).toBe('ADMIN');
    });

    it('description ADR-0428 명시', () => {
      expect(shadowProvisional.description).toContain('ADR-0428');
      expect(shadowProvisional.description).toContain('read-only');
    });
  });

  describe('execute 정상 흐름', () => {
    it('ledger read + report build + format 호출 + reply', async () => {
      const replies: string[] = [];
      const reply = async (msg: string) => { replies.push(msg); };
      await shadowProvisional.execute({ args: [], reply });
      expect(loadProvisionalShadowLedger).toHaveBeenCalledTimes(1);
      expect(buildProvisionalShadowPerformanceReport).toHaveBeenCalledTimes(1);
      expect(formatProvisionalShadowPerformanceMessage).toHaveBeenCalledTimes(1);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toContain('Provisional Shadow Report');
    });
  });

  describe('5분 rate-limit', () => {
    it('5분 이내 재호출 차단', async () => {
      const replies: string[] = [];
      const reply = async (msg: string) => { replies.push(msg); };
      await shadowProvisional.execute({ args: [], reply });
      replies.length = 0;
      await shadowProvisional.execute({ args: [], reply });
      expect(replies[0]).toContain('5분 이내 재호출 차단');
      expect(replies[0]).toMatch(/\d+초 후/);
      // 두 번째 호출은 build 호출 안 됨
      expect(buildProvisionalShadowPerformanceReport).toHaveBeenCalledTimes(1);
    });

    it('reset 후 재호출 가능', async () => {
      const reply = async () => {};
      await shadowProvisional.execute({ args: [], reply });
      __resetShadowProvisionalRateLimitForTests();
      await shadowProvisional.execute({ args: [], reply });
      expect(buildProvisionalShadowPerformanceReport).toHaveBeenCalledTimes(2);
    });
  });

  describe('throw graceful', () => {
    it('build throw → ❌ 메시지 + 다음 호출 무영향', async () => {
      vi.mocked(buildProvisionalShadowPerformanceReport).mockRejectedValueOnce(new Error('mock failure'));
      const replies: string[] = [];
      const reply = async (msg: string) => { replies.push(msg); };
      await shadowProvisional.execute({ args: [], reply });
      expect(replies[0]).toContain('❌');
      expect(replies[0]).toContain('mock failure');
    });
  });
});
