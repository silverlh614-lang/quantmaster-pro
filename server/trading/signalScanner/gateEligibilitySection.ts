/**
 * @responsibility ADR-0436 Gate Eligibility Split — `/scan_blockers` 진단 섹션 SSOT.
 *
 * scanDiagnostics.ts 1500줄 한계 회피 위해 분리 (ADR-0133). 표시 layer 만 — 진단
 * 영속/의사결정 layer 무관. 6 카운터 + R3 streak skip 사유 노출.
 *
 * 사용자 §5 — `/scan_blockers` 신규 섹션 빌더. shadowObservableCount=undefined 시
 * 미노출 (ENV OFF 또는 ADR-0436 미작동, 후방호환).
 *
 * 사용자 명시 invariants (정적 grep 가드 보존):
 *   - "Gate threshold 완화" / "LOOSEN_GATE" 메시지 영구 차단
 *   - SHADOW_OBSERVABLE > 0 시 자동 paper/live 승격 0
 */

import type { ScanSummary } from './scanDiagnostics.js';

/**
 * ADR-0436 — Gate Eligibility Split 진단 섹션 SSOT.
 *
 * 출력 형식 (한국어, HTML escape — 표시 only):
 *   🎯 <b>[Gate Eligibility Split (ADR-0436)]</b>
 *     • Live eligible: N건
 *     • Shadow observable: M건 (학습/관측 후보 — 자동 매수 차단)
 *     • Data unavailable: K건 (SUPPLY/INVESTOR_FLOW/EARNINGS)
 *     • Provider degraded: P건 (SECTOR_STALE/PRICE_DEGRADED)
 *     • True gate fail: L건 (진짜 임계 미달)
 *     • Hard risk blocked: H건 (MACRO/RISK)
 *     • R3 streak skip: <none | shadowObservablePresent>
 *
 * null 반환 조건:
 *   - summary.shadowObservableCount === undefined (ENV OFF 또는 ADR-0436 미작동)
 *   - 모든 카운터 0 (의미 있는 분해 없음)
 */
export function formatGateEligibilitySplitSection(
  summary: ScanSummary | null | undefined,
): string | null {
  if (!summary) return null;
  // 후방호환: shadowObservableCount=undefined 시 ADR-0436 미작동 (ENV OFF) — 미노출
  if (summary.shadowObservableCount === undefined) return null;

  const live = summary.liveEligibleCount ?? 0;
  const shadow = summary.shadowObservableCount;
  const dataUnavail = summary.dataUnavailableBlockedCount ?? 0;
  const providerDeg = summary.providerDegradedObservableCount ?? 0;
  const trueGate = summary.trueGateFailCount ?? 0;
  const hardRisk = summary.hardRiskBlockedCount ?? 0;

  // 모든 카운터 0 시 미노출 (의미 있는 분해 없음)
  if (
    live === 0 &&
    shadow === 0 &&
    dataUnavail === 0 &&
    providerDeg === 0 &&
    trueGate === 0 &&
    hardRisk === 0
  ) {
    return null;
  }

  const lines: string[] = [];
  lines.push('🎯 <b>[Gate Eligibility Split (ADR-0436)]</b>');
  lines.push(`  • Live eligible: <b>${live}건</b>`);
  if (shadow > 0) {
    lines.push(
      `  • Shadow observable: <b>${shadow}건</b> (학습/관측 후보 — 자동 매수 차단)`,
    );
  } else {
    lines.push(`  • Shadow observable: ${shadow}건`);
  }
  if (dataUnavail > 0) {
    lines.push(
      `  • Data unavailable: ${dataUnavail}건 (SUPPLY/INVESTOR_FLOW/EARNINGS)`,
    );
  }
  if (providerDeg > 0) {
    lines.push(
      `  • Provider degraded: ${providerDeg}건 (SECTOR_STALE/PRICE_DEGRADED)`,
    );
  }
  if (trueGate > 0) {
    lines.push(`  • True gate fail: ${trueGate}건 (진짜 임계 미달)`);
  }
  if (hardRisk > 0) {
    lines.push(`  • Hard risk blocked: ${hardRisk}건 (MACRO/RISK)`);
  }

  // R3 streak skip 사유 (사용자 §5 명시)
  if (summary.gate2SoftLeadershipLane) {
    const lane = summary.gate2SoftLeadershipLane;
    lines.push(`  - Gate1 hard survivors: ${lane.gate1HardSurvivors}`);
    lines.push(`  - MinSignal live pass: ${lane.minSignalLivePass}`);
    lines.push(`  - Gate2 pending preserved: ${lane.gate2PendingPreserved}`);
    lines.push(`  - Soft leadership lanes: ${lane.labels.join(',')}`);
    lines.push(`  - shadowObservablePreserved=${lane.shadowObservablePreserved}`);
    lines.push(`  - watchPreserved=${lane.watchPreserved}`);
    lines.push(`  - gateCounterfactualRecorded=${lane.counterfactualRecorded}`);
    lines.push(`  - executionImpact=${lane.executionImpact}`);
  }

  const streakSkipReason =
    summary.r3StreakSkipped?.skipped === true
      ? `r3StreakSkipped (${summary.r3StreakSkipped.reason ?? 'unknown'})`
      : shadow > 0
        ? 'shadowObservablePresent (ADR-0436 streak 누적 차단)'
        : 'none';
  lines.push(`  • R3 streak skip 사유: ${streakSkipReason}`);

  // 사용자 명시 핵심 원칙 메시지 (operator 가이드)
  if (shadow > 0 && live === 0) {
    lines.push('');
    lines.push(
      '<i>실매수 후보 0 ≠ 학습/관측 후보 0 — DATA_UNAVAILABLE/PROVIDER_DEGRADED 우세 시 학습 ledger 보존, 자동 매수 승격 0.</i>',
    );
  }

  return lines.join('\n');
}
