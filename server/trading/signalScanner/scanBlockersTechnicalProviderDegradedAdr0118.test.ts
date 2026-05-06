// @responsibility ADR-0118 §"진단 추정" 확장 — TECHNICAL_PROVIDER_DEGRADED 운영자 노출 회귀
/**
 * 사용자 명시 PR A — `/scan_blockers` 에 ADR-0411 의 `technicalProviderDegraded`
 * 마커 종목을 운영자가 즉시 인지 가능하도록 표면화.
 *
 * 검증:
 *   - isScanBlockersProviderDegradedDisabled ENV 정확 비교 (ADR-0157)
 *   - formatTechnicalProviderDegradedSection 안전 invariant (정렬 / Top N / fallback)
 *   - section content (ADR-0411 reference / WATCHLIST_HOLD 영향)
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  formatTechnicalProviderDegradedSection,
  isScanBlockersProviderDegradedDisabled,
} from './scanDiagnostics.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';

function makeEntry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    code: '005930',
    name: '삼성전자',
    entryPrice: 70000,
    stopLoss: 64400,
    targetPrice: 84000,
    addedAt: '2026-05-01T09:00:00.000Z',
    addedBy: 'AUTO',
    ...overrides,
  };
}

function makeDegraded(
  code: string,
  name: string,
  degradedAtIso: string | undefined,
  addedAtIso = '2026-05-01T09:00:00.000Z',
): WatchlistEntry {
  return makeEntry({
    code,
    name,
    addedAt: addedAtIso,
    technicalProviderDegraded: true,
    ...(degradedAtIso !== undefined ? { technicalProviderDegradedAt: degradedAtIso } : {}),
  });
}

describe('isScanBlockersProviderDegradedDisabled — ADR-0157 정확 비교', () => {
  const KEY = 'SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('default (env 미설정) → false', () => {
    delete process.env[KEY];
    expect(isScanBlockersProviderDegradedDisabled()).toBe(false);
  });

  it('"true" → true', () => {
    process.env[KEY] = 'true';
    expect(isScanBlockersProviderDegradedDisabled()).toBe(true);
  });

  it('"1" → false (정확 비교)', () => {
    process.env[KEY] = '1';
    expect(isScanBlockersProviderDegradedDisabled()).toBe(false);
  });

  it('"TRUE" → false (정확 비교)', () => {
    process.env[KEY] = 'TRUE';
    expect(isScanBlockersProviderDegradedDisabled()).toBe(false);
  });

  it('"false" → false', () => {
    process.env[KEY] = 'false';
    expect(isScanBlockersProviderDegradedDisabled()).toBe(false);
  });

  it('"" (빈 문자열) → false', () => {
    process.env[KEY] = '';
    expect(isScanBlockersProviderDegradedDisabled()).toBe(false);
  });
});

describe('formatTechnicalProviderDegradedSection — null 반환 분기', () => {
  const KEY = 'SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED';
  const original = process.env[KEY];

  beforeEach(() => {
    delete process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('빈 entries → null', () => {
    expect(formatTechnicalProviderDegradedSection([])).toBeNull();
  });

  it('degraded 종목 0건 → null', () => {
    const entries = [makeEntry({ code: '005930' }), makeEntry({ code: '035420' })];
    expect(formatTechnicalProviderDegradedSection(entries)).toBeNull();
  });

  it('ENV disabled → 1 degraded 있어도 null', () => {
    process.env[KEY] = 'true';
    const entries = [makeDegraded('005930', '삼성전자', '2026-05-06T09:23:00.000Z')];
    expect(formatTechnicalProviderDegradedSection(entries)).toBeNull();
  });

  it('technicalProviderDegraded=false 명시 entries → null', () => {
    const entries = [
      makeEntry({ code: '005930', technicalProviderDegraded: false }),
    ];
    expect(formatTechnicalProviderDegradedSection(entries)).toBeNull();
  });
});

describe('formatTechnicalProviderDegradedSection — 정상 출력', () => {
  it('1 degraded entry → 섹션 헤더 + 1줄 + 영향', () => {
    const entries = [makeDegraded('005930', '삼성전자', '2026-05-06T09:23:00.000Z')];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).not.toBeNull();
    expect(out).toContain('기술 데이터 PROVIDER_DEGRADED');
    expect(out).toContain('대상 1개');
    expect(out).toContain('005930 삼성전자');
    expect(out).toContain('영향:');
    expect(out).toContain('WATCHLIST_HOLD');
    expect(out).toContain('학습 데이터 계속 수집');
    expect(out).toContain('ADR-0411');
    expect(out).not.toContain('Top'); // 1개라 Top N 라벨 미노출
    expect(out).not.toContain('외 ');
  });

  it('5 degraded entries → 5개 모두 표시, "외 N개" 미노출', () => {
    const entries = [
      makeDegraded('005930', '삼성전자',   '2026-05-06T09:23:00.000Z'),
      makeDegraded('035420', '네이버',     '2026-05-06T09:24:00.000Z'),
      makeDegraded('000660', 'SK하이닉스', '2026-05-06T09:25:00.000Z'),
      makeDegraded('035720', '카카오',     '2026-05-06T09:26:00.000Z'),
      makeDegraded('005490', 'POSCO',      '2026-05-06T09:27:00.000Z'),
    ];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).not.toBeNull();
    expect(out).toContain('대상 5개');
    expect(out).not.toContain('Top'); // 정확히 5개라 Top N 라벨 미노출
    expect(out).not.toContain('외 ');
    for (const e of entries) {
      expect(out).toContain(`${e.code} ${e.name}`);
    }
  });

  it('6 degraded entries → Top 5 + "외 1개"', () => {
    const entries = [
      makeDegraded('A00001', 'A1', '2026-05-06T09:21:00.000Z'),
      makeDegraded('A00002', 'A2', '2026-05-06T09:22:00.000Z'),
      makeDegraded('A00003', 'A3', '2026-05-06T09:23:00.000Z'),
      makeDegraded('A00004', 'A4', '2026-05-06T09:24:00.000Z'),
      makeDegraded('A00005', 'A5', '2026-05-06T09:25:00.000Z'),
      makeDegraded('A00006', 'A6', '2026-05-06T09:26:00.000Z'),
    ];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).not.toBeNull();
    expect(out).toContain('대상 6개 — Top 5');
    expect(out).toContain('외 1개');
    // 가장 최신 5개만 표시 (정렬 desc)
    expect(out).toContain('A00006 A6');
    expect(out).toContain('A00002 A2');
    // 가장 오래된 1개는 미표시
    expect(out).not.toContain('A00001 A1');
  });

  it('정렬: technicalProviderDegradedAt 내림차순 (최신 먼저)', () => {
    const entries = [
      makeDegraded('OLD001', 'Old1', '2026-05-06T09:10:00.000Z'),
      makeDegraded('NEW001', 'New1', '2026-05-06T09:30:00.000Z'),
      makeDegraded('MID001', 'Mid1', '2026-05-06T09:20:00.000Z'),
    ];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).not.toBeNull();
    const idxNew = out!.indexOf('NEW001 New1');
    const idxMid = out!.indexOf('MID001 Mid1');
    const idxOld = out!.indexOf('OLD001 Old1');
    expect(idxNew).toBeGreaterThan(0);
    expect(idxMid).toBeGreaterThan(idxNew);
    expect(idxOld).toBeGreaterThan(idxMid);
  });

  it('technicalProviderDegradedAt 부재 → addedAt fallback 정렬', () => {
    const entries = [
      makeDegraded('A00001', 'A1', undefined, '2026-05-01T09:00:00.000Z'),
      makeDegraded('A00002', 'A2', undefined, '2026-05-05T09:00:00.000Z'),
    ];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).not.toBeNull();
    const idx2 = out!.indexOf('A00002 A2');
    const idx1 = out!.indexOf('A00001 A1');
    expect(idx2).toBeGreaterThan(0);
    expect(idx1).toBeGreaterThan(idx2);
  });

  it('잘못된 ISO 타임스탬프 → 안전 fallback (시각 라벨 미노출, 정렬 후순위)', () => {
    const entries = [
      makeDegraded('VALID1', 'V1', '2026-05-06T09:23:00.000Z'),
      makeDegraded('INVAL1', 'I1', 'NOT_AN_ISO'),
    ];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).not.toBeNull();
    expect(out).toContain('VALID1 V1');
    expect(out).toContain('INVAL1 I1');
    // valid 가 invalid 보다 먼저 정렬
    const idxV = out!.indexOf('VALID1 V1');
    const idxI = out!.indexOf('INVAL1 I1');
    expect(idxV).toBeGreaterThan(0);
    expect(idxI).toBeGreaterThan(idxV);
    // INVAL1 줄에는 KST 시각 라벨 부재 (잘못된 ISO 안전 fallback)
    const invalLine = out!.split('\n').find((l) => l.includes('INVAL1 I1'));
    expect(invalLine).toBeDefined();
    expect(invalLine).not.toMatch(/\d{2}:\d{2} KST/);
  });

  it('KST 시각 라벨 형식 — UTC + 9 정합 (UTC 09:23 → KST 18:23)', () => {
    const entries = [makeDegraded('005930', '삼성전자', '2026-05-06T09:23:00.000Z')];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).toContain('18:23 KST');
  });

  it('topN option override — 2 → Top 2 만 표시', () => {
    const entries = [
      makeDegraded('A00001', 'A1', '2026-05-06T09:21:00.000Z'),
      makeDegraded('A00002', 'A2', '2026-05-06T09:22:00.000Z'),
      makeDegraded('A00003', 'A3', '2026-05-06T09:23:00.000Z'),
    ];
    const out = formatTechnicalProviderDegradedSection(entries, { topN: 2 });
    expect(out).not.toBeNull();
    expect(out).toContain('대상 3개 — Top 2');
    expect(out).toContain('외 1개');
    expect(out).toContain('A00003 A3'); // 최신 1
    expect(out).toContain('A00002 A2'); // 최신 2
    expect(out).not.toContain('A00001 A1'); // 잘림
  });

  it('topN ≤ 0 → 1 floor 가드 (안전 invariant)', () => {
    const entries = [
      makeDegraded('A00001', 'A1', '2026-05-06T09:21:00.000Z'),
      makeDegraded('A00002', 'A2', '2026-05-06T09:22:00.000Z'),
    ];
    const out = formatTechnicalProviderDegradedSection(entries, { topN: 0 });
    expect(out).not.toBeNull();
    expect(out).toContain('Top 1');
    expect(out).toContain('외 1개');
    expect(out).toContain('A00002 A2'); // 최신 1만
    expect(out).not.toContain('A00001 A1');
  });

  it('정상 운영 종목 + degraded 종목 혼재 → degraded 만 노출', () => {
    const entries = [
      makeEntry({ code: 'NORMAL', name: '정상' }),
      makeDegraded('DEGRAD', 'Degraded', '2026-05-06T09:23:00.000Z'),
      makeEntry({ code: 'NORMAL2', name: '정상2' }),
    ];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).not.toBeNull();
    expect(out).toContain('대상 1개');
    expect(out).toContain('DEGRAD Degraded');
    expect(out).not.toContain('NORMAL 정상');
    expect(out).not.toContain('NORMAL2 정상2');
  });

  it('섹션 출력 — Yahoo↔KIS 괴리 사유 + 시계열 evaluator 강등 명시', () => {
    const entries = [makeDegraded('005930', '삼성전자', '2026-05-06T09:23:00.000Z')];
    const out = formatTechnicalProviderDegradedSection(entries);
    expect(out).toContain('Yahoo↔KIS 괴리');
    expect(out).toContain('시계열 evaluator');
    expect(out).toContain('신규 진입 자연 차단');
    expect(out).toContain('score=0');
  });
});
