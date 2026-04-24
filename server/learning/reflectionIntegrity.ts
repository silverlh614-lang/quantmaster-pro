/**
 * reflectionIntegrity.ts — Reflection Integrity Guard (#14).
 *
 * 목적: LLM 할루시네이션으로 "원천 없는 교훈"이 누적되는 것을 차단한다.
 *
 * 규칙:
 *   1. 모든 claim 은 sourceIds[] 가 최소 1건 이상이어야 한다.
 *   2. sourceIds 는 반드시 오늘 수집된 원천 집합(knownSourceIds)에 존재해야 한다.
 *   3. sourceIds 가 전부 누락·미존재인 claim 은 자동 삭제.
 *   4. JSON 파싱 실패 시 IntegrityAuditResult.parseFailed = true 로 마크.
 *
 * 추가: Gemini 호출 시 temperature=0.2 고정은 호출부(nightlyReflectionEngine)에서
 *       REFLECTION_TEMPERATURE 상수를 통해 강제한다. 본 모듈은 출력 검증을 담당.
 */

import type {
  ReflectionReport,
  TraceableClaim,
  IntegrityAuditResult,
} from './reflectionTypes.js';

export const REFLECTION_TEMPERATURE = 0.2;
// ADR-0009: JSON 응답 길이 상한 상향 (2048 → 4096). 기존 2048 에서 JSON 이 잘려 파싱
// 실패 → template fallback 로그가 매일 반복되던 문제를 해소한다.
export const REFLECTION_MAX_OUTPUT_TOKENS = 4096;

/** 원천 검증 통과한 claim 만 남긴다. 삭제된 claim 텍스트는 removed[] 에 기록. */
function filterClaims(
  claims: TraceableClaim[] | undefined,
  knownSourceIds: Set<string>,
  removed: string[],
): TraceableClaim[] {
  if (!claims || claims.length === 0) return [];
  const out: TraceableClaim[] = [];
  for (const c of claims) {
    if (!c || typeof c.text !== 'string' || c.text.trim().length === 0) {
      if (c?.text) removed.push(c.text);
      continue;
    }
    const ids = Array.isArray(c.sourceIds) ? c.sourceIds.filter(id => typeof id === 'string' && id.length > 0) : [];
    // knownSourceIds 가 비어 있으면(샘플 無) 그대로 통과 — 삭제하면 학습 동결됨.
    const valid = knownSourceIds.size === 0
      ? ids.length > 0
      : ids.some(id => knownSourceIds.has(id));
    if (!valid) {
      removed.push(c.text);
      continue;
    }
    out.push({ text: c.text.trim(), sourceIds: ids });
  }
  return out;
}

export interface IntegrityGuardOptions {
  /** Gemini 응답 파싱 실패 여부 — report.integrity.parseFailed 로 전파 */
  parseFailed?: boolean;
}

/**
 * 반성 리포트에 Integrity Guard 를 적용한다.
 * 입력 리포트는 in-place 수정되며 감사 결과가 report.integrity 에 저장된다.
 * 기존 report.integrity.parseFailed 플래그는 보존된다.
 */
export function applyIntegrityGuard(
  report: ReflectionReport,
  knownSourceIds: Iterable<string>,
  opts: IntegrityGuardOptions = {},
): IntegrityAuditResult {
  const knownSet = knownSourceIds instanceof Set ? knownSourceIds : new Set(knownSourceIds);
  const removed: string[] = [];
  const claimsIn =
    (report.keyLessons?.length ?? 0) +
    (report.questionableDecisions?.length ?? 0) +
    (report.tomorrowAdjustments?.length ?? 0) +
    (report.followUpActions?.length ?? 0);

  report.keyLessons = filterClaims(report.keyLessons, knownSet, removed);
  report.questionableDecisions = filterClaims(report.questionableDecisions, knownSet, removed);
  report.tomorrowAdjustments = filterClaims(report.tomorrowAdjustments, knownSet, removed);
  report.followUpActions = filterClaims(report.followUpActions, knownSet, removed);

  const claimsOut =
    report.keyLessons.length +
    report.questionableDecisions.length +
    report.tomorrowAdjustments.length +
    report.followUpActions.length;

  const parseFailed = opts.parseFailed ?? report.integrity?.parseFailed;
  const audit: IntegrityAuditResult = {
    claimsIn,
    claimsOut,
    removed,
    ...(parseFailed ? { parseFailed: true } : {}),
  };
  report.integrity = audit;
  return audit;
}

/**
 * LLM 응답 (JSON 문자열) 을 안전 파싱한다.
 * 실패 시 null + parseFailed 플래그를 세팅할 수 있도록 호출부에서 처리.
 */
export function parseReflectionJson(raw: string | null | undefined): Partial<ReflectionReport> | null {
  if (!raw) return null;
  // ```json ... ``` fenced block 제거
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as Partial<ReflectionReport>;
  } catch {
    // 첫 { 부터 마지막 } 까지만 추출 재시도
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1)) as Partial<ReflectionReport>;
      } catch {
        return null;
      }
    }
    return null;
  }
}
