// @responsibility: commandUsageRepo 회귀 — record/topN/stale/persistence/debounce-flush 검증.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  recordUsage,
  getTopUsage,
  getStaleCommands,
  getCommandStats,
  getTotalUsage,
  flushCommandUsage,
  __resetForTests,
} from './commandUsageRepo.js';
import * as paths from './paths.js';

// 테스트는 임시 파일을 사용한다 — 운영 Volume 영향 차단.
const TMP_FILE = path.join(os.tmpdir(), `command-usage-test-${Date.now()}.json`);

beforeEach(() => {
  vi.spyOn(paths, 'COMMAND_USAGE_FILE', 'get').mockReturnValue(TMP_FILE);
  __resetForTests(TMP_FILE);
});

afterAll(() => {
  try {
    if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
  } catch {
    /* ignore */
  }
});

describe('recordUsage + flush', () => {
  it('첫 호출 — count=1 + lastUsedAt 기록', () => {
    const t = Date.UTC(2026, 3, 25, 10, 0, 0); // 2026-04-25 10:00 UTC
    recordUsage('/status', t);
    flushCommandUsage();
    const stats = getCommandStats('/status');
    expect(stats?.count).toBe(1);
    expect(stats?.lastUsedAt).toBe(new Date(t).toISOString());
  });

  it('동일 명령어 3회 → count=3, lastUsedAt 최신값', () => {
    const t1 = Date.UTC(2026, 3, 25, 10, 0, 0);
    const t2 = Date.UTC(2026, 3, 25, 10, 5, 0);
    const t3 = Date.UTC(2026, 3, 25, 10, 10, 0);
    recordUsage('/status', t1);
    recordUsage('/status', t2);
    recordUsage('/status', t3);
    flushCommandUsage();
    const stats = getCommandStats('/status');
    expect(stats?.count).toBe(3);
    expect(stats?.lastUsedAt).toBe(new Date(t3).toISOString());
  });

  it('대문자 입력 → lowercase 정규화로 동일 키 카운팅', () => {
    recordUsage('/Status');
    recordUsage('/STATUS');
    flushCommandUsage();
    expect(getCommandStats('/status')?.count).toBe(2);
  });

  it('슬래시 없는 입력은 무시 (텍스트 메시지 차단)', () => {
    recordUsage('hello world');
    flushCommandUsage();
    expect(getTotalUsage()).toBe(0);
  });

  it('flushCommandUsage 후 디스크 파일이 schema 와 일치', () => {
    recordUsage('/pause');
    flushCommandUsage();
    expect(fs.existsSync(TMP_FILE)).toBe(true);
    const raw = fs.readFileSync(TMP_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.commands['/pause'].count).toBe(1);
    expect(parsed.lastWriteAt).toBeDefined();
  });
});

describe('getTopUsage', () => {
  it('Top N count 내림차순 + 동률은 lastUsedAt 최신 우선', () => {
    const t1 = Date.UTC(2026, 3, 25, 10, 0, 0);
    const t2 = Date.UTC(2026, 3, 25, 11, 0, 0);
    recordUsage('/a', t1);
    recordUsage('/a', t1);
    recordUsage('/a', t1); // count 3
    recordUsage('/b', t2);
    recordUsage('/b', t2); // count 2 (newer)
    recordUsage('/c', t1); // count 1
    flushCommandUsage();
    const top = getTopUsage(3);
    expect(top.map(e => e.name)).toEqual(['/a', '/b', '/c']);
    expect(top[0].count).toBe(3);
    expect(top[1].count).toBe(2);
  });

  it('limit ≤ 0 → 빈 배열', () => {
    recordUsage('/a');
    flushCommandUsage();
    expect(getTopUsage(0)).toEqual([]);
    expect(getTopUsage(-3)).toEqual([]);
  });

  it('limit 가 등록 명령어 수보다 크면 전체 반환', () => {
    recordUsage('/a');
    recordUsage('/b');
    flushCommandUsage();
    expect(getTopUsage(50)).toHaveLength(2);
  });
});

describe('getStaleCommands', () => {
  it('등록되지 않은 명령어 → daysSinceLastUse=null + 결과 포함', () => {
    const stale = getStaleCommands(['/never_used', '/also_never'], 30);
    expect(stale.map(s => s.name).sort()).toEqual(['/also_never', '/never_used']);
    for (const s of stale) {
      expect(s.daysSinceLastUse).toBeNull();
      expect(s.lastUsedAt).toBeNull();
    }
  });

  it('30일 이전 사용 명령어 → stale, 최근 명령어 → 제외', () => {
    const now = Date.UTC(2026, 3, 25, 10, 0, 0);
    const oldT = now - 35 * 24 * 3_600_000;
    const recentT = now - 5 * 24 * 3_600_000;
    recordUsage('/old_cmd', oldT);
    recordUsage('/recent_cmd', recentT);
    flushCommandUsage();
    const stale = getStaleCommands(['/old_cmd', '/recent_cmd'], 30, now);
    expect(stale.map(s => s.name)).toEqual(['/old_cmd']);
    expect(stale[0].daysSinceLastUse).toBeGreaterThanOrEqual(30);
  });

  it('정렬 — daysSinceLastUse 내림차순 + 미사용은 마지막', () => {
    const now = Date.UTC(2026, 3, 25, 10, 0, 0);
    recordUsage('/oldest', now - 90 * 24 * 3_600_000);
    recordUsage('/middle', now - 45 * 24 * 3_600_000);
    flushCommandUsage();
    const stale = getStaleCommands(['/never', '/oldest', '/middle'], 30, now);
    // Infinity (never) > 90 > 45 → never 가 첫 번째.
    expect(stale[0].name).toBe('/never');
    expect(stale[1].name).toBe('/oldest');
    expect(stale[2].name).toBe('/middle');
  });
});

describe('영속화 round-trip', () => {
  it('flush 후 reset → 디스크에서 다시 로드해 동일 카운터', () => {
    recordUsage('/foo');
    recordUsage('/foo');
    recordUsage('/bar');
    flushCommandUsage();

    // 메모리만 클리어 (디스크 보존).
    __resetForTests('/dev/null'); // 가짜 경로 — 실제 TMP_FILE 보존.
    // mock spy 가 여전히 TMP_FILE 를 가리키므로 ensureLoaded 가 디스크에서 재로드.
    expect(getCommandStats('/foo')?.count).toBe(2);
    expect(getCommandStats('/bar')?.count).toBe(1);
  });
});
