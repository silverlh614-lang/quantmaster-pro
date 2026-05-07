// @responsibility ADR-0433 /shadow_universe 텔레그램 명령 회귀 테스트.
//
// 메타데이터 + 정상 실행 + empty ledger placeholder + throw graceful + 정적 grep 가드.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

vi.mock('../../../persistence/counterfactualUniverseLearningRepo.js', () => ({
  loadCounterfactualUniverseLearningLedger: vi.fn(() => []),
  summarizeCounterfactualUniverseLearningLedger: vi.fn(() => ({
    totalSnapshots: 0,
    todaySnapshots: 0,
    blockedByBreakdown: {},
    preflightStageBreakdown: {},
    reasonBreakdown: {},
    latestSnapshot: undefined,
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

import shadowUniverse, { formatShadowUniverseMessage } from './shadowUniverse.cmd.js';
import {
  loadCounterfactualUniverseLearningLedger,
  summarizeCounterfactualUniverseLearningLedger,
} from '../../../persistence/counterfactualUniverseLearningRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CMD_PATH = join(__dirname, 'shadowUniverse.cmd.ts');
const CMD_SOURCE = readFileSync(CMD_PATH, 'utf-8');

describe('ADR-0433 /shadow_universe 텔레그램 명령', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('메타데이터 — name + 2 aliases + SYS + riskLevel=0 + ADMIN', () => {
    expect(shadowUniverse.name).toBe('/shadow_universe');
    expect(shadowUniverse.aliases).toEqual(['/counterfactual_universe', '/universe_learning']);
    expect(shadowUniverse.category).toBe('SYS');
    expect(shadowUniverse.riskLevel).toBe(0);
    expect(shadowUniverse.visibility).toBe('ADMIN');
    expect(shadowUniverse.description).toContain('Counterfactual Universe Learning');
    expect(shadowUniverse.description).toContain('ADR-0433');
  });

  it('execute — empty ledger 시 placeholder 메시지', async () => {
    const reply = vi.fn();
    await shadowUniverse.execute({ args: [], reply });
    expect(summarizeCounterfactualUniverseLearningLedger).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain('Counterfactual Universe Learning (ADR-0433)');
    expect(msg).toContain('비어있습니다');
  });

  it('execute — populated ledger 시 분포 + 최근 snapshot 노출', async () => {
    (
      summarizeCounterfactualUniverseLearningLedger as unknown as {
        mockReturnValue: (v: unknown) => void;
      }
    ).mockReturnValue({
      totalSnapshots: 5,
      todaySnapshots: 3,
      blockedByBreakdown: { SELL_ONLY: 4, HARD_BLOCK: 1 },
      preflightStageBreakdown: { AFTER_UNIVERSE_BUILD: 4, BEFORE_BUYLIST_LOOP: 1 },
      reasonBreakdown: { SELL_ONLY_PREFLIGHT: 4, HARD_BLOCK_PREFLIGHT: 1 },
      latestSnapshot: {
        id: 'cul-202605070900-abcd',
        eventType: 'COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT',
        source: 'ADR-0433',
        learningOnly: true,
        executionShadow: false,
        virtualAccountImpact: 'NONE',
        liveAllowed: false,
        paperAllowed: false,
        executionShadowAllowed: false,
        scanId: 'scan-A',
        createdAtKst: '2026-05-07T09:00:00+09:00',
        regime: 'R6_DEFENSE',
        blockedBy: ['SELL_ONLY'],
        reasons: ['SELL_ONLY_PREFLIGHT'],
        preflightStage: 'AFTER_UNIVERSE_BUILD',
      },
    });
    (
      loadCounterfactualUniverseLearningLedger as unknown as {
        mockReturnValue: (v: unknown) => void;
      }
    ).mockReturnValue([
      {
        id: 'cul-202605070900-abcd',
        eventType: 'COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT',
        source: 'ADR-0433',
        learningOnly: true,
        executionShadow: false,
        virtualAccountImpact: 'NONE',
        liveAllowed: false,
        paperAllowed: false,
        executionShadowAllowed: false,
        scanId: 'scan-A',
        createdAtKst: '2026-05-07T09:00:00+09:00',
        regime: 'R6_DEFENSE',
        blockedBy: ['SELL_ONLY'],
        reasons: ['SELL_ONLY_PREFLIGHT'],
        candidateSummaryCount: 50,
        preflightStage: 'AFTER_UNIVERSE_BUILD',
      },
    ]);
    const reply = vi.fn();
    await shadowUniverse.execute({ args: [], reply });
    const msg = (reply.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain('5건');
    expect(msg).toContain('SELL_ONLY: 4');
    expect(msg).toContain('AFTER_UNIVERSE_BUILD: 4');
    expect(msg).toContain('LIVE/PAPER/normal shadow/virtual account 영향 0');
  });

  it('formatShadowUniverseMessage — empty summary 시 placeholder', () => {
    const msg = formatShadowUniverseMessage(
      {
        totalSnapshots: 0,
        todaySnapshots: 0,
        blockedByBreakdown: {},
        preflightStageBreakdown: {},
        reasonBreakdown: {},
      },
      [],
    );
    expect(msg).toContain('비어있습니다');
    expect(msg).toContain('LIVE 매매 영향 0');
  });

  it('throw graceful — summarize 실패 시 ❌ 메시지', async () => {
    (
      summarizeCounterfactualUniverseLearningLedger as unknown as {
        mockImplementationOnce: (fn: () => unknown) => void;
      }
    ).mockImplementationOnce(() => {
      throw new Error('mock summarize failure');
    });
    const reply = vi.fn();
    await shadowUniverse.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('mock summarize failure');
  });

  describe('정적 grep 가드 — read-only 학습 명령', () => {
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
    it('promoteToLive / promoteToPaper / autoPromote / setGateThreshold 0건', () => {
      expect(CMD_SOURCE).not.toMatch(
        /promoteToLive|promoteToPaper|autoPromote|setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/,
      );
    });
    it('virtual account mutation 0건', () => {
      expect(CMD_SOURCE).not.toMatch(
        /setVirtualAccountHoldings|updateVirtualAccountCash|mutateHoldings|setEquity/,
      );
    });
    it('aliases 사용자 명시 정확 — /counterfactual_universe / /universe_learning', () => {
      const all = [shadowUniverse.name, ...(shadowUniverse.aliases ?? [])];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toContain('/shadow_universe');
      expect(all).toContain('/counterfactual_universe');
      expect(all).toContain('/universe_learning');
    });
  });
});
