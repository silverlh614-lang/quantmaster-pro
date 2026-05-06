/**
 * @responsibility bugCandidatesRepo 회귀 테스트 (PR #669~#674 후속 P3)
 *
 * 검증:
 *   - load: 부재 / 손상 / non-array fallback
 *   - save: atomic write tmp→rename
 *   - findBySignature / findById
 *   - generateCandidateId: NNN 순차 발급
 *   - buildSignature: tier::category::dedupeKey 정규화
 *   - updateCandidateStatus: review/dismiss/promote marker
 *   - TRIM_LIMIT 500 enforcement
 *   - 절대 규칙: BUG-CANDIDATE prefix (BUG_LEDGER 와 분리)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// PERSIST_DATA_DIR 격리 (missedLearningQueueRepo.test.ts 패턴 차용) — paths.ts 가
// 프로세스 시작 시 평가하므로 vi.resetModules 필요.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-cand-repo-'));
process.env.PERSIST_DATA_DIR = tmpDir;

let repo: typeof import('./bugCandidatesRepo.js');
let paths: typeof import('./paths.js');

beforeEach(async () => {
  vi.resetModules();
  repo = await import('./bugCandidatesRepo.js');
  paths = await import('./paths.js');
  // 각 테스트 시작 시 영속 파일 삭제
  try { fs.unlinkSync(paths.BUG_CANDIDATES_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(`${paths.BUG_CANDIDATES_FILE}.tmp`); } catch { /* ignore */ }
});

