#!/usr/bin/env node
import { scriptWarn } from '../server/observability/scriptWarn.js';
/**
 * @responsibility PENDING_WIRING.md ↔ INDEX.md / 백로그 SSOT 정합 + SLA 자동 만료 정적 검증
 *
 * 사용자 4-항목 추천 후속 자동화 #2 — *"PR-L/N/O 같은 게 영원히 dead code 로 남는 결함"*
 * 영구 차단. PENDING_WIRING.md 가 단일 wiring 추적 SSOT 임을 정적 강제.
 *
 * 검사 항목:
 *   A) 상태 4단계 SSOT — INFRASTRUCTURE_ONLY / PARTIAL / BLOCKED / DECIDED_NOT_WIRING 외 차단
 *   B) 우선순위 3등급 SSOT — P0/P1/P2/P3 외 차단
 *   C) ADR 참조 정합 — 본 백로그가 참조하는 ADR 번호가 INDEX.md 에 등재되어 있는지
 *   D) 카테고리 파싱 정합 — 5 카테고리 (A. 학습 / B. 매매 / C. 시그널 / D. UI / E. 영속) 모두 존재
 *   E) 진행 통계 자동 갱신 — §"진행 통계" 표가 실제 카테고리 카운트와 일치
 *   F) ID 형식 — `[A-E][0-9]+` 엄격
 *   G) 백로그 등재 vs 실제 wiring 정합성 (PR-Governance-Followup-2):
 *      G1 — 모듈 경로 백틱 안 파일이 실제 존재 (placeholder 제외)
 *      G2 — DECIDED_NOT_WIRING 항목은 reason 에 PR 인용 (`PR-` / `완료` / audit 산출물 인용) 의무
 *      G3 — INFRASTRUCTURE_ONLY / PARTIAL / BLOCKED 항목은 reason 에 차단 사유 / 다음 액션 명시 의무
 *   H) SLA 자동 만료 (ADR-0158, PR-Governance-3-SLA):
 *      H1 — SLA 초과 (WARN, EXIT=0) — `now - 등재일 > SLA_DAYS[priority]`. P3/DECIDED_NOT_WIRING 면제.
 *      H2 — SLA + grace 초과 (FAIL, EXIT=1) — `now - 등재일 > SLA_DAYS[priority] + GRACE_DAYS`.
 *      H3 — 등재일 형식 정합 — `YYYY-MM-DD` 또는 `—` 외 차단. (잘못된 형식 FAIL)
 *      H4 — BLOCKED 면제 사유 명시 — BLOCKED + reason 에 면제 사유 패턴 부재 + SLA 초과 시 H1/H2 그대로 적용.
 *
 *      배경: A3 (emitFullCloseAttribution) 가 6개월간 INFRASTRUCTURE_ONLY stale 로 남았던
 *      이유 — 백로그 등재 시점에 *언제까지 wiring 의무인지* 부재. H 카테고리는 우선순위별
 *      SLA (P0=21/P1=45/P2=120/P3=무기한) + grace 14일 + 면제 정책으로 영구 차단.
 *
 *      ENV 우회:
 *        - WIRING_SLA_GRACE_DAYS=N (기본 14, 0~30일 조정, 0 시 즉시 FAIL)
 *        - WIRING_SLA_DISABLED=true (긴급 운영 우회 — 정책 즉시 비활성)
 *
 *   I) 사용자결정 부채 재검토 (PR-Governance-StaleUserDecision):
 *      I1 — BLOCKED + reason 에 "사용자 결정" / "SL 이후 추천" 패턴 + 최종 검토일
 *           (등재일 또는 reason 안 최신 `YYYY-MM-DD`) 이 USER_DECISION_REVIEW_DAYS(기본 30)
 *           초과 무변동 → WARN (EXIT=0, informational). 방치돼 맥락 휘발된 사용자결정 부채를
 *           자동 재노출. (운영자 결정·데이터 누적 은 시간·외부 의존이라 대상 아님.)
 *      self-clearing — 재검토 후 reason 에 `재노출 YYYY-MM-DD` 갱신 시 clock 리셋.
 *      ENV 우회: USER_DECISION_REVIEW_DAYS=N (1~365) / USER_DECISION_REVIEW_DISABLED=true.
 *
 *      배경: C16~C18·E8~E11 처럼 "SL 이후 추천" 으로 무기한 BLOCKED 된 항목이 43일+ 방치되며
 *      맥락이 휘발(사용자가 존재조차 기억 못 함) → 백로그 추적 목적 무력화. I 카테고리가
 *      주기적 재노출로 "유지/폐기/진행" 재결정을 강제한다.
 *
 * 본 PR (Governance 후속): baseline 0건 위반 — 신규 회귀만 차단.
 *
 * 사용:
 *   node scripts/check_pending_wiring.js                # WARN/ERROR 출력 EXIT=0/1
 *   node scripts/check_pending_wiring.js --json         # JSON 진단
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PENDING_PATH = join(ROOT, '_workspace', 'PENDING_WIRING.md');
const INDEX_PATH = join(ROOT, 'docs', 'adr', 'INDEX.md');

export const VALID_STATES = new Set([
  'INFRASTRUCTURE_ONLY',
  'PARTIAL',
  'BLOCKED',
  'DECIDED_NOT_WIRING',
]);

export const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

export const EXPECTED_CATEGORIES = ['A', 'B', 'C', 'D', 'E'];

const ID_RE = /^[A-E]\d+$/;
// PR-Governance-3-SLA: 7 컬럼 모두 캡처 (id/adr/모듈/등재일/상태/우선순위/사유)
//   - 등재일은 `YYYY-MM-DD` 또는 `—` (em dash) 또는 `-` (hyphen). H3 형식 검증은 별도 함수.
const ROW_RE =
  /^\|\s*([A-Z]\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([A-Z_]+)\s*\|\s*(P\d)\s*\|\s*(.+?)\s*\|\s*$/;
const CATEGORY_RE = /^###\s+([A-E])\.\s+/;
const ADR_REF_RE = /\b(\d{4})\b/g;
// PR-Governance-Followup-2: 모듈 경로 백틱 추출 (예: `server/persistence/x.ts`)
const MODULE_PATH_RE = /`([^`]+)`/g;
// PR-Governance-Followup-2: placeholder 패턴 — 모듈 경로 검증 skip 대상
const MODULE_PLACEHOLDER_RE = /\(\s*신규\s*\)|\(\s*정성[^)]*\)|\(\s*예정[^)]*\)/;
// PR-Governance-Followup-2: DECIDED_NOT_WIRING 의 reason 에 audit 추적성 인용 패턴
//   - PR 인용 / "완료" / audit 산출물 / `_workspace/` / ADR 인용 (정책 SSOT 명시)
const DECIDED_REASON_REF_RE =
  /(PR-[가-힣A-Za-z0-9_-]+|완료|audit|_workspace\/|ADR-\d{4})/i;
// PR-Governance-Followup-2: 와일드카드 / glob 경로 — 파일 단위 검증 skip
const WILDCARD_RE = /[*?]/;

// PR-Governance-3-SLA (ADR-0158): SLA 자동 만료 SSOT
//   - P0=21일 / P1=45일 / P2=120일 / P3=무기한 (null = SLA 미적용)
//   - DECIDED_NOT_WIRING / 등재일 `—` 도 SLA 미적용
export const SLA_DAYS = Object.freeze({
  P0: 21,
  P1: 45,
  P2: 120,
  P3: null,
});

// PR-Governance-3-SLA (ADR-0158): grace 임계 (default 14일)
//   - WIRING_SLA_GRACE_DAYS ENV 우회 시 0~30 범위 클램프, 미설정 시 default
//   - 0 시 즉시 FAIL (grace 비활성)
export const DEFAULT_GRACE_DAYS = 14;

// PR-Governance-3-SLA (ADR-0158): BLOCKED 면제 사유 패턴 SSOT
//   - reason 에 다음 패턴 매칭 시 BLOCKED 항목 SLA 면제
const SLA_EXEMPTION_RE =
  /(외부\s*의존성|외부\s*API|운영자\s*결정|사용자\s*결정|데이터\s*누적|데이터\s*가용|데이터\s*기반|ADR-\d{4}\s*정책|검증\s*후|1~2주|1\s*~\s*2주|\d+개월\s*후)/;

// PR-Governance-3-SLA (ADR-0158): 등재일 형식 — YYYY-MM-DD 또는 `—` (em dash) 또는 `-` (단일 hyphen)
const ENTERED_AT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ENTERED_AT_DASH_RE = /^[—-]$/;

// PR-Governance-StaleUserDecision: 사용자결정 부채 재검토 SSOT
//   "사용자 결정" / "SL 이후 추천" BLOCKED 항목이 N일 무변동 시 재노출(WARN, EXIT=0).
//   lastReview = 등재일 + reason 안 최신 `YYYY-MM-DD`(예: "재노출 2026-06-18") 중 최신 →
//   재검토 후 reason 날짜 갱신 시 clock 리셋(self-clearing).
const USER_DECISION_RE = /사용자\s*결정|SL\s*이후\s*추천|sl\s*이후\s*추천/;
const DATE_IN_TEXT_RE = /(\d{4}-\d{2}-\d{2})/g;
export const DEFAULT_USER_DECISION_REVIEW_DAYS = 30;

/* ───────── PENDING_WIRING 파싱 ───────── */

