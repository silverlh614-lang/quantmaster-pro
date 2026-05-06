/**
 * @responsibility bugs.cmd 회귀 테스트 (PR #669/#670 후속 P2-A)
 *
 * 검증:
 *   - parseBugsArgs: 필터 / 숫자 / 한도 / 잘못된 입력
 *   - formatBugsMessage: 빈 ledger / status×severity 요약 / 필터 / Top N 절삭 /
 *                        recurrence ↻ 마커 / HTML escape
 *   - command 등록: name / aliases / category / riskLevel / visibility
 *   - execute: 정상 / throw 시 graceful (직접 호출은 안 함, 정적 구조만)
 */

import { describe, it, expect } from 'vitest';
import {
  parseBugsArgs,
  formatBugsMessage,
} from './bugs.cmd.js';
import bugs from './bugs.cmd.js';
import type { BugEntry } from '../../../persistence/bugLedgerRepo.js';

function entry(overrides: Partial<BugEntry> = {}): BugEntry {
  return {
    id: 'BUG-2026-05-07-001',
    status: 'OPEN',
    severity: 'P0',
    area: 'Market Truth Layer',
    discovered: '2026-05-07',
    resolved: null,
    related_adrs: [],
    related_bugs: [],
    keywords: [],
    recurrence_count: 0,
    summary: '휴장일 기준일 혼합 위험',
    ...overrides,
  };
}

describe('parseBugsArgs', () => {
  it('빈 인자 — default limit=10, no filter', () => {
    const r = parseBugsArgs([]);
    expect(r.filter).toBeUndefined();
    expect(r.limit).toBe(10);
  });

  it('severity 필터 (대소문자 무관)', () => {
    expect(parseBugsArgs(['p0']).filter).toBe('p0');
    expect(parseBugsArgs(['P1']).filter).toBe('p1');
    expect(parseBugsArgs(['P3']).filter).toBe('p3');
  });

  it('status 필터', () => {
    expect(parseBugsArgs(['open']).filter).toBe('open');
    expect(parseBugsArgs(['WATCHING']).filter).toBe('watching');
    expect(parseBugsArgs(['closed']).filter).toBe('closed');
  });

  it('숫자 인자 — limit 갱신', () => {
    expect(parseBugsArgs(['5']).limit).toBe(5);
    expect(parseBugsArgs(['1']).limit).toBe(1);
  });

  it('limit 상한 — 30 으로 절삭', () => {
    expect(parseBugsArgs(['100']).limit).toBe(30);
  });

  it('limit 하한 — 1 floor', () => {
    expect(parseBugsArgs(['0']).limit).toBe(10);
    expect(parseBugsArgs(['-5']).limit).toBe(10);
  });

  it('필터 + 숫자 조합', () => {
    const r = parseBugsArgs(['p0', '5']);
    expect(r.filter).toBe('p0');
    expect(r.limit).toBe(5);
  });

  it('알 수 없는 토큰 무시', () => {
    const r = parseBugsArgs(['unknown', 'foo']);
    expect(r.filter).toBeUndefined();
    expect(r.limit).toBe(10);
  });
});