afterEach(() => {
  try { fs.unlinkSync(paths.BUG_CANDIDATES_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(`${paths.BUG_CANDIDATES_FILE}.tmp`); } catch { /* ignore */ }
});

function makeCandidate(id: string) {
  return {
    id,
    signature: 'T1_ALARM::test::',
    severity: 'P1_CANDIDATE' as const,
    category: 'test',
    dedupeKey: null,
    tier: 'T1_ALARM',
    occurrences: 1,
    firstSeenAt: '2026-05-07T00:00:00.000Z',
    lastSeenAt: '2026-05-07T00:00:00.000Z',
    status: 'NEW' as const,
    reviewedAt: null,
    reviewedBy: null,
    note: null,
  };
}

describe('bugCandidatesRepo — load / save', () => {
  it('파일 부재 시 빈 배열', () => {
    expect(repo.loadBugCandidates()).toEqual([]);
  });

  it('손상 JSON 시 빈 배열 fallback', () => {
    fs.writeFileSync(paths.BUG_CANDIDATES_FILE, '{not-json', 'utf-8');
    expect(repo.loadBugCandidates()).toEqual([]);
  });

  it('non-array JSON 시 빈 배열 fallback', () => {
    fs.writeFileSync(paths.BUG_CANDIDATES_FILE, '{"foo":1}', 'utf-8');
    expect(repo.loadBugCandidates()).toEqual([]);
  });

  it('잘못된 entry (id prefix 위반) 자동 필터', () => {
    const bad = [
      { id: 'INVALID-ID', signature: 'x', firstSeenAt: '2026-05-07T00:00Z', lastSeenAt: '2026-05-07T00:00Z', occurrences: 1, status: 'NEW' },
      { id: 'BUG-CANDIDATE-2026-05-07-001', signature: 'x', firstSeenAt: '2026-05-07T00:00Z', lastSeenAt: '2026-05-07T00:00Z', occurrences: 1, status: 'NEW' },
    ];
    fs.writeFileSync(paths.BUG_CANDIDATES_FILE, JSON.stringify(bad), 'utf-8');
    const loaded = repo.loadBugCandidates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('BUG-CANDIDATE-2026-05-07-001');
  });

  it('save round-trip', () => {
    const candidate = makeCandidate('BUG-CANDIDATE-2026-05-07-001');
    repo.saveBugCandidates([candidate]);
    const loaded = repo.loadBugCandidates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(candidate.id);
  });

  it('atomic write — .tmp 잔존 안 함', () => {
    repo.saveBugCandidates([makeCandidate('BUG-CANDIDATE-2026-05-07-001')]);
    expect(fs.existsSync(paths.BUG_CANDIDATES_FILE)).toBe(true);
    expect(fs.existsSync(`${paths.BUG_CANDIDATES_FILE}.tmp`)).toBe(false);
  });

  it('TRIM_LIMIT 500 — 초과 시 자동 절삭', () => {
    const many = Array.from({ length: 600 }, (_, i) =>
      makeCandidate(`BUG-CANDIDATE-2026-05-07-${String(i + 1).padStart(3, '0')}`)
    );
    repo.saveBugCandidates(many);
    const loaded = repo.loadBugCandidates();
    expect(loaded.length).toBeLessThanOrEqual(500);
    expect(repo.TRIM_LIMIT).toBe(500);
  });
});

describe('bugCandidatesRepo — generateCandidateId', () => {
  it('빈 기존 — NNN=001', () => {
    const id = repo.generateCandidateId(new Date('2026-05-07T00:00:00Z'), []);
    expect(id).toBe('BUG-CANDIDATE-2026-05-07-001');
  });

  it('동일 일자 기존 002 → NNN=003', () => {
    const existing = [
      makeCandidate('BUG-CANDIDATE-2026-05-07-001'),
      makeCandidate('BUG-CANDIDATE-2026-05-07-002'),
    ];
    const id = repo.generateCandidateId(new Date('2026-05-07T00:00:00Z'), existing);
    expect(id).toBe('BUG-CANDIDATE-2026-05-07-003');
  });

  it('다른 일자 — 첫 발급 NNN=001', () => {
    const existing = [makeCandidate('BUG-CANDIDATE-2026-05-06-005')];
    const id = repo.generateCandidateId(new Date('2026-05-07T00:00:00Z'), existing);
    expect(id).toBe('BUG-CANDIDATE-2026-05-07-001');
  });

  it('NNN max 추적 — 005 다음 006', () => {
    const existing = [
      makeCandidate('BUG-CANDIDATE-2026-05-07-001'),
      makeCandidate('BUG-CANDIDATE-2026-05-07-005'),
      makeCandidate('BUG-CANDIDATE-2026-05-07-003'),
    ];
    const id = repo.generateCandidateId(new Date('2026-05-07T00:00:00Z'), existing);
    expect(id).toBe('BUG-CANDIDATE-2026-05-07-006');
  });
});

describe('bugCandidatesRepo — buildSignature', () => {
  it('tier::category::dedupeKey 형식', () => {
    expect(repo.buildSignature('T1_ALARM', 'kill-switch', 'kill-switch:001')).toBe(
      'T1_ALARM::kill-switch::kill-switch:001'
    );
  });

  it('dedupeKey null → 빈 문자열', () => {
    expect(repo.buildSignature('T1_ALARM', 'kill-switch', null)).toBe(
      'T1_ALARM::kill-switch::'
    );
  });

  it('dedupeKey undefined → 빈 문자열', () => {
    expect(repo.buildSignature('T1_ALARM', 'kill-switch', undefined)).toBe(
      'T1_ALARM::kill-switch::'
    );
  });
});

describe('bugCandidatesRepo — findBySignature / findById', () => {
  it('findBySignature 매칭', () => {
    const c = makeCandidate('BUG-CANDIDATE-2026-05-07-001');
    c.signature = 'T1_ALARM::category-x::dk-x';
    expect(repo.findBySignature([c], 'T1_ALARM::category-x::dk-x')).toBe(c);
    expect(repo.findBySignature([c], 'unknown')).toBeUndefined();
  });

  it('findById 매칭', () => {
    const c = makeCandidate('BUG-CANDIDATE-2026-05-07-001');
    expect(repo.findById([c], 'BUG-CANDIDATE-2026-05-07-001')).toBe(c);
    expect(repo.findById([c], 'BUG-CANDIDATE-2099-01-01-999')).toBeUndefined();
  });
});

describe('bugCandidatesRepo — updateCandidateStatus', () => {
  it('NEW → REVIEWED + reviewedAt + reviewedBy', () => {
    const c = makeCandidate('BUG-CANDIDATE-2026-05-07-001');
    const updated = repo.updateCandidateStatus([c], 'BUG-CANDIDATE-2026-05-07-001', 'REVIEWED', {
      now: new Date('2026-05-08T00:00:00Z'),
      reviewedBy: 'telegram_operator',
      note: 'looks like real bug',
    });
    expect(updated[0].status).toBe('REVIEWED');
    expect(updated[0].reviewedAt).toBe('2026-05-08T00:00:00.000Z');
    expect(updated[0].reviewedBy).toBe('telegram_operator');
    expect(updated[0].note).toBe('looks like real bug');
  });

  it('NEW → DISMISSED + 사유 기록', () => {
    const c = makeCandidate('BUG-CANDIDATE-2026-05-07-001');
    const updated = repo.updateCandidateStatus([c], 'BUG-CANDIDATE-2026-05-07-001', 'DISMISSED', {
      now: new Date('2026-05-08T00:00:00Z'),
      reviewedBy: 'telegram_operator',
      note: 'transient KIS 401',
    });
    expect(updated[0].status).toBe('DISMISSED');
    expect(updated[0].note).toBe('transient KIS 401');
  });

  it('NEW → PROMOTED — marker 만 (자동 BUG_LEDGER 전사 0건)', () => {
    const c = makeCandidate('BUG-CANDIDATE-2026-05-07-001');
    const updated = repo.updateCandidateStatus([c], 'BUG-CANDIDATE-2026-05-07-001', 'PROMOTED', {
      now: new Date('2026-05-08T00:00:00Z'),
      reviewedBy: 'telegram_operator',
    });
    expect(updated[0].status).toBe('PROMOTED');
  });

  it('id 매칭 없음 — 변경 없음', () => {
    const c = makeCandidate('BUG-CANDIDATE-2026-05-07-001');
    const updated = repo.updateCandidateStatus([c], 'BUG-CANDIDATE-2099-01-01-999', 'DISMISSED', {
      now: new Date(),
      reviewedBy: 'telegram_operator',
    });
    expect(updated).toEqual([c]);
  });
});

describe('절대 규칙 — BUG_LEDGER 와 분리', () => {
  it('id prefix 는 BUG-CANDIDATE- (BUG- 아님)', () => {
    const id = repo.generateCandidateId(new Date('2026-05-07T00:00:00Z'), []);
    expect(id.startsWith('BUG-CANDIDATE-')).toBe(true);
    expect(id.startsWith('BUG-2026-')).toBe(false);
  });

  it('isValidCandidate — BUG- (BUG_LEDGER) 형식 ID 거부', () => {
    const wrongPrefix = [
      { id: 'BUG-2026-05-07-001', signature: 'x', firstSeenAt: '2026-05-07T00:00Z', lastSeenAt: '2026-05-07T00:00Z', occurrences: 1, status: 'NEW' },
    ];
    fs.writeFileSync(paths.BUG_CANDIDATES_FILE, JSON.stringify(wrongPrefix), 'utf-8');
    expect(repo.loadBugCandidates()).toEqual([]);
  });
});