/**
 * parsePendingWiring(src) — 백로그 본문 파싱.
 *
 * @returns {{
 *   entries: Array<{
 *     id: string,
 *     adrRefs: string[],
 *     module: string,           // PR-Governance-Followup-2: raw 모듈 컬럼 텍스트
 *     modulePaths: string[],    // PR-Governance-Followup-2: 백틱 안 파일 경로 추출
 *     enteredAt: string,        // PR-Governance-3-SLA: 등재일 (YYYY-MM-DD 또는 `—`)
 *     status: string,
 *     priority: string,
 *     category: string,
 *     reason: string,           // PR-Governance-Followup-2: raw 사유 컬럼 텍스트
 *   }>,
 *   categories: Set<string>,
 *   stats: Map<string, { total: number, p0: number, p1: number, p2: number, p3: number }> | null
 * }}
 */
export function parsePendingWiring(src) {
  const lines = src.split('\n');
  const entries = [];
  const categories = new Set();
  let currentCategory = null;
  let inStatsTable = false;

  // 통계 표 파싱
  const stats = new Map();

  for (const line of lines) {
    // 카테고리 헤더 추출
    const cat = line.match(CATEGORY_RE);
    if (cat) {
      currentCategory = cat[1];
      categories.add(currentCategory);
      continue;
    }

    // 통계 표 진입
    if (/^##\s+진행 통계/.test(line)) {
      inStatsTable = true;
      continue;
    }
    if (inStatsTable && /^##\s+/.test(line)) {
      inStatsTable = false;
    }

    // 통계 표 행 파싱: `| A. 학습 시리즈 | 7 | 1 | 3 | 3 | 0 |`
    if (inStatsTable) {
      const sm = line.match(
        /^\|\s+([A-E])\.\s+[^|]+?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/
      );
      if (sm) {
        stats.set(sm[1], {
          total: parseInt(sm[2], 10),
          p0: parseInt(sm[3], 10),
          p1: parseInt(sm[4], 10),
          p2: parseInt(sm[5], 10),
          p3: parseInt(sm[6], 10),
        });
      }
      continue;
    }

    // 백로그 행 파싱
    const m = line.match(ROW_RE);
    if (m) {
      const id = m[1];
      const adrField = m[2].trim();
      const moduleField = m[3].trim();
      // PR-Governance-3-SLA: 7 컬럼 — 등재일은 4번째, 상태 5, 우선순위 6, 사유 7
      const enteredAt = m[4].trim();
      const status = m[5];
      const priority = m[6];
      const reason = m[7].trim();

      const adrRefs = [];
      let r;
      ADR_REF_RE.lastIndex = 0;
      while ((r = ADR_REF_RE.exec(adrField)) !== null) {
        adrRefs.push(r[1]);
      }

      // PR-Governance-Followup-2: 모듈 컬럼에서 백틱 안 파일 경로 추출
      const modulePaths = [];
      let p;
      MODULE_PATH_RE.lastIndex = 0;
      while ((p = MODULE_PATH_RE.exec(moduleField)) !== null) {
        modulePaths.push(p[1]);
      }

      entries.push({
        id,
        adrRefs,
        module: moduleField,
        modulePaths,
        enteredAt,
        status,
        priority,
        category: id.charAt(0),
        reason,
      });
    }
  }

  return { entries, categories, stats: stats.size > 0 ? stats : null };
}

