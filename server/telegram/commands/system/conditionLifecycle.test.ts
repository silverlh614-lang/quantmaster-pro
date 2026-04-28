// @responsibility conditionLifecycle.cmd 회귀 테스트 — formatConditionLifecycleMessage + execute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
import type { ConditionLifecycleReport } from '../../../learning/conditionLifecyclePolicy.js';

vi.mock('../../../persistence/attributionRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../persistence/attributionRepo.js',
  );
  return {
    ...actual,
    loadCurrentSchemaRecords: vi.fn(),
  };
});

import * as attribRepo from '../../../persistence/attributionRepo.js';
import { formatConditionLifecycleMessage } from './conditionLifecycle.cmd.js';
import './conditionLifecycle.cmd.js';

const mockedLoad = vi.mocked(attribRepo.loadCurrentSchemaRecords);

function makeReport(
  id: number,
  status: ConditionLifecycleReport['status'],
  rate: number,
  overrides: Partial<ConditionLifecycleReport> = {},
): ConditionLifecycleReport {
  return {
    conditionId: id,
    conditionName: `조건 ${id}`,
    status,
    reason: `활성률 ${(rate * 100).toFixed(2)}%`,
    activatedCount: 30,
    totalRecords: 100,
    activationRate: rate,
    firstSeenAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-04-15T00:00:00Z',
    ageDays: 100,
    recordsInWindow: 100,
    windowDays: 180,
    ...overrides,
  };
}

describe('formatConditionLifecycleMessage', () => {
  it('disabled=true → ⛔ 비활성', () => {
    const msg = formatConditionLifecycleMessage([], 180, 27, true);
    expect(msg).toContain('비활성');
    expect(msg).toContain('CONDITION_LIFECYCLE_DISABLED');
  });

  it('빈 reports → 📭 placeholder', () => {
    const msg = formatConditionLifecycleMessage([], 180, 27, false);
    expect(msg).toContain('📭');
    expect(msg).toContain('attributionRepo');
  });

  it('정상 reports — Top N + 요약 카운트', () => {
    const reports = [
      makeReport(1, 'normal', 0.10),
      makeReport(2, 'silent', 0.03),
      makeReport(3, 'deprecated', 0.005),
      makeReport(4, 'grace', 0.0, { activatedCount: 0, totalRecords: 0 }),
    ];
    const msg = formatConditionLifecycleMessage(reports, 180, 4, false);
    expect(msg).toContain('Status 요약');
    expect(msg).toContain('✅ normal: 1');
    expect(msg).toContain('🟠 silent: 1');
    expect(msg).toContain('❌ deprecated: 1');
    expect(msg).toContain('🟡 grace: 1');
  });

  it('은퇴 후보 (silent / deprecated) 별도 섹션', () => {
    const reports = [
      makeReport(1, 'normal', 0.10),
      makeReport(2, 'silent', 0.03),
      makeReport(3, 'deprecated', 0.005),
    ];
    const msg = formatConditionLifecycleMessage(reports, 180, 27, false);
    expect(msg).toContain('은퇴 후보');
    expect(msg).toContain('2건');
  });

  it('전부 normal → 은퇴 후보 섹션 없음', () => {
    const reports = [
      makeReport(1, 'normal', 0.10),
      makeReport(2, 'normal', 0.20),
    ];
    const msg = formatConditionLifecycleMessage(reports, 180, 27, false);
    expect(msg).not.toContain('은퇴 후보');
  });

  it('N 절삭 — 5 reports + N=2', () => {
    const reports = Array.from({ length: 5 }, (_, i) =>
      makeReport(i + 1, 'normal', 0.5 - i * 0.05),
    );
    const msg = formatConditionLifecycleMessage(reports, 180, 2, false);
    // Top 2/27 표기 + 첫 2개만 노출
    expect(msg).toContain('Top 2/27');
  });

  it('activationRate 내림차순 정렬', () => {
    const reports = [
      makeReport(1, 'normal', 0.05),
      makeReport(2, 'normal', 0.20),
      makeReport(3, 'normal', 0.10),
    ];
    const msg = formatConditionLifecycleMessage(reports, 180, 3, false);
    const idx2 = msg.indexOf('#2');
    const idx3 = msg.indexOf('#3');
    const idx1 = msg.indexOf('#1');
    expect(idx2).toBeLessThan(idx3);
    expect(idx3).toBeLessThan(idx1);
  });
});

describe('conditionLifecycle.cmd execute', () => {
  let replies: string[];

  beforeEach(() => {
    replies = [];
    mockedLoad.mockReset();
    delete process.env.CONDITION_LIFECYCLE_DISABLED;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CONDITION_LIFECYCLE_DISABLED;
  });

  it('정상 응답 — load + reply 호출', async () => {
    mockedLoad.mockReturnValue([]);
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/condition_lifecycle');
    expect(cmd).toBeDefined();
    await cmd!.execute({ args: ['27'], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('Condition Lifecycle');
  });

  it('alias /cl 도 동일 instance', () => {
    const cmd1 = commandRegistry.resolve('/condition_lifecycle');
    const cmd2 = commandRegistry.resolve('/cl');
    expect(cmd1).toBe(cmd2);
  });

  it('load throw 시 graceful', async () => {
    mockedLoad.mockImplementation(() => { throw new Error('disk fail'); });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/condition_lifecycle');
    await cmd!.execute({ args: [], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('❌');
  });

  it('메타데이터 — name + aliases + category + riskLevel + description', () => {
    const cmd = commandRegistry.resolve('/condition_lifecycle');
    expect(cmd!.name).toBe('/condition_lifecycle');
    expect(cmd!.aliases).toContain('/cl');
    expect(cmd!.category).toBe('LRN');
    expect(cmd!.riskLevel).toBe(0);
    expect(cmd!.visibility).toBe('ADMIN');
    expect(cmd!.description).toContain('lifecycle');
    expect(cmd!.usage).toBeDefined();
  });
});
