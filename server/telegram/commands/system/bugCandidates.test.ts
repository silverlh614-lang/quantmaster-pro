/**
 * @responsibility bugCandidates.cmd 회귀 테스트 (PR #669~#674 후속 P3)
 *
 * 검증:
 *   - parseBugCandidatesArgs: list / review / dismiss / promote / 옵션 파싱
 *   - formatCandidatesListMessage: 빈 / 정상 / 필터 / Top N / status 우선순위
 *   - command 등록 메타데이터
 *   - 절대 규칙: KIS import 0건, BUG_LEDGER 자동 전사 0건
 */

import { describe, it, expect } from 'vitest';
import {
  parseBugCandidatesArgs,
  formatCandidatesListMessage,
} from './bugCandidates.cmd.js';
import bugCandidates from './bugCandidates.cmd.js';
import type { BugCandidate, BugCandidateStatus, BugCandidateSeverity } from '../../../persistence/bugCandidatesRepo.js';

function candidate(overrides: Partial<BugCandidate> = {}): BugCandidate {
  return {
    id: 'BUG-CANDIDATE-2026-05-07-001',
    signature: 'T1_ALARM::test::dk',
    severity: 'P0_CANDIDATE',
    category: 'kill-switch-downgrade',
    dedupeKey: 'kill-switch-downgrade',
    tier: 'T1_ALARM',
    occurrences: 5,
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-07T00:00:00.000Z',
    status: 'NEW',
    reviewedAt: null,
    reviewedBy: null,
    note: null,
    ...overrides,
  };
}

describe('parseBugCandidatesArgs', () => {
  it('빈 인자 — action=list, limit=10', () => {
    const r = parseBugCandidatesArgs([]);
    expect(r.action).toBe('list');
    expect(r.limit).toBe(10);
    expect(r.filter).toBeUndefined();
  });

  it('filter 만 지정 — action=list, filter=p0', () => {
    const r = parseBugCandidatesArgs(['p0']);
    expect(r.action).toBe('list');
    expect(r.filter).toBe('p0');
  });

  it('limit 만 지정 — list 5', () => {
    const r = parseBugCandidatesArgs(['5']);
    expect(r.action).toBe('list');
    expect(r.limit).toBe(5);
  });

  it('list + filter + limit', () => {
    const r = parseBugCandidatesArgs(['list', 'p0', '5']);
    expect(r.action).toBe('list');
    expect(r.filter).toBe('p0');
    expect(r.limit).toBe(5);
  });

  it('review + id', () => {
    const r = parseBugCandidatesArgs(['review', 'BUG-CANDIDATE-2026-05-07-001']);
    expect(r.action).toBe('review');
    expect(r.targetId).toBe('BUG-CANDIDATE-2026-05-07-001');
  });

  it('dismiss + id + 사유', () => {
    const r = parseBugCandidatesArgs(['dismiss', 'BUG-CANDIDATE-2026-05-07-001', 'transient', 'KIS', '401']);
    expect(r.action).toBe('dismiss');
    expect(r.targetId).toBe('BUG-CANDIDATE-2026-05-07-001');
    expect(r.note).toBe('transient KIS 401');
  });

  it('promote + id', () => {
    const r = parseBugCandidatesArgs(['promote', 'BUG-CANDIDATE-2026-05-07-001']);
    expect(r.action).toBe('promote');
    expect(r.targetId).toBe('BUG-CANDIDATE-2026-05-07-001');
    expect(r.note).toBeUndefined();
  });

  it('limit 상한 30', () => {
    const r = parseBugCandidatesArgs(['100']);
    expect(r.limit).toBe(30);
  });

  it('알 수 없는 토큰 — list 로 fallback + 무시', () => {
    const r = parseBugCandidatesArgs(['unknown']);
    expect(r.action).toBe('list');
    expect(r.filter).toBeUndefined();
  });

  it('status 필터 (new/reviewed/dismissed/promoted)', () => {
    expect(parseBugCandidatesArgs(['new']).filter).toBe('new');
    expect(parseBugCandidatesArgs(['REVIEWED']).filter).toBe('reviewed');
    expect(parseBugCandidatesArgs(['dismissed']).filter).toBe('dismissed');
    expect(parseBugCandidatesArgs(['promoted']).filter).toBe('promoted');
  });
});