/* ───────── INDEX.md ADR 번호 추출 (간소) ───────── */

/**
 * extractAllAdrNumbers(indexSrc) — INDEX.md §"전체 인덱스" + §"알려진 충돌" 의 모든 번호 set.
 */
export function extractAllAdrNumbers(indexSrc) {
  const numbers = new Set();
  const lines = indexSrc.split('\n');
  let inIndexedSection = false;

  for (const line of lines) {
    if (/^##\s+(전체 인덱스|알려진 충돌)/.test(line)) {
      inIndexedSection = true;
      continue;
    }
    if (inIndexedSection) {
      if (/^##\s+/.test(line)) {
        inIndexedSection = false;
        continue;
      }
      const m = line.match(/^\|\s*\*?\*?(\d{4})\*?\*?\s*\|/);
      if (m) numbers.add(m[1]);
    }
  }
  return numbers;
}

/* ───────── 검증 ───────── */

/**
 * fileExistsAtRoot(rootDir, relPath) — 모듈 경로 파일 존재 검증 헬퍼 (G1).
 *
 * 절대 경로면 그대로, 상대면 rootDir 기준 join. 와일드카드는 false 반환 후
 * 호출자가 skip. 디렉토리도 true (예: `server/clients/kisClient/`).
 */
export function fileExistsAtRoot(rootDir, relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (WILDCARD_RE.test(relPath)) return false; // glob 은 검증 skip
  const abs = relPath.startsWith('/') ? relPath : join(rootDir, relPath);
  try {
    statSync(abs); // 디렉토리 / 파일 모두 OK
    return true;
  } catch {
    return false;
  }
}

