// @responsibility: deprecationReport 회귀 — 후보 0건/N건 포맷, 카테고리 그룹핑, Top 5 합성, 절삭(>30) 검증.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

import {
  collectDeprecationCandidates,
  formatDeprecationReport,
} from './deprecationReport.js';
import { __resetForTests, recordUsage, flushCommandUsage } from '../persistence/commandUsageRepo.js';
import * as paths from '../persistence/paths.js';

const TMP_FILE = path.join(os.tmpdir(), `deprecation-test-${Date.now()}.json`);

beforeAll(async () => {
  // 모든 명령어를 commandRegistry 에 등록 — collectDeprecationCandidates 가 .all() 사용.
  await import('./commands/system/index.js');
  await import('./commands/watchlist/index.js');
  await import('./commands/positions/index.js');
  await import('./commands/alert/index.js');
  await import('./commands/learning/index.js');
  await import('./commands/control/index.js');
  await import('./commands/trade/index.js');
  await import('./commands/infra/index.js');
});

beforeEach(() => {
  vi.spyOn(paths, 'COMMAND_USAGE_FILE', 'get').mockReturnValue(TMP_FILE);
  __resetForTests(TMP_FILE);
  if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
});

describe('collectDeprecationCandidates', () => {
  it('사용 이력 0건 → 모든 등록 명령어가 후보 (한 번도 사용 안 됨)', () => {
    const data = collectDeprecationCandidates(30);
    expect(data.totalRegistered).toBeGreaterThanOrEqual(51);
    expect(data.totalCandidates).toBe(data.totalRegistered);
    expect(data.candidates.every(c => c.daysSinceLastUse === null)).toBe(true);
  });

  it('일부 명령어를 30일 이내 사용 → 그 명령어는 후보 제외', () => {
    const now = Date.UTC(2026, 3, 25, 10, 0, 0);
    recordUsage('/status', now - 5 * 24 * 3_600_000);
    recordUsage('/pos', now - 10 * 24 * 3_600_000);
    flushCommandUsage();

    const data = collectDeprecationCandidates(30, now);
    const candidateNames = new Set(data.candidates.map(c => c.name));
    expect(candidateNames.has('/status')).toBe(false);
    expect(candidateNames.has('/pos')).toBe(false);
    // 나머지는 한 번도 사용 안 됨 → 후보 포함.
    expect(candidateNames.has('/buy')).toBe(true);
  });

  it('candidates 카테고리 필드가 commandRegistry SSOT 와 동기화', () => {
    const data = collectDeprecationCandidates(30);
    const buyCandidate = data.candidates.find(c => c.name === '/buy');
    expect(buyCandidate?.category).toBe('TRD');
    const pauseCandidate = data.candidates.find(c => c.name === '/pause');
    expect(pauseCandidate?.category).toBe('EMR');
  });
});

describe('formatDeprecationReport', () => {
  it('후보 0건 → "모든 명령어가 N일 내 사용" 안내 + Top 표시', () => {
    const msg = formatDeprecationReport({
      totalRegistered: 51,
      totalCandidates: 0,
      thresholdDays: 30,
      candidates: [],
      topUsage: [
        { name: '/status', count: 142 },
        { name: '/pos', count: 89 },
      ],
    });
    expect(msg).toContain('모든 명령어가 30일 내 사용');
    expect(msg).toContain('1. /status — 142회');
  });

  it('후보 N건 → 카테고리별 그룹 + 최대 30개 후보 라인 + Top 5 + footer', () => {
    const candidates = Array.from({ length: 35 }, (_, i) => ({
      name: `/cmd_${i}`,
      category: i % 2 === 0 ? 'ALR' : 'LRN',
      daysSinceLastUse: i === 0 ? null : 30 + i,
      lastUsedAt: i === 0 ? null : new Date().toISOString(),
    }));
    const msg = formatDeprecationReport({
      totalRegistered: 51,
      totalCandidates: 35,
      thresholdDays: 30,
      candidates,
      topUsage: [{ name: '/status', count: 100 }],
    });
    expect(msg).toContain('등록: 51개 | 후보: 35개');
    expect(msg).toContain('ALR: 18개');
    expect(msg).toContain('LRN: 17개');
    // 30개 절삭 + "외 5건" 안내.
    expect(msg).toContain('외 5건');
    expect(msg).toContain('한 번도 사용 안 됨');
    expect(msg).toContain('1. /status — 100회');
  });

  it('명령어 이름 HTML escape (& < > 엔티티)', () => {
    const msg = formatDeprecationReport({
      totalRegistered: 1,
      totalCandidates: 1,
      thresholdDays: 30,
      candidates: [
        {
          name: '/test<x>&y',
          category: 'TRD',
          daysSinceLastUse: 45,
          lastUsedAt: '2026-03-10T00:00:00Z',
        },
      ],
      topUsage: [],
    });
    expect(msg).toContain('/test&lt;x&gt;&amp;y');
    expect(msg).not.toContain('/test<x>&y'); // raw 노출 금지
  });
});
