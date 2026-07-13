/**
 * @responsibility R3 레짐 빈스캔 Sanity Check — 시장 문제 vs 시스템 문제 자동 감지
 *
 * ADR-0120 (PR-B): 사용자 9번 §6 직접 반영. R3_EARLY 같은 *허용적 레짐* 에서
 * Gate 1 통과 종목 0개면 시장 문제가 아니라 *시스템 결함* 일 가능성 높음
 * (Gate threshold 과도 / 가격 데이터 오류 / 섹터 매핑 오류 / universe 누락).
 *
 * 본 모듈은 read-only 진단 — 자동 매매 결정 무영향. SanityViolation 발생 시
 * 운영자에게 텔레그램 HIGH 알림 (24h dedupeKey).
 */

import type { ScanSummary } from './scanDiagnostics.js';

/** R3 Sanity Check 임계 SSOT — 사용자 9번 §6 정합. */
export const R3_SANITY_THRESHOLDS = {
  /** Gate 1 통과 최소 기대값 — 미달 시 SanityViolation */
  MIN_GATE1_PASS: 1,
  /** candidates 최소 기대값 — 워치리스트 비어있지 않음 가드 */
  MIN_CANDIDATES: 1,
} as const;

type R3SanityViolationType =
  | 'NONE'
  | 'GATE1_PASS_ZERO'        // candidates>0 인데 Gate 1 통과 0개
  | 'GATE_PASS_DATA_MISSING' // gatePassDistribution 미수집 (PR-B wiring 미완)
  | 'CANDIDATES_ZERO';       // candidates 0 (universe 발굴 또는 워치리스트 실패)

export interface R3SanityResult {
  violation: R3SanityViolationType;
  isR3: boolean;
  /** 텔레그램 메시지용 진단 텍스트 */
  message: string;
  /** Sanity 위반 발생 시 dedupeKey suffix (KST 일자) */
  dedupeKey?: string;
}

/**
 * R3 Sanity Check SSOT — ScanSummary 기반 진단.
 *
 * @returns violation='NONE' 시 정상 / 외 violation 분기 + 텔레그램 메시지 빌드
 */
export function evaluateR3Sanity(summary: ScanSummary | null): R3SanityResult {
  if (!summary) {
    return { violation: 'NONE', isR3: false, message: '' };
  }

  const regime = summary.macroGateState?.regime ?? '';
  const isR3 = regime.startsWith('R3');

  if (!isR3) {
    return { violation: 'NONE', isR3: false, message: '' };
  }

  // R3 + entries > 0 → 정상 동작
  if (summary.entries > 0) {
    return { violation: 'NONE', isR3: true, message: '' };
  }

  const kstDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

  // R3 + candidates 0 → 워치리스트/universe 결함
  if (summary.candidates < R3_SANITY_THRESHOLDS.MIN_CANDIDATES) {
    return {
      violation: 'CANDIDATES_ZERO',
      isR3: true,
      message:
        `🚨 <b>[R3 Sanity Violation]</b>\n` +
        `R3 레짐 (${regime}) 인데 후보 종목 0개 — 시장 문제 아닌 시스템 결함 의심.\n` +
        `점검 항목: autoPopulateWatchlist / universe 발굴 / KIS 토큰 / 회로차단기.`,
      dedupeKey: `r3_sanity_candidates_zero:${kstDate}`,
    };
  }

  // R3 + GatePassDistribution 부재 → wiring 미완 진단
  const gpd = summary.gatePassDistribution;
  if (!gpd) {
    return {
      violation: 'GATE_PASS_DATA_MISSING',
      isR3: true,
      message:
        `⚠️ <b>[R3 Sanity Diagnostic]</b>\n` +
        `R3 레짐 + 매수 0건 — GatePassDistribution 데이터 미수집 (ADR-0120 wiring 미완).\n` +
        `진단 정확도 격하. /scan_blockers 결과 + 운영 데이터 누적 후 후속 PR 처리.`,
      dedupeKey: `r3_sanity_gpd_missing:${kstDate}`,
    };
  }

  // R3 + GatePassDistribution 수집 + Gate 1 통과 0 → 시스템 결함 의심 (사용자 §6 핵심 시나리오)
  if (gpd.gate1Pass < R3_SANITY_THRESHOLDS.MIN_GATE1_PASS) {
    return {
      violation: 'GATE1_PASS_ZERO',
      isR3: true,
      message:
        `🚨 <b>[R3 Sanity Violation — 시스템 결함 의심]</b>\n` +
        `R3 레짐 (${regime}) + 후보 ${summary.candidates}개인데 Gate 1 통과 0개.\n` +
        `시장 문제가 아닌 시스템 결함 가능성:\n` +
        `  • Gate threshold 과도 (EXECUTION_RELAXATION_ENABLED 시도 권장)\n` +
        `  • 가격 데이터 오류 (Yahoo stale base — PR-C 검토)\n` +
        `  • 섹터/레짐 매핑 오류\n` +
        `  • 종목 universe 누락\n` +
        `  • 27조건 점수 산출 결함\n` +
        `즉시 /health + /scan_blockers 점검 필요.`,
      dedupeKey: `r3_sanity_gate1_zero:${kstDate}`,
    };
  }

  // R3 + Gate 1 통과 ≥ 1 → 정상 (시장 대기 또는 Gate 2/3 미달)
  return { violation: 'NONE', isR3: true, message: '' };
}