/**
 * isWildcardPath(p) — glob/wildcard 패턴 판정.
 */
export function isWildcardPath(p) {
  return typeof p === 'string' && WILDCARD_RE.test(p);
}

/**
 * isModulePlaceholder(moduleField) — `(신규)` `(정성 — 격상 불가)` 등 placeholder 판정.
 */
export function isModulePlaceholder(moduleField) {
  if (!moduleField) return false;
  return MODULE_PLACEHOLDER_RE.test(moduleField);
}

/* ───────── PR-Governance-3-SLA (ADR-0158): SLA 헬퍼 ───────── */

/**
 * isWiringSlaDisabled() — `WIRING_SLA_DISABLED=true` ENV 시 SLA 정책 즉시 비활성.
 */
export function isWiringSlaDisabled() {
  const v = process.env.WIRING_SLA_DISABLED;
  return v === 'true' || v === '1';
}

/**
 * getWiringSlaGraceDays() — `WIRING_SLA_GRACE_DAYS=N` ENV 우회 (0~30일 범위 클램프).
 *   - 미설정 → DEFAULT_GRACE_DAYS (14)
 *   - 잘못된 값 (NaN / 음수 / >30) → DEFAULT_GRACE_DAYS fallback
 */
export function getWiringSlaGraceDays() {
  const raw = process.env.WIRING_SLA_GRACE_DAYS;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_GRACE_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 30) return DEFAULT_GRACE_DAYS;
  return Math.floor(n);
}

/**
 * isValidEnteredAt(s) — 등재일 형식 검증 (YYYY-MM-DD 또는 `—` / `-`).
 *   - YYYY-MM-DD: 정확히 그 형식 + 유효한 날짜
 *   - `—` (em dash) / `-` (hyphen): SLA 미적용 명시 (DECIDED_NOT_WIRING 등)
 *   - 그 외: 잘못된 형식 (H3 FAIL)
 */
