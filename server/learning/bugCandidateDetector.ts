// @responsibility BUG 후보 검출기 — alertAuditLog CRITICAL/HIGH 패턴 빈도 기반 영속 후보 합성 (PR #669~#674 후속 P3).
//
// 절대 규칙:
//   1. BUG_LEDGER.md *읽지도 쓰지도 않음* — 후보는 별도 영속.
//   2. 자동 BUG 생성 0건 — 후보만 생성, 운영자가 수동으로 BUG_LEDGER 전사.
//   3. KIS 주문 함수 import 금지 — 분석/진단 전용.
//   4. ENV `BUG_CANDIDATE_DETECTOR_ENABLED=true` default OFF (opt-in).

import { readAlertAuditRange, type AlertAuditEntry } from '../alerts/alertAuditLog.js';
import {
  loadBugCandidates,
  saveBugCandidates,
  buildSignature,
  generateCandidateId,
  findBySignature,
  type BugCandidate,
  type BugCandidateSeverity,
} from '../persistence/bugCandidatesRepo.js';

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MIN_OCCURRENCES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 알림 1건의 추정 심각도 분류 SSOT — 운영자 검토 후 BUG_LEDGER 등재 시 격하/격상.
 *
 * - T1_ALARM + CRITICAL → P0 후보 (자금 손실 가능성)
 * - T1_ALARM + HIGH → P1 후보 (의사결정 정확도 저하)
 * - T2_REPORT + 그 외 → P2 후보 (진단/표시 문제)
 * - 그 외 → P3 후보 (UI/UX)
 */
export function classifyCandidateSeverity(entry: AlertAuditEntry): BugCandidateSeverity {
  if (entry.tier === 'T1_ALARM' && entry.priority === 'CRITICAL') return 'P0_CANDIDATE';
  if (entry.tier === 'T1_ALARM' && entry.priority === 'HIGH') return 'P1_CANDIDATE';
  if (entry.tier === 'T2_REPORT') return 'P2_CANDIDATE';
  return 'P3_CANDIDATE';
}

/** detector ENV gate — default OFF, 운영자 명시 활성화 의무 (ADR-0157 정확 비교). */
export function isBugCandidateDetectorEnabled(): boolean {
  return process.env.BUG_CANDIDATE_DETECTOR_ENABLED === 'true';
}

export interface DetectBugCandidatesOptions {
  /** 분석 윈도우 (일). default 7. */
  windowDays?: number;
  /** 후보 등재 최소 발생 횟수. default 3. */
  minOccurrences?: number;
  /** 호출 시점 (테스트 격리용). default Date.now(). */
  nowMs?: number;
  /** 이미 로드된 entries 직접 주입 (테스트 격리). 미전달 시 readAlertAuditRange 사용. */
  entries?: AlertAuditEntry[];
  /** 이미 로드된 candidates 직접 주입 (테스트 격리). 미전달 시 loadBugCandidates 사용. */
  existing?: BugCandidate[];
  /** 영속 저장 비활성화 (dryRun) — 테스트 / 진단. */
  dryRun?: boolean;
}

export interface DetectBugCandidatesResult {
  /** 신규 등재된 후보 수. */
  added: number;
  /** 기존 후보 occurrences 갱신 수. */
  updated: number;
  /** windows 내 분석한 알림 수. */
  analyzedEntries: number;
  /** 임계 미달로 후보화 안 된 패턴 수. */
  belowThreshold: number;
  /** 영속 저장 후 전체 candidates. */
  candidates: BugCandidate[];
  /** 비활성화 사유 (DISABLED / OK / DRY_RUN). */
  reason: 'DISABLED' | 'OK' | 'DRY_RUN';
}

/**
 * 알림 패턴 분석 → BUG 후보 영속.
 *
 * 알고리즘:
 *   1) ENV gate OFF → DISABLED 즉시 반환 (영속 변경 0).
 *   2) windowDays 만큼 alertAuditLog read.
 *   3) 각 entry 의 (tier, category, dedupeKey) signature 생성 + 카운트 집계.
 *   4) 기존 영속 candidate 와 signature 매칭:
 *      - 매칭 시 → occurrences 누적, lastSeenAt 갱신, status 보존.
 *      - 매칭 없음 + count >= minOccurrences → 신규 후보 등재.
 *      - 매칭 없음 + count < minOccurrences → 임계 미달, 무시.
 *   5) atomic write 영속 (dryRun=false 일 때만).
 *
 * **자동 BUG_LEDGER 전사 0건** — operator 가 텔레그램 명령으로 review/promote 결정 후 수동 전사.
 */
