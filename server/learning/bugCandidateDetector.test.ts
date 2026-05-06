/**
 * @responsibility bugCandidateDetector 회귀 테스트 (PR #669~#674 후속 P3)
 *
 * 검증:
 *   - classifyCandidateSeverity: 4 분기 (T1_ALARM CRITICAL/HIGH, T2_REPORT, 그 외)
 *   - isBugCandidateDetectorEnabled: ENV 정확 비교
 *   - detectBugCandidates: 정상 / DISABLED / 임계 / dedup signature / severity 격상 / dryRun
 *   - 절대 규칙: BUG_LEDGER 무수정 + 자동 전사 0건
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  classifyCandidateSeverity,
  isBugCandidateDetectorEnabled,
  detectBugCandidates,
} from './bugCandidateDetector.js';
import type { AlertAuditEntry } from '../alerts/alertAuditLog.js';

const origEnabled = process.env.BUG_CANDIDATE_DETECTOR_ENABLED;

beforeEach(() => {
  process.env.BUG_CANDIDATE_DETECTOR_ENABLED = 'true';  // default ENABLED for these tests
});

afterEach(() => {
  if (origEnabled === undefined) delete process.env.BUG_CANDIDATE_DETECTOR_ENABLED;
  else process.env.BUG_CANDIDATE_DETECTOR_ENABLED = origEnabled;
});

function entry(overrides: Partial<AlertAuditEntry> = {}): AlertAuditEntry {
  return {
    at: '2026-05-07T01:00:00.000Z',
    tier: 'T1_ALARM',
    priority: 'CRITICAL',
    category: 'kill-switch-downgrade',
    dedupeKey: 'kill-switch-downgrade',
    textLen: 100,
    ...overrides,
  };
}

describe('classifyCandidateSeverity', () => {
  it('T1_ALARM + CRITICAL → P0_CANDIDATE', () => {
    expect(classifyCandidateSeverity(entry({ tier: 'T1_ALARM', priority: 'CRITICAL' }))).toBe('P0_CANDIDATE');
  });

  it('T1_ALARM + HIGH → P1_CANDIDATE', () => {
    expect(classifyCandidateSeverity(entry({ tier: 'T1_ALARM', priority: 'HIGH' }))).toBe('P1_CANDIDATE');
  });

  it('T2_REPORT → P2_CANDIDATE', () => {
    expect(classifyCandidateSeverity(entry({ tier: 'T2_REPORT', priority: 'NORMAL' }))).toBe('P2_CANDIDATE');
  });

  it('T3_INFO → P3_CANDIDATE', () => {
    expect(classifyCandidateSeverity(entry({ tier: 'T3_DIGEST', priority: 'NORMAL' }))).toBe('P3_CANDIDATE');
  });

  it('T1_ALARM + NORMAL → P3_CANDIDATE (CRITICAL/HIGH 만 격상)', () => {
    expect(classifyCandidateSeverity(entry({ tier: 'T1_ALARM', priority: 'NORMAL' }))).toBe('P3_CANDIDATE');
  });
});

describe('isBugCandidateDetectorEnabled', () => {
  const origLocal = process.env.BUG_CANDIDATE_DETECTOR_ENABLED;
  afterEach(() => {
    if (origLocal === undefined) delete process.env.BUG_CANDIDATE_DETECTOR_ENABLED;
    else process.env.BUG_CANDIDATE_DETECTOR_ENABLED = origLocal;
  });

  it('default OFF', () => {
    delete process.env.BUG_CANDIDATE_DETECTOR_ENABLED;
    expect(isBugCandidateDetectorEnabled()).toBe(false);
  });

  it('=== "true" 정확 비교', () => {
    process.env.BUG_CANDIDATE_DETECTOR_ENABLED = 'true';
    expect(isBugCandidateDetectorEnabled()).toBe(true);
  });

  it('"1" / "TRUE" / "yes" 모두 거부', () => {
    process.env.BUG_CANDIDATE_DETECTOR_ENABLED = '1';
    expect(isBugCandidateDetectorEnabled()).toBe(false);
    process.env.BUG_CANDIDATE_DETECTOR_ENABLED = 'TRUE';
    expect(isBugCandidateDetectorEnabled()).toBe(false);
    process.env.BUG_CANDIDATE_DETECTOR_ENABLED = 'yes';
    expect(isBugCandidateDetectorEnabled()).toBe(false);
  });
});

describe('detectBugCandidates', () => {
  it('ENV DISABLED → reason=DISABLED, added=0', () => {
    delete process.env.BUG_CANDIDATE_DETECTOR_ENABLED;
    const result = detectBugCandidates({
      entries: [entry(), entry(), entry()],
      existing: [],
      dryRun: true,
    });
    expect(result.reason).toBe('DISABLED');
    expect(result.added).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('임계 미달 (occurrences < 3) → 후보 등재 안 됨', () => {
    const result = detectBugCandidates({
      entries: [entry(), entry()],  // 2회 만
      existing: [],
      minOccurrences: 3,
      dryRun: true,
    });
    expect(result.added).toBe(0);
    expect(result.belowThreshold).toBe(1);
    expect(result.candidates).toEqual([]);
  });

  it('임계 충족 → 신규 후보 등재', () => {
    const result = detectBugCandidates({
      entries: [entry(), entry(), entry()],  // 3회
      existing: [],
      minOccurrences: 3,
      dryRun: true,
      nowMs: Date.parse('2026-05-08T00:00:00Z'),
    });
    expect(result.added).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].id).toBe('BUG-CANDIDATE-2026-05-08-001');
    expect(result.candidates[0].severity).toBe('P0_CANDIDATE');
    expect(result.candidates[0].status).toBe('NEW');
    expect(result.candidates[0].occurrences).toBe(3);
  });

  it('동일 signature 누적 → 기존 후보 갱신 (추가 X)', () => {
    const existing = [{
      id: 'BUG-CANDIDATE-2026-05-07-001',
      signature: 'T1_ALARM::kill-switch-downgrade::kill-switch-downgrade',
      severity: 'P0_CANDIDATE' as const,
      category: 'kill-switch-downgrade',
      dedupeKey: 'kill-switch-downgrade',
      tier: 'T1_ALARM',
      occurrences: 5,
      firstSeenAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-05-06T00:00:00Z',
      status: 'NEW' as const,
      reviewedAt: null,
      reviewedBy: null,
      note: null,
    }];
    const result = detectBugCandidates({
      entries: [
        entry({ at: '2026-05-08T00:00:00.000Z' }),
        entry({ at: '2026-05-08T01:00:00.000Z' }),
        entry({ at: '2026-05-08T02:00:00.000Z' }),
      ],
      existing,
      dryRun: true,
    });
    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].occurrences).toBe(8);  // 5 + 3
    expect(result.candidates[0].lastSeenAt).toBe('2026-05-08T02:00:00.000Z');
  });

  it('동일 signature 시 status 보존 (REVIEWED → 재검출 후에도 REVIEWED)', () => {
    const existing = [{
      id: 'BUG-CANDIDATE-2026-05-07-001',
      signature: 'T1_ALARM::kill-switch-downgrade::kill-switch-downgrade',
      severity: 'P0_CANDIDATE' as const,
      category: 'kill-switch-downgrade',
      dedupeKey: 'kill-switch-downgrade',
      tier: 'T1_ALARM',
      occurrences: 5,
      firstSeenAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-05-06T00:00:00Z',
      status: 'REVIEWED' as const,
      reviewedAt: '2026-05-06T12:00:00Z',
      reviewedBy: 'telegram_operator',
      note: null,
    }];
    const result = detectBugCandidates({
      entries: [entry(), entry(), entry()],
      existing,
      dryRun: true,
    });
    expect(result.candidates[0].status).toBe('REVIEWED');
    expect(result.candidates[0].reviewedBy).toBe('telegram_operator');
  });

  it('severity 격상 — 기존 P2 + 신규 P0 → P0', () => {
    const existing = [{
      id: 'BUG-CANDIDATE-2026-05-07-001',
      signature: 'T1_ALARM::test-cat::test-dk',
      severity: 'P2_CANDIDATE' as const,
      category: 'test-cat',
      dedupeKey: 'test-dk',
      tier: 'T1_ALARM',
      occurrences: 5,
      firstSeenAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-05-06T00:00:00Z',
      status: 'NEW' as const,
      reviewedAt: null,
      reviewedBy: null,
      note: null,
    }];
    const result = detectBugCandidates({
      entries: [
        entry({ tier: 'T1_ALARM', priority: 'CRITICAL', category: 'test-cat', dedupeKey: 'test-dk' }),
        entry({ tier: 'T1_ALARM', priority: 'CRITICAL', category: 'test-cat', dedupeKey: 'test-dk' }),
      ],
      existing,
      dryRun: true,
    });
    expect(result.candidates[0].severity).toBe('P0_CANDIDATE');
  });

  it('서로 다른 signature → 각각 신규 등재', () => {
    const result = detectBugCandidates({
      entries: [
        entry({ category: 'cat-a', dedupeKey: 'a' }),
        entry({ category: 'cat-a', dedupeKey: 'a' }),
        entry({ category: 'cat-a', dedupeKey: 'a' }),
        entry({ category: 'cat-b', dedupeKey: 'b' }),
        entry({ category: 'cat-b', dedupeKey: 'b' }),
        entry({ category: 'cat-b', dedupeKey: 'b' }),
      ],
      existing: [],
      minOccurrences: 3,
      dryRun: true,
      nowMs: Date.parse('2026-05-08T00:00:00Z'),
    });
    expect(result.added).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].id).toBe('BUG-CANDIDATE-2026-05-08-001');
    expect(result.candidates[1].id).toBe('BUG-CANDIDATE-2026-05-08-002');
  });

  it('dryRun=true → 영속 변경 안 됨', () => {
    const result = detectBugCandidates({
      entries: [entry(), entry(), entry()],
      existing: [],
      dryRun: true,
      nowMs: Date.parse('2026-05-08T00:00:00Z'),
    });
    expect(result.reason).toBe('DRY_RUN');
    expect(result.added).toBe(1);
    // 영속 변경 0건 (saveBugCandidates 호출 안 함)
  });

  it('빈 entries → added=0, candidates=existing', () => {
    const result = detectBugCandidates({
      entries: [],
      existing: [],
      dryRun: true,
    });
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('minOccurrences=1 — 단발 패턴도 등재', () => {
    const result = detectBugCandidates({
      entries: [entry()],
      existing: [],
      minOccurrences: 1,
      dryRun: true,
      nowMs: Date.parse('2026-05-08T00:00:00Z'),
    });
    expect(result.added).toBe(1);
  });

  it('analyzedEntries 카운트', () => {
    const result = detectBugCandidates({
      entries: [entry(), entry(), entry(), entry()],
      existing: [],
      dryRun: true,
    });
    expect(result.analyzedEntries).toBe(4);
  });
});

describe('절대 규칙 — BUG_LEDGER 무수정 + 자동 전사 0건', () => {
  it('detector module 은 BUG_LEDGER 영속 import 0건 (정적 검증)', async () => {
    // bugCandidateDetector.ts source 가 BUG_LEDGER / bugLedgerRepo import 0건
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const detectorSource = fs.readFileSync(
      path.join(__dirname, 'bugCandidateDetector.ts'),
      'utf-8',
    );
    // 주석/문자열 안 BUG_LEDGER.md 언급은 정책 명문화이므로 허용 (절대 원칙 #1 명시).
    // 실제 결함은 import / 함수 호출 / 영속 write — 그것만 검사.
    expect(detectorSource).not.toMatch(/from ['"][^'"]*bugLedgerRepo/);
    expect(detectorSource).not.toMatch(/loadBugLedger\s*\(/);
    expect(detectorSource).not.toMatch(/saveBugLedger/);
    expect(detectorSource).not.toMatch(/writeFileSync\s*\([^)]*BUG_LEDGER/);
  });

  it('detector module 은 KIS 주문 함수 import 0건 (정적 검증)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const detectorSource = fs.readFileSync(
      path.join(__dirname, 'bugCandidateDetector.ts'),
      'utf-8',
    );
    expect(detectorSource).not.toMatch(/placeKis(Market|Sell|Buy|StopLoss|TakeProfit)Order/);
    expect(detectorSource).not.toMatch(/cancelKisOrder/);
  });
});