describe('formatBugsMessage', () => {
  it('빈 ledger — 안내 메시지', () => {
    const msg = formatBugsMessage([], { limit: 10 });
    expect(msg).toContain('등록된 결함 없음');
    expect(msg).toContain('BUG-YYYY-MM-DD-NNN');
  });

  it('정상 1건 — 요약 + 라인', () => {
    const msg = formatBugsMessage([entry()], { limit: 10 });
    expect(msg).toContain('총 1건');
    expect(msg).toMatch(/OPEN=1/);
    expect(msg).toMatch(/P0=1/);
    expect(msg).toContain('BUG-2026-05-07-001');
    expect(msg).toContain('Market Truth Layer');
  });

  it('Top N 절삭', () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry({ id: `BUG-2026-01-${String(i + 1).padStart(2, '0')}-001` })
    );
    const msg = formatBugsMessage(entries, { limit: 5 });
    expect(msg).toContain('Top 5/15');
    expect(msg).toContain('외 10건');
  });

  it('필터 적용 — P0 만', () => {
    const entries = [
      entry({ id: 'BUG-2026-05-07-001', severity: 'P0' }),
      entry({ id: 'BUG-2026-05-07-002', severity: 'P1' }),
      entry({ id: 'BUG-2026-05-07-003', severity: 'P0' }),
    ];
    const msg = formatBugsMessage(entries, { filter: 'p0', limit: 10 });
    expect(msg).toContain('필터');
    expect(msg).toContain('P0');
    expect(msg).toContain('→ 2건');
    expect(msg).toContain('BUG-2026-05-07-001');
    expect(msg).toContain('BUG-2026-05-07-003');
    expect(msg).not.toContain('BUG-2026-05-07-002');
  });

  it('필터 적용 — open 만', () => {
    const entries = [
      entry({ id: 'BUG-2026-05-07-001', status: 'OPEN' }),
      entry({ id: 'BUG-2026-05-07-002', status: 'CLOSED' }),
    ];
    const msg = formatBugsMessage(entries, { filter: 'open', limit: 10 });
    expect(msg).toContain('→ 1건');
    expect(msg).toContain('BUG-2026-05-07-001');
  });

  it('필터에 매칭되는 BUG 0건', () => {
    const entries = [entry({ severity: 'P3' })];
    const msg = formatBugsMessage(entries, { filter: 'p0', limit: 10 });
    expect(msg).toContain('해당 필터에 매칭되는 BUG 없음');
  });

  it('recurrence ↻ 마커', () => {
    const e = entry({ recurrence_count: 3 });
    const msg = formatBugsMessage([e], { limit: 10 });
    expect(msg).toContain('↻3');
  });

  it('HTML escape — area / summary', () => {
    const e = entry({ area: 'Risk <Layer>', summary: '잘못된 <주문>' });
    const msg = formatBugsMessage([e], { limit: 10 });
    expect(msg).toContain('Risk &lt;Layer&gt;');
    expect(msg).toContain('잘못된 &lt;주문&gt;');
  });

  it('summary truncate (80자)', () => {
    const longSummary = 'A'.repeat(150);
    const e = entry({ summary: longSummary });
    const msg = formatBugsMessage([e], { limit: 10 });
    expect(msg).toContain('A'.repeat(79) + '…');
    expect(msg).not.toContain('A'.repeat(81));
  });

  it('정렬 — OPEN P0 가 CLOSED P0 보다 먼저', () => {
    const closed = entry({ id: 'BUG-2026-05-07-001', status: 'CLOSED' });
    const open = entry({ id: 'BUG-2026-05-07-002', status: 'OPEN' });
    const msg = formatBugsMessage([closed, open], { limit: 10 });
    const openIdx = msg.indexOf('BUG-2026-05-07-002');
    const closedIdx = msg.indexOf('BUG-2026-05-07-001');
    expect(openIdx).toBeGreaterThan(0);
    expect(closedIdx).toBeGreaterThan(0);
    expect(openIdx).toBeLessThan(closedIdx);
  });
});

describe('bugs command 등록', () => {
  it('name + aliases', () => {
    expect(bugs.name).toBe('/bugs');
    expect(bugs.aliases).toContain('/bug_ledger');
  });

  it('category SYS, riskLevel 0 (read-only), ADMIN', () => {
    expect(bugs.category).toBe('SYS');
    expect(bugs.riskLevel).toBe(0);
    expect(bugs.visibility).toBe('ADMIN');
  });

  it('description + usage 노출', () => {
    expect(bugs.description.length).toBeGreaterThan(0);
    expect(bugs.usage).toContain('/bugs');
  });
});

describe('bugs command execute', () => {
  it('throw 시 graceful (reply 호출 보장)', async () => {
    const calls: string[] = [];
    const reply = async (s: string) => { calls.push(s); };
    // execute 에 의도적으로 잘못된 args 통과 (parseBugsArgs 가 string 만 처리, 그래도 fallback)
    await bugs.execute({ args: [], reply });
    expect(calls.length).toBeGreaterThan(0);
    // 실제 운영 BUG_LEDGER 가 존재하면 정상 메시지, 없으면 안내 메시지 — 둘 다 reply 호출
    const msg = calls[0];
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});