export function detectBugCandidates(opts: DetectBugCandidatesOptions = {}): DetectBugCandidatesResult {
  if (!isBugCandidateDetectorEnabled()) {
    return {
      added: 0,
      updated: 0,
      analyzedEntries: 0,
      belowThreshold: 0,
      candidates: opts.existing ?? [],
      reason: 'DISABLED',
    };
  }

  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minOccurrences = opts.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const nowMs = opts.nowMs ?? Date.now();
  const startMs = nowMs - windowDays * DAY_MS;

  const entries = opts.entries ?? readAlertAuditRange(startMs, nowMs);
  const existing = opts.existing ?? loadBugCandidates();

  // signature → { count, lastEntry, severity }
  type Aggregate = { count: number; lastEntry: AlertAuditEntry; severity: BugCandidateSeverity };
  const aggregates = new Map<string, Aggregate>();
  for (const e of entries) {
    const sev = classifyCandidateSeverity(e);
    const sig = buildSignature(e.tier, e.category, e.dedupeKey ?? null);
    const cur = aggregates.get(sig);
    if (cur) {
      cur.count += 1;
      // lastEntry 갱신 — 더 최신 at 로
      if (Date.parse(e.at) > Date.parse(cur.lastEntry.at)) cur.lastEntry = e;
      // severity 더 심각한 쪽으로 격상 (P0_CANDIDATE < P1 < P2 < P3 순서로 P0 가 가장 심각)
      cur.severity = pickMoreSevere(cur.severity, sev);
    } else {
      aggregates.set(sig, { count: 1, lastEntry: e, severity: sev });
    }
  }

  let added = 0;
  let updated = 0;
  let belowThreshold = 0;
  const next: BugCandidate[] = [...existing];

  for (const [signature, agg] of aggregates) {
    const matched = findBySignature(next, signature);
    if (matched) {
      // 기존 후보 — occurrences 갱신, lastSeenAt 갱신, status 보존
      const idx = next.indexOf(matched);
      next[idx] = {
        ...matched,
        occurrences: matched.occurrences + agg.count,
        lastSeenAt: agg.lastEntry.at,
        // severity 격상 (악화 방향만)
        severity: pickMoreSevere(matched.severity, agg.severity),
      };
      updated += 1;
      continue;
    }
    if (agg.count < minOccurrences) {
      belowThreshold += 1;
      continue;
    }
    // 신규 후보 등재
    const id = generateCandidateId(new Date(nowMs), next);
    const candidate: BugCandidate = {
      id,
      signature,
      severity: agg.severity,
      category: agg.lastEntry.category,
      dedupeKey: agg.lastEntry.dedupeKey ?? null,
      tier: agg.lastEntry.tier,
      occurrences: agg.count,
      firstSeenAt: agg.lastEntry.at,
      lastSeenAt: agg.lastEntry.at,
      status: 'NEW',
      reviewedAt: null,
      reviewedBy: null,
      note: null,
    };
    next.push(candidate);
    added += 1;
  }

  if (!opts.dryRun) {
    saveBugCandidates(next);
  }

  return {
    added,
    updated,
    analyzedEntries: entries.length,
    belowThreshold,
    candidates: next,
    reason: opts.dryRun ? 'DRY_RUN' : 'OK',
  };
}

/** P0 > P1 > P2 > P3 — P0 가 가장 심각. */
const SEVERITY_RANK: Record<BugCandidateSeverity, number> = {
  P0_CANDIDATE: 0,
  P1_CANDIDATE: 1,
  P2_CANDIDATE: 2,
  P3_CANDIDATE: 3,
};

function pickMoreSevere(a: BugCandidateSeverity, b: BugCandidateSeverity): BugCandidateSeverity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}
