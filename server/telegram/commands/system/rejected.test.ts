// @responsibility rejected.cmd 회귀 테스트 — formatRejectedMessage + cmd execute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
import type { RejectionShadowEntry } from '../../../learning/rejectionShadowTracker.js';

vi.mock('../../../learning/rejectionShadowTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../learning/rejectionShadowTracker.js',
  );
  return {
    ...actual,
    getAllRejectionShadow: vi.fn(),
    summarizeRejectionShadow: vi.fn(),
  };
});

import * as repo from '../../../learning/rejectionShadowTracker.js';
import { formatRejectedMessage } from './rejected.cmd.js';
import './rejected.cmd.js';

const mockedAll = vi.mocked(repo.getAllRejectionShadow);
const mockedSummary = vi.mocked(repo.summarizeRejectionShadow);

function makeEntry(overrides: Partial<RejectionShadowEntry> = {}): RejectionShadowEntry {
  return {
    id: `r_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    signalDate: '2026-04-15',
    signalPriceKrw: 70000,
    gateScore: 16,
    scoreDelta: 2,
    rejectionReason: 'Gate 1 미달',
    trackUntil: '2026-04-22',
    currentReturnPct: 3,
    closed: true,
    ...overrides,
  };
}

const RELIABLE_SUMMARY = {
  totalCount: 10,
  closedCount: 8,
  activeCount: 2,
  avgClosedReturnPct: 2.5,
  medianClosedReturnPct: 1.0,
  falseNegativeRate: 0.25,
  quartiles: { q1: -1, q2: 1, q3: 5 },
  reliable: true,
};

const UNRELIABLE_SUMMARY = {
  totalCount: 3,
  closedCount: 2,
  activeCount: 1,
  avgClosedReturnPct: 0,
  medianClosedReturnPct: 0,
  falseNegativeRate: 0,
  quartiles: { q1: 0, q2: 0, q3: 0 },
  reliable: false,
};

describe('formatRejectedMessage', () => {
  it('빈 entries → 📭 placeholder', () => {
    const msg = formatRejectedMessage({ entries: [], summary: UNRELIABLE_SUMMARY, limit: 10 });
    expect(msg).toContain('📭');
    expect(msg).toContain('Gate 14~17');
  });

  it('통계 reliable=true → false negative rate 표시', () => {
    const entries = [
      makeEntry({ closed: true, currentReturnPct: 7 }),
      makeEntry({ closed: true, currentReturnPct: 1 }),
    ];
    const msg = formatRejectedMessage({ entries, summary: RELIABLE_SUMMARY, limit: 10 });
    expect(msg).toContain('Alpha 누락');
    expect(msg).toContain('25.0%');
    expect(msg).toContain('분위수');
  });

  it('통계 reliable=false → 표본 부족 메시지', () => {
    const entries = [makeEntry()];
    const msg = formatRejectedMessage({ entries, summary: UNRELIABLE_SUMMARY, limit: 10 });
    expect(msg).toContain('표본 부족');
    expect(msg).not.toContain('Alpha 누락');
  });

  it('종결 entry 수익률 내림차순 + 이모지 분류 🔥/🟢/🔵', () => {
    const entries = [
      makeEntry({ stockName: 'A', currentReturnPct: 8, closed: true }),  // 🔥
      makeEntry({ stockName: 'B', currentReturnPct: 2, closed: true }),  // 🟢
      makeEntry({ stockName: 'C', currentReturnPct: -3, closed: true }), // 🔵
    ];
    const msg = formatRejectedMessage({ entries, summary: RELIABLE_SUMMARY, limit: 10 });
    expect(msg).toContain('🔥');
    expect(msg).toContain('🟢');
    expect(msg).toContain('🔵');
    const idxA = msg.indexOf('A');
    const idxB = msg.indexOf('B');
    const idxC = msg.indexOf('C');
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  it('limit N=2 절삭', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ stockName: `T${i}`, currentReturnPct: 5 - i, closed: true }),
    );
    const msg = formatRejectedMessage({ entries, summary: RELIABLE_SUMMARY, limit: 2 });
    expect(msg).toContain('Top 2');
    expect(msg).toContain('T0');
    expect(msg).toContain('T1');
    expect(msg).not.toContain('T2');
  });

  it('활성 entry 별도 섹션', () => {
    const entries = [
      makeEntry({ stockName: 'C', currentReturnPct: 5, closed: true }),
      makeEntry({ stockName: 'A1', currentReturnPct: 2, closed: false }),
    ];
    const msg = formatRejectedMessage({ entries, summary: RELIABLE_SUMMARY, limit: 10 });
    expect(msg).toContain('활성 추적 중');
    expect(msg).toContain('A1');
  });
});

describe('rejected.cmd execute', () => {
  let replies: string[];

  beforeEach(() => {
    replies = [];
    mockedAll.mockReset();
    mockedSummary.mockReset();
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('정상 응답 — load + reply', async () => {
    mockedAll.mockReturnValue([]);
    mockedSummary.mockReturnValue(UNRELIABLE_SUMMARY);
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/rejected');
    expect(cmd).toBeDefined();
    await cmd!.execute({ args: ['10'], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('Rejected Alpha Tracker');
  });

  it('alias /rejection_shadow 도 동일 instance', () => {
    const cmd1 = commandRegistry.resolve('/rejected');
    const cmd2 = commandRegistry.resolve('/rejection_shadow');
    expect(cmd1).toBe(cmd2);
  });

  it('throw 시 graceful', async () => {
    mockedAll.mockImplementation(() => { throw new Error('disk fail'); });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/rejected');
    await cmd!.execute({ args: [], reply });
    expect(replies[0]).toContain('❌');
  });

  it('메타데이터', () => {
    const cmd = commandRegistry.resolve('/rejected');
    expect(cmd!.name).toBe('/rejected');
    expect(cmd!.aliases).toContain('/rejection_shadow');
    expect(cmd!.category).toBe('LRN');
    expect(cmd!.riskLevel).toBe(0);
    expect(cmd!.visibility).toBe('ADMIN');
  });
});
