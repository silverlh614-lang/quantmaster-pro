// @responsibility BUG 후보 영속 SSOT — CRITICAL 알림 패턴 기반 후보, BUG_LEDGER 와 분리 (PR #669~#674 후속 P3).
//
// 절대 규칙:
//   1. 본 모듈은 BUG_LEDGER.md 를 *읽지도 쓰지도* 않는다 (별도 영속).
//   2. 후보 ID 형식 `BUG-CANDIDATE-YYYY-MM-DD-NNN` (BUG- prefix 와 분리).
//   3. PROMOTED 상태는 운영자가 수동으로 BUG_LEDGER.md 에 전사한 후 marker 만 — 자동 전사 0건.
//   4. KIS 주문 함수 import 절대 금지 (분석/진단 전용).

import fs from 'fs';
import { emitMaintenanceWarn } from '../observability/maintenanceWarn.js';
import { BUG_CANDIDATES_FILE, ensureDataDir } from './paths.js';

export type BugCandidateStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'PROMOTED';
export type BugCandidateSeverity = 'P0_CANDIDATE' | 'P1_CANDIDATE' | 'P2_CANDIDATE' | 'P3_CANDIDATE';

export interface BugCandidate {
  /** `BUG-CANDIDATE-YYYY-MM-DD-NNN` — BUG_LEDGER 와 prefix 분리. */
  id: string;
  /** 패턴 식별자 — (tier, category, dedupeKey) 해시. 동일 signature → 카운트 증가. */
  signature: string;
  /** 추정 심각도 — 운영자 검토 후 BUG_LEDGER 등재 시 P0/P1/P2/P3 로 격하/격상. */
  severity: BugCandidateSeverity;
  /** 패턴 카테고리 (alertAuditLog.category). */
  category: string;
  /** dedupeKey (있는 경우). */
  dedupeKey: string | null;
  /** alertTier (T1_ALARM / T2_REPORT / T3_INFO). */
  tier: string;
  /** 발견 횟수 — 동일 signature 누적. */
  occurrences: number;
  /** 처음 본 시각 ISO. */
  firstSeenAt: string;
  /** 마지막 본 시각 ISO. */
  lastSeenAt: string;
  /** 현재 상태 — operator 의사결정 marker. */
  status: BugCandidateStatus;
  /** 마지막 review 시각 ISO (있는 경우). */
  reviewedAt: string | null;
  /** review 한 운영자 식별자 (텔레그램 명령 호출자). */
  reviewedBy: string | null;
  /** 운영자 메모 (dismiss 사유 등). */
  note: string | null;
}

export const TRIM_LIMIT = 500;

/** 영속 파일 로드 — 부재 / 손상 / non-array 시 빈 배열 안전 fallback. */
export function loadBugCandidates(): BugCandidate[] {
  ensureDataDir();
  if (!fs.existsSync(BUG_CANDIDATES_FILE)) return [];
  try {
    const raw = fs.readFileSync(BUG_CANDIDATES_FILE, 'utf-8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter(isValidCandidate);
  } catch (err) {
    emitMaintenanceWarn({ domain: 'DATA', code: 'P3_CACHE_PERSIST_DEGRADED', source: 'AUX_CACHE', message: 'Bug candidates JSON is corrupt; using empty fallback.', dedupKey: 'p3:cache:bug-candidates:load', error: err });
    return [];
  }
}

function isValidCandidate(x: unknown): x is BugCandidate {
  if (!x || typeof x !== 'object') return false;
  const c = x as Partial<BugCandidate>;
  return (
    typeof c.id === 'string' &&
    /^BUG-CANDIDATE-\d{4}-\d{2}-\d{2}-\d{3}$/.test(c.id) &&
    typeof c.signature === 'string' &&
    typeof c.firstSeenAt === 'string' &&
    typeof c.lastSeenAt === 'string' &&
    typeof c.occurrences === 'number' &&
    typeof c.status === 'string'
  );
}

/** atomic write — 손상 데이터 보호. */
export function saveBugCandidates(candidates: BugCandidate[]): void {
  ensureDataDir();
  const trimmed = candidates.length > TRIM_LIMIT
    ? candidates.slice(-TRIM_LIMIT)
    : candidates;
  const tmp = `${BUG_CANDIDATES_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf-8');
    fs.renameSync(tmp, BUG_CANDIDATES_FILE);
  } catch (err) {
    emitMaintenanceWarn({ domain: 'DATA', code: 'P3_CACHE_PERSIST_DEGRADED', source: 'AUX_CACHE', message: 'Bug candidates save failed.', dedupKey: 'p3:cache:bug-candidates:save', error: err });
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** signature 기반 lookup. */
export function findBySignature(candidates: BugCandidate[], signature: string): BugCandidate | undefined {
  return candidates.find((c) => c.signature === signature);
}

/** id 기반 lookup. */
export function findById(candidates: BugCandidate[], id: string): BugCandidate | undefined {
  return candidates.find((c) => c.id === id);
}

/** 다음 발급 ID 생성 — `BUG-CANDIDATE-YYYY-MM-DD-NNN` (NNN 은 동일 일자 내 순차). */
export function generateCandidateId(now: Date, existing: BugCandidate[]): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const datePrefix = `BUG-CANDIDATE-${yyyy}-${mm}-${dd}`;
  let maxN = 0;
  for (const c of existing) {
    if (!c.id.startsWith(datePrefix)) continue;
    const m = c.id.match(/-(\d{3})$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    }
  }
  const next = String(maxN + 1).padStart(3, '0');
  return `${datePrefix}-${next}`;
}

/** signature 합성 — (tier, category, dedupeKey) 정규화 해시. */
export function buildSignature(tier: string, category: string, dedupeKey: string | null | undefined): string {
  const dk = dedupeKey ?? '';
  return `${tier}::${category}::${dk}`;
}

/** 영속 marker 변경 — review / dismiss / promote (자동 BUG_LEDGER 전사 X). */
export function updateCandidateStatus(
  candidates: BugCandidate[],
  id: string,
  status: BugCandidateStatus,
  meta: { now: Date; reviewedBy: string; note?: string },
): BugCandidate[] {
  const updated = candidates.map((c) => {
    if (c.id !== id) return c;
    return {
      ...c,
      status,
      reviewedAt: meta.now.toISOString(),
      reviewedBy: meta.reviewedBy,
      note: meta.note ?? c.note,
    };
  });
  return updated;
}
