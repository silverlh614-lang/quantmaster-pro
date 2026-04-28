// @responsibility conditionAttributionShadow.cmd 회귀 테스트.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
import type { ShadowAttributionReport, ShadowConditionStat } from '../../../learning/conditionAttributionShadow.js';

vi.mock('../../../learning/conditionAttributionShadow.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../learning/conditionAttributionShadow.js');
  return {
    ...actual,
    analyzeShadowAttribution: vi.fn(),
  };
});

import * as repo from '../../../learning/conditionAttributionShadow.js';
import { formatShadowAttributionMessage } from './conditionAttributionShadow.cmd.js';
import './conditionAttributionShadow.cmd.js';

const mockedAnalyze = vi.mocked(repo.analyzeShadowAttribution);

function makeStat(overrides: Partial<ShadowConditionStat> & { conditionId: number }): ShadowConditionStat {
  return {
    conditionName: `조건 ${overrides.conditionId}`,
    overStrictCount: 0,
    goodDefenseCount: 0,
    overStrictAvgReturn: 0,
    goodDefenseAvgReturn: 0,
    ratio: 0,
    classification: 'insufficient',
    ...overrides,
  };
}

describe('formatShadowAttributionMessage', () => {
  it('DISABLED → ⛔', () => {
    const report: ShadowAttributionReport = {
      totalConditions: 0, status: 'DISABLED', closedSampleSize: 0, conditions: [],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 0, normal: 0 },
    };
    const msg = formatShadowAttributionMessage(report);
    expect(msg).toContain('비활성');
    expect(msg).toContain('SHADOW_CONDITION_ATTRIBUTION_DISABLED');
  });

  it('NO_DATA → 📭 placeholder', () => {
    const report: ShadowAttributionReport = {
      totalConditions: 0, status: 'NO_DATA', closedSampleSize: 0, conditions: [],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 0, normal: 0 },
    };
    const msg = formatShadowAttributionMessage(report);
    expect(msg).toContain('📭');
    expect(msg).toContain('PR-F-2 후속');
  });

  it('정상 — Over-Strict 후보 표시', () => {
    const conditions: ShadowConditionStat[] = [
      makeStat({ conditionId: 25, classification: 'over_strict_candidate', overStrictCount: 8, ratio: 0.8, overStrictAvgReturn: 12 }),
      ...Array.from({ length: 26 }, (_, i) => makeStat({ conditionId: i + 1, classification: 'insufficient' })).filter((c) => c.conditionId !== 25),
    ];
    const report: ShadowAttributionReport = {
      totalConditions: 27, status: 'OK', closedSampleSize: 50, conditions,
      summary: { overStrictCandidates: 1, goodDefenseCandidates: 0, insufficient: 26, normal: 0 },
    };
    const msg = formatShadowAttributionMessage(report);
    expect(msg).toContain('Over-Strict 후보');
    expect(msg).toContain('#25');
    expect(msg).toContain('over 8건');
  });

  it('정상 — Good Defense 후보 표시', () => {
    const conditions: ShadowConditionStat[] = [
      makeStat({ conditionId: 16, classification: 'good_defense_candidate', goodDefenseCount: 6, ratio: 0.2, goodDefenseAvgReturn: -8 }),
    ];
    const report: ShadowAttributionReport = {
      totalConditions: 27, status: 'OK', closedSampleSize: 30, conditions,
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 1, insufficient: 0, normal: 0 },
    };
    const msg = formatShadowAttributionMessage(report);
    expect(msg).toContain('Good Defense 후보');
    expect(msg).toContain('#16');
    expect(msg).toContain('defense 6건');
  });

  it('의사결정 안내 라인 항상 포함', () => {
    const report: ShadowAttributionReport = {
      totalConditions: 27, status: 'OK', closedSampleSize: 5, conditions: [],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 0, normal: 0 },
    };
    const msg = formatShadowAttributionMessage(report);
    expect(msg).toContain('의사결정 안내');
    expect(msg).toContain('자동 조정 금지');
  });

  it('후보 없음 → 💡 안내', () => {
    const report: ShadowAttributionReport = {
      totalConditions: 27, status: 'OK', closedSampleSize: 5,
      conditions: Array.from({ length: 27 }, (_, i) => makeStat({ conditionId: i + 1, classification: 'insufficient' })),
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 27, normal: 0 },
    };
    const msg = formatShadowAttributionMessage(report);
    expect(msg).toContain('분류 후보 없음');
  });
});

describe('conditionAttributionShadow.cmd execute', () => {
  let replies: string[];

  beforeEach(() => {
    replies = [];
    mockedAnalyze.mockReset();
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('정상 응답 — analyzeShadowAttribution + reply', async () => {
    mockedAnalyze.mockReturnValue({
      totalConditions: 0, status: 'NO_DATA', closedSampleSize: 0, conditions: [],
      summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 0, normal: 0 },
    });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/shadow_attribution');
    expect(cmd).toBeDefined();
    await cmd!.execute({ args: [], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('Shadow → Condition Attribution');
  });

  it('alias /sa 도 동일 instance', () => {
    const cmd1 = commandRegistry.resolve('/shadow_attribution');
    const cmd2 = commandRegistry.resolve('/sa');
    expect(cmd1).toBe(cmd2);
  });

  it('throw 시 graceful', async () => {
    mockedAnalyze.mockImplementation(() => { throw new Error('boom'); });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/shadow_attribution');
    await cmd!.execute({ args: [], reply });
    expect(replies[0]).toContain('❌');
  });

  it('메타데이터', () => {
    const cmd = commandRegistry.resolve('/shadow_attribution');
    expect(cmd!.name).toBe('/shadow_attribution');
    expect(cmd!.aliases).toContain('/sa');
    expect(cmd!.category).toBe('LRN');
    expect(cmd!.riskLevel).toBe(0);
    expect(cmd!.visibility).toBe('ADMIN');
  });
});