export function isValidEnteredAt(s) {
  if (typeof s !== 'string') return false;
  if (ENTERED_AT_DASH_RE.test(s)) return true;
  if (!ENTERED_AT_DATE_RE.test(s)) return false;
  // 유효한 날짜 검증 (예: 2026-02-30 거부)
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * computeAgeDays(enteredAt, now) — 등재일 기준 경과 일수 (정수).
 *   - 잘못된 enteredAt 또는 `—`/`-` → null (SLA 미적용)
 *   - now 보다 미래 → 0 (clock skew 방어)
 */
export function computeAgeDays(enteredAt, now) {
  if (!isValidEnteredAt(enteredAt)) return null;
  if (ENTERED_AT_DASH_RE.test(enteredAt)) return null;
  const [y, m, d] = enteredAt.split('-').map(Number);
  const enteredMs = Date.UTC(y, m - 1, d);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return 0;
  const diffMs = nowMs - enteredMs;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * isSlaExempt(entry) — SLA 면제 판정.
 *   - DECIDED_NOT_WIRING → 면제
 *   - 우선순위 P3 (또는 SLA_DAYS[priority] === null) → 면제
 *   - BLOCKED + reason 에 면제 사유 패턴 매칭 → 면제
 *   - 등재일 `—` / `-` → 면제
 */
export function isSlaExempt(entry) {
  if (!entry) return true;
  if (entry.status === 'DECIDED_NOT_WIRING') return true;
  if (SLA_DAYS[entry.priority] === null || SLA_DAYS[entry.priority] === undefined) return true;
  if (typeof entry.enteredAt === 'string' && ENTERED_AT_DASH_RE.test(entry.enteredAt)) return true;
  if (entry.status === 'BLOCKED' && typeof entry.reason === 'string') {
    if (SLA_EXEMPTION_RE.test(entry.reason)) return true;
  }
  return false;
}

/**
 * evaluateSla(entry, now, graceDays) — SLA 평가 결과 분류.
 *
 * @returns {'EXEMPT' | 'OK' | 'WARN' | 'FAIL' | 'INVALID_DATE'}
 *   - EXEMPT: SLA 미적용 (P3 / DECIDED / BLOCKED 면제 / 등재일 dash)
 *   - OK: ageDays ≤ SLA
 *   - WARN: SLA < ageDays ≤ SLA + grace (H1)
 *   - FAIL: ageDays > SLA + grace (H2)
 *   - INVALID_DATE: 등재일 형식 오류 (H3)
 */
export function evaluateSla(entry, now, graceDays) {
  if (!entry) return 'EXEMPT';
  if (typeof entry.enteredAt !== 'string') return 'INVALID_DATE';
  if (!isValidEnteredAt(entry.enteredAt)) return 'INVALID_DATE';
  if (isSlaExempt(entry)) return 'EXEMPT';

  const sla = SLA_DAYS[entry.priority];
  if (sla === null || sla === undefined) return 'EXEMPT';

  const ageDays = computeAgeDays(entry.enteredAt, now);
  if (ageDays === null) return 'EXEMPT';

  const grace = typeof graceDays === 'number' && graceDays >= 0 ? graceDays : DEFAULT_GRACE_DAYS;
  if (ageDays <= sla) return 'OK';
  if (ageDays <= sla + grace) return 'WARN';
  return 'FAIL';
}

/* ───────── PR-Governance-StaleUserDecision: 사용자결정 부채 재검토 헬퍼 ───────── */

/**
 * isUserDecisionReviewDisabled() — `USER_DECISION_REVIEW_DISABLED=true` ENV 시 I 검사 비활성.
 */
export function isUserDecisionReviewDisabled() {
  const v = process.env.USER_DECISION_REVIEW_DISABLED;
  return v === 'true' || v === '1';
}

/**
 * getUserDecisionReviewDays() — `USER_DECISION_REVIEW_DAYS=N` ENV 우회 (1~365 클램프).
 *   - 미설정/잘못된 값 → DEFAULT_USER_DECISION_REVIEW_DAYS (30)
 */
export function getUserDecisionReviewDays() {
  const raw = process.env.USER_DECISION_REVIEW_DAYS;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_USER_DECISION_REVIEW_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 365) return DEFAULT_USER_DECISION_REVIEW_DAYS;
  return Math.floor(n);
}

/**
 * isUserDecisionDebt(entry) — BLOCKED + reason 에 "사용자 결정" / "SL 이후 추천" 패턴 판정.
 *   (운영자 결정 / 데이터 누적 은 시간·외부 의존이라 대상 아님 — 사용자 재결정 대기만.)
 */
export function isUserDecisionDebt(entry) {
  return (
    !!entry &&
    entry.status === 'BLOCKED' &&
    typeof entry.reason === 'string' &&
    USER_DECISION_RE.test(entry.reason)
  );
}

/**
 * findLastReviewDate(entry) — 최종 검토일(`YYYY-MM-DD`) = 등재일 + reason 안 최신 날짜 중 최신.
 *   reason 에 `재노출 2026-06-18` 마커를 넣으면 그게 lastReview (clock 리셋). 유효 날짜 0건 → null.
 */
export function findLastReviewDate(entry) {
  if (!entry) return null;
  const candidates = [];
  if (
    typeof entry.enteredAt === 'string' &&
    isValidEnteredAt(entry.enteredAt) &&
    !ENTERED_AT_DASH_RE.test(entry.enteredAt)
  ) {
    candidates.push(entry.enteredAt);
  }
  if (typeof entry.reason === 'string') {
    DATE_IN_TEXT_RE.lastIndex = 0;
    let m;
    while ((m = DATE_IN_TEXT_RE.exec(entry.reason)) !== null) {
      if (isValidEnteredAt(m[1])) candidates.push(m[1]);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(); // ISO 문자열 사전순 = 날짜순
  return candidates[candidates.length - 1];
}

/**
 * evaluateUserDecisionStaleness(entry, now, reviewDays) — 사용자결정 부채 재검토 평가.
 * @returns {{ status: 'NOT_APPLICABLE'|'OK'|'STALE', ageDays: number|null, lastReview: string|null }}
 */
export function evaluateUserDecisionStaleness(entry, now, reviewDays) {
  if (!isUserDecisionDebt(entry)) return { status: 'NOT_APPLICABLE', ageDays: null, lastReview: null };
  const lastReview = findLastReviewDate(entry);
  if (lastReview === null) return { status: 'NOT_APPLICABLE', ageDays: null, lastReview: null };
  const ageDays = computeAgeDays(lastReview, now);
  if (ageDays === null) return { status: 'NOT_APPLICABLE', ageDays: null, lastReview };
  const days =
    typeof reviewDays === 'number' && reviewDays >= 1 ? reviewDays : DEFAULT_USER_DECISION_REVIEW_DAYS;
  return { status: ageDays > days ? 'STALE' : 'OK', ageDays, lastReview };
}

/**
 * toIsoDate(now) — Date|ms → `YYYY-MM-DD` (재노출 마커 안내용). 무효 시 빈 문자열.
 */
export function toIsoDate(now) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * validate(parsed, knownAdrNumbers, options) — 8 카테고리 적용.
 *
 * @param {object} parsed - parsePendingWiring 결과
 * @param {Set<string>} knownAdrNumbers - INDEX.md 등재 ADR 번호
 * @param {object} [options]
 * @param {string} [options.rootDir] - 모듈 경로 검증 기준 디렉토리 (G1). 미전달 시 G1 skip.
 * @param {Date}   [options.now]     - SLA 평가 기준 시각 (H1~H2). 미전달 시 new Date() (ADR-0157 패턴).
 * @param {number} [options.graceDays] - SLA grace 일수 (H2). 미전달 시 ENV `WIRING_SLA_GRACE_DAYS` 또는 14.
 * @param {boolean}[options.slaDisabled] - SLA 정책 비활성 (긴급 운영 우회). 미전달 시 ENV `WIRING_SLA_DISABLED`.
 */
export function validate(parsed, knownAdrNumbers = new Set(), options = {}) {
  const violations = [];
  const { entries, categories, stats } = parsed;
  const {
    rootDir,
    now = new Date(),
    graceDays = getWiringSlaGraceDays(),
    slaDisabled = isWiringSlaDisabled(),
    userDecisionReviewDays = getUserDecisionReviewDays(),
    userDecisionReviewDisabled = isUserDecisionReviewDisabled(),
  } = options;

  // F) ID 형식
  for (const e of entries) {
    if (!ID_RE.test(e.id)) {
      violations.push({
        category: 'F_INVALID_ID',
        message: `백로그 ID 형식 위반: ${e.id} (기대: A1, B2, ... E6 패턴)`,
      });
    }
    // ID 카테고리 prefix 와 위치 카테고리 일치
    if (e.id.charAt(0) !== e.category) {
      violations.push({
        category: 'F_CATEGORY_MISMATCH',
        message: `백로그 ID ${e.id} 의 prefix 가 위치한 섹션 ${e.category} 와 불일치`,
      });
    }
  }

  // A) 상태 SSOT
  for (const e of entries) {
    if (!VALID_STATES.has(e.status)) {
      violations.push({
        category: 'A_INVALID_STATE',
        message: `${e.id}: 상태 "${e.status}" 무효 (허용: ${[...VALID_STATES].join('/')})`,
      });
    }
  }

  // B) 우선순위 SSOT
  for (const e of entries) {
    if (!VALID_PRIORITIES.has(e.priority)) {
      violations.push({
        category: 'B_INVALID_PRIORITY',
        message: `${e.id}: 우선순위 "${e.priority}" 무효 (허용: ${[...VALID_PRIORITIES].join('/')})`,
      });
    }
  }

  // C) ADR 참조 정합
  if (knownAdrNumbers.size > 0) {
    for (const e of entries) {
      for (const ref of e.adrRefs) {
        if (!knownAdrNumbers.has(ref)) {
          violations.push({
            category: 'C_UNKNOWN_ADR_REF',
            message: `${e.id}: 참조 ADR ${ref} — INDEX.md 미등재`,
          });
        }
      }
    }
  }

  // D) 카테고리 누락
  for (const c of EXPECTED_CATEGORIES) {
    if (!categories.has(c)) {
      violations.push({
        category: 'D_MISSING_CATEGORY',
        message: `카테고리 ${c}. 헤더 부재 — 5 카테고리 (A~E) 모두 정의 필요`,
      });
    }
  }

  // E) 진행 통계 자동 갱신
  if (stats) {
    // 실제 카운트 산출
    const actual = new Map();
    for (const c of EXPECTED_CATEGORIES) {
      actual.set(c, { total: 0, p0: 0, p1: 0, p2: 0, p3: 0 });
    }
    for (const e of entries) {
      const a = actual.get(e.category);
      if (a) {
        a.total++;
        const p = e.priority.toLowerCase();
        if (p === 'p0') a.p0++;
        else if (p === 'p1') a.p1++;
        else if (p === 'p2') a.p2++;
        else if (p === 'p3') a.p3++;
      }
    }

    for (const [c, expected] of stats) {
      const a = actual.get(c);
      if (!a) continue;
      if (a.total !== expected.total) {
        violations.push({
          category: 'E_STATS_MISMATCH',
          message: `진행 통계 ${c}.total=${expected.total} 표기 ≠ 실제 ${a.total}`,
        });
      }
      for (const k of ['p0', 'p1', 'p2', 'p3']) {
        if (a[k] !== expected[k]) {
          violations.push({
            category: 'E_STATS_MISMATCH',
            message: `진행 통계 ${c}.${k.toUpperCase()}=${expected[k]} 표기 ≠ 실제 ${a[k]}`,
          });
        }
      }
    }
  }

  // G) 백로그 등재 vs 실제 wiring 정합성 (PR-Governance-Followup-2)
  for (const e of entries) {
    // G1) 모듈 경로 파일 존재 검증
    //   - rootDir 미전달 시 skip (단위 테스트용)
    //   - placeholder (`(신규)` / `(정성)`) skip
    //   - 와일드카드 skip
    //   - 백틱 안 경로 0건 + placeholder 도 아니면 형식 오류
    if (rootDir) {
      const isPlaceholder = isModulePlaceholder(e.module);
      if (e.modulePaths.length === 0 && !isPlaceholder) {
        violations.push({
          category: 'G_MODULE_FORMAT',
          message: `${e.id}: 모듈 컬럼에 백틱 안 파일 경로 부재 — \`server/path.ts\` 또는 \`(신규)\` placeholder 필요. 현재: "${e.module.slice(0, 80)}"`,
        });
      } else if (!isPlaceholder) {
        for (const mp of e.modulePaths) {
          if (isWildcardPath(mp)) continue; // glob 은 skip
          if (!fileExistsAtRoot(rootDir, mp)) {
            violations.push({
              category: 'G_MODULE_FILE_MISSING',
              message: `${e.id}: 모듈 경로 \`${mp}\` 파일 부재 — 코드 이동·삭제·오타 의심. 백로그 SSOT drift 차단을 위해 경로 정정 또는 항목 제거 필요.`,
            });
          }
        }
      }
    }

    // G2) DECIDED_NOT_WIRING 항목은 reason 에 audit 추적성 인용 의무
    //   - PR 인용 / "완료" 키워드 / audit 산출물 인용 (`_workspace/`)
    //   - audit 추적성 부재 시 결정 근거 불명 (A3 stale 같은 결함 차단)
    if (e.status === 'DECIDED_NOT_WIRING') {
      if (!DECIDED_REASON_REF_RE.test(e.reason)) {
        violations.push({
          category: 'G_DECIDED_NO_AUDIT_REF',
          message: `${e.id}: DECIDED_NOT_WIRING 항목 reason 에 audit 추적성 인용 부재 — \`PR-...\` / \`완료\` / \`_workspace/...\` 중 하나 필수. 결정 근거 명시 의무.`,
        });
      }
    }

    // G3) INFRASTRUCTURE_ONLY / PARTIAL / BLOCKED 항목 reason 비어있음
    //   - 차단 사유 / 다음 액션 명시 의무
    //   - 6개월 stale 결함 (예: A3) 차단
    if (
      e.status === 'INFRASTRUCTURE_ONLY' ||
      e.status === 'PARTIAL' ||
      e.status === 'BLOCKED'
    ) {
      const trimmed = e.reason.replace(/[\s\-—|]+/g, '');
      if (trimmed.length < 5) {
        violations.push({
          category: 'G_EMPTY_REASON',
          message: `${e.id} (${e.status}): reason 컬럼이 비어있거나 너무 짧음 — 차단 사유 / 다음 액션 명시 의무.`,
        });
      }
    }
  }

  // H) SLA 자동 만료 (ADR-0158, PR-Governance-3-SLA)
  //    - H3 (등재일 형식) 은 항상 검증 — slaDisabled 와 무관
  //    - H1/H2 (SLA WARN/FAIL) 은 slaDisabled=true 시 skip (긴급 우회)
  for (const e of entries) {
    // H3) 등재일 형식 검증 — `YYYY-MM-DD` 또는 `—` / `-` 외 차단
    if (typeof e.enteredAt !== 'string' || !isValidEnteredAt(e.enteredAt)) {
      violations.push({
        category: 'H_INVALID_ENTERED_AT',
        message: `${e.id}: 등재일 형식 오류 "${e.enteredAt ?? '(부재)'}" — \`YYYY-MM-DD\` 또는 \`—\` 필요`,
      });
      continue; // 형식 오류 시 H1/H2 평가 건너뜀
    }

    // ENV 우회 — 정책 비활성 시 H1/H2 skip
    if (slaDisabled) continue;

    const sla = SLA_DAYS[e.priority];
    if (sla === null || sla === undefined) continue; // P3 / 알 수 없는 우선순위 면제
    if (isSlaExempt(e)) continue;

    const ageDays = computeAgeDays(e.enteredAt, now);
    if (ageDays === null) continue;

    if (ageDays > sla + graceDays) {
      // H2) SLA + grace 초과 — FAIL
      violations.push({
        category: 'H_SLA_FAIL',
        message: `${e.id} (${e.priority} ${e.status}): SLA 만료 — 등재일 ${e.enteredAt} 기준 ${ageDays}일 경과 (SLA ${sla}일 + grace ${graceDays}일 초과). wiring 완료 또는 BLOCKED 면제 사유 명시 필요.`,
      });
    } else if (ageDays > sla) {
      // H1) SLA 초과 — WARN (violations 에는 등재하되 카테고리로 EXIT 코드 분리)
      violations.push({
        category: 'H_SLA_WARN',
        message: `${e.id} (${e.priority} ${e.status}): SLA 임박 — 등재일 ${e.enteredAt} 기준 ${ageDays}일 경과 (SLA ${sla}일 초과, grace ${graceDays}일 윈도우 내). ${sla + graceDays - ageDays}일 후 빌드 FAIL.`,
      });
    }
  }

  // I) 사용자결정 부채 재검토 (PR-Governance-StaleUserDecision) — informational WARN (EXIT=0)
  //    방치돼 맥락 휘발된 "사용자 결정" / "SL 이후 추천" BLOCKED 항목을 N일(기본 30) 무변동 시 재노출.
  if (!userDecisionReviewDisabled) {
    for (const e of entries) {
      const r = evaluateUserDecisionStaleness(e, now, userDecisionReviewDays);
      if (r.status === 'STALE') {
        violations.push({
          category: 'I_USER_DECISION_STALE',
          message: `${e.id} (${e.priority} ${e.status}): 사용자결정 부채 ${r.ageDays}일 무변동 (재검토 임계 ${userDecisionReviewDays}일 초과, 최종 검토 ${r.lastReview}) — 재검토 권고. 유지 시 reason 에 "재노출 ${toIsoDate(now)}" 갱신(clock 리셋) / 폐기 시 항목 제거.`,
        });
      }
    }
  }

  return {
    violations,
    summary: {
      entryCount: entries.length,
      categoryCount: categories.size,
      knownAdrCount: knownAdrNumbers.size,
      hasStats: stats !== null,
      slaDisabled,
      graceDays,
    },
  };
}

/* ───────── 메인 ───────── */

// PR-Governance-3-SLA: H_SLA_WARN 은 informational (EXIT=0), 그 외 위반은 FAIL (EXIT=1)
const WARN_ONLY_CATEGORIES = new Set(['H_SLA_WARN', 'I_USER_DECISION_STALE']);

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  if (!existsSync(PENDING_PATH)) {
    console.error(`[PendingWiring] FAIL — 파일 부재: ${PENDING_PATH}`);
    process.exit(1);
  }

  const pendingSrc = readFileSync(PENDING_PATH, 'utf-8');
  const indexSrc = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf-8') : '';
  const knownAdrNumbers = extractAllAdrNumbers(indexSrc);
  const parsed = parsePendingWiring(pendingSrc);
  const { violations, summary } = validate(parsed, knownAdrNumbers, { rootDir: ROOT });

  // PR-Governance-3-SLA: WARN-only 와 FAIL 분리
  const warns = violations.filter((v) => WARN_ONLY_CATEGORIES.has(v.category));
  const fails = violations.filter((v) => !WARN_ONLY_CATEGORIES.has(v.category));

  if (json) {
    console.log(JSON.stringify({ summary, violations, warns, fails }, null, 2));
    process.exit(fails.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    console.log(
      `[PendingWiring] OK — ${summary.entryCount}개 항목 / ` +
        `${summary.categoryCount}개 카테고리 / ` +
        `통계 표 ${summary.hasStats ? '정합' : '부재'} / ` +
        `참조 ADR ${summary.knownAdrCount}건 검증` +
        (summary.slaDisabled ? ' / ⚠️ SLA disabled (ENV)' : ` / SLA grace ${summary.graceDays}일`)
    );
    return;
  }

  // WARN 만 있고 FAIL 부재 시 informational 모드
  if (fails.length === 0 && warns.length > 0) {
    scriptWarn(`[PendingWiring] WARN — ${warns.length}건 (informational, EXIT=0 — SLA 임박 / 사용자결정 재검토):`);
    for (const w of warns.slice(0, 20)) scriptWarn(`  ⚠️  ${w.message}`);
    if (warns.length > 20) scriptWarn(`  ... ${warns.length - 20}건 더`);
    return;
  }

  console.error(`[PendingWiring] FAIL — ${fails.length}건 위반${warns.length > 0 ? ` + WARN ${warns.length}건` : ''}:`);
  const byCategory = new Map();
  for (const v of fails) {
    if (!byCategory.has(v.category)) byCategory.set(v.category, []);
    byCategory.get(v.category).push(v.message);
  }
  for (const [cat, msgs] of byCategory) {
    console.error(`  [${cat}] ${msgs.length}건:`);
    for (const m of msgs.slice(0, 10)) console.error(`    - ${m}`);
    if (msgs.length > 10) console.error(`    ... ${msgs.length - 10}건 더`);
  }
  if (warns.length > 0) {
    scriptWarn(`  [WARN] ${warns.length}건 (informational — SLA 임박 / 사용자결정 재검토):`);
    for (const w of warns.slice(0, 5)) scriptWarn(`    ⚠️  ${w.message}`);
    if (warns.length > 5) scriptWarn(`    ... ${warns.length - 5}건 더`);
  }
  console.error('');
  console.error(
    '해결: _workspace/PENDING_WIRING.md 갱신 — 신규 PR 머지 시 wiring 미완 항목 등재 + 완료 시 제거 의무.'
  );
  console.error(
    'SLA 우회: WIRING_SLA_GRACE_DAYS=N (0~30 일) / WIRING_SLA_DISABLED=true (긴급 운영).'
  );
  process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check_pending_wiring.js');
if (isMain) {
  main();
}