describe('formatCandidatesListMessage', () => {
  it('빈 candidates — 안내 메시지', () => {
    const msg = formatCandidatesListMessage([], { action: 'list', limit: 10 });
    expect(msg).toContain('등록된 후보 없음');
    expect(msg).toContain('BUG_CANDIDATE_DETECTOR_ENABLED=true');
    expect(msg).toContain('cron');
  });

  it('정상 1건 — status/severity 분포 + 라인', () => {
    const msg = formatCandidatesListMessage([candidate()], { action: 'list', limit: 10 });
    expect(msg).toContain('총 1건');
    expect(msg).toMatch(/NEW=1/);
    expect(msg).toContain('BUG-CANDIDATE-2026-05-07-001');
    expect(msg).toContain('kill-switch-downgrade');
    expect(msg).toContain('5회');
  });

  it('Top N 절삭', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      candidate({ id: `BUG-CANDIDATE-2026-05-07-${String(i + 1).padStart(3, '0')}` })
    );
    const msg = formatCandidatesListMessage(many, { action: 'list', limit: 5 });
    expect(msg).toContain('Top 5/15');
    expect(msg).toContain('외 10건');
  });

  it('필터 — P0 만', () => {
    const items: BugCandidate[] = [
      candidate({ id: 'BUG-CANDIDATE-2026-05-07-001', severity: 'P0_CANDIDATE' }),
      candidate({ id: 'BUG-CANDIDATE-2026-05-07-002', severity: 'P1_CANDIDATE' }),
    ];
    const msg = formatCandidatesListMessage(items, { action: 'list', filter: 'p0', limit: 10 });
    expect(msg).toContain('P0');
    expect(msg).toContain('→ 1건');
    expect(msg).toContain('BUG-CANDIDATE-2026-05-07-001');
    expect(msg).not.toContain('BUG-CANDIDATE-2026-05-07-002');
  });

  it('필터 — NEW 만', () => {
    const items: BugCandidate[] = [
      candidate({ id: 'BUG-CANDIDATE-2026-05-07-001', status: 'NEW' }),
      candidate({ id: 'BUG-CANDIDATE-2026-05-07-002', status: 'DISMISSED' }),
    ];
    const msg = formatCandidatesListMessage(items, { action: 'list', filter: 'new', limit: 10 });
    expect(msg).toContain('→ 1건');
    expect(msg).toContain('BUG-CANDIDATE-2026-05-07-001');
  });

  it('정렬 — NEW P0 가 DISMISSED P0 보다 먼저', () => {
    const dismissed = candidate({ id: 'BUG-CANDIDATE-2026-05-07-001', status: 'DISMISSED' });
    const newer = candidate({ id: 'BUG-CANDIDATE-2026-05-07-002', status: 'NEW' });
    const msg = formatCandidatesListMessage([dismissed, newer], { action: 'list', limit: 10 });
    const newerIdx = msg.indexOf('BUG-CANDIDATE-2026-05-07-002');
    const dismissedIdx = msg.indexOf('BUG-CANDIDATE-2026-05-07-001');
    expect(newerIdx).toBeGreaterThan(0);
    expect(dismissedIdx).toBeGreaterThan(0);
    expect(newerIdx).toBeLessThan(dismissedIdx);
  });

  it('promote 안내 — 자동 BUG_LEDGER 전사 영구 금지 명시', () => {
    const msg = formatCandidatesListMessage([candidate()], { action: 'list', limit: 10 });
    expect(msg).toContain('promote');
    expect(msg).toContain('자동 전사 영구 금지');
  });

  it('명령 안내 — review/dismiss/promote 3가지', () => {
    const msg = formatCandidatesListMessage([candidate()], { action: 'list', limit: 10 });
    expect(msg).toContain('/bug_candidates review');
    expect(msg).toContain('/bug_candidates dismiss');
    expect(msg).toContain('/bug_candidates promote');
  });

  it('HTML escape — category', () => {
    const c = candidate({ category: 'cat<script>' });
    const msg = formatCandidatesListMessage([c], { action: 'list', limit: 10 });
    expect(msg).toContain('cat&lt;script&gt;');
  });
});

describe('bugCandidates command 등록', () => {
  it('name + aliases', () => {
    expect(bugCandidates.name).toBe('/bug_candidates');
    expect(bugCandidates.aliases).toContain('/bugcands');
  });

  it('category SYS, riskLevel 0, ADMIN', () => {
    expect(bugCandidates.category).toBe('SYS');
    expect(bugCandidates.riskLevel).toBe(0);
    expect(bugCandidates.visibility).toBe('ADMIN');
  });

  it('description + usage 노출', () => {
    expect(bugCandidates.description.length).toBeGreaterThan(0);
    expect(bugCandidates.usage).toContain('/bug_candidates');
  });
});

describe('절대 규칙 — KIS 0건 + BUG_LEDGER 자동 전사 0건', () => {
  it('cmd module 은 KIS 주문 함수 import 0건 (정적 검증)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const cmdSource = fs.readFileSync(
      path.join(__dirname, 'bugCandidates.cmd.ts'),
      'utf-8',
    );
    expect(cmdSource).not.toMatch(/placeKis(Market|Sell|Buy|StopLoss|TakeProfit)Order/);
    expect(cmdSource).not.toMatch(/cancelKisOrder/);
  });

  it('cmd module 은 bugLedgerRepo import 0건 (자동 전사 차단)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const cmdSource = fs.readFileSync(
      path.join(__dirname, 'bugCandidates.cmd.ts'),
      'utf-8',
    );
    expect(cmdSource).not.toMatch(/from ['"][^'"]*bugLedgerRepo/);
    expect(cmdSource).not.toMatch(/loadBugLedger/);
  });

  it('promote 액션 응답 — 운영자 수동 전사 의무 명시', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const cmdSource = fs.readFileSync(
      path.join(__dirname, 'bugCandidates.cmd.ts'),
      'utf-8',
    );
    expect(cmdSource).toContain('수동 전사');
    expect(cmdSource).toContain('자동 전사는 영구 금지');
  });
});
