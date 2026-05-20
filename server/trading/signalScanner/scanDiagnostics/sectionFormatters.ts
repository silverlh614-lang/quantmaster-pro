/**
 * @responsibility Scan diagnostic section formatters for R3 frozen quote provider degraded price integrity.
 * ADR-0001 scan diagnostics core split.
 */

import { type R3ViolationStateResult } from '../r3ViolationStateMachine.js';
import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { FrozenQuoteResult } from '../frozenQuoteDetector.js';
import type { PriceIntegrityStatus } from '../priceIntegrityChecker.js';
import type { PriceCorrectionType } from '../priceCorrectionEngine.js';

/**
 * ADR-0401 — 5단계 state 별 메시지 빌더 SSOT.
 * 본문은 ADR-0120 의 r3SanityCheck 메시지 그대로 + state 헤더 + 누적 count + guard 사유.
 */
export function formatR3StateMessage(state: R3ViolationStateResult, baseMessage: string): string {
  const stateHeader: Record<R3ViolationStateResult['state'], string> = {
    CLEAN: '✅ <b>[R3 Sanity — CLEAN]</b>',
    WARNING: '🟡 <b>[R3 Sanity — WARNING]</b>',
    ELEVATED: '🟠 <b>[R3 Sanity — ELEVATED]</b>',
    SHADOW_ONLY: '⚫️ <b>[R3 Sanity — SHADOW_ONLY (신규 진입 차단, 학습 유지)]</b>',
    HARD_BLOCK: '🚨 <b>[R3 Sanity — HARD_BLOCK (영속 latch 활성)]</b>',
  };
  const lines: string[] = [];
  lines.push(stateHeader[state.state]);
  lines.push(
    `누적 ${state.consecutiveCount}회 (임계: warning ${state.profile.warningAt}/elevated ${state.profile.elevatedAt}/` +
      `shadow ${state.profile.shadowOnlyAt}/hard ${state.profile.hardBlockAt}, regime=${state.regime})`,
  );
  if (state.guardReasons.length > 0) {
    lines.push(`hardBlock guards 활성: ${state.guardReasons.slice(0, 3).join('; ')}`);
  }
  lines.push('');
  lines.push(baseMessage);
  if (state.state === 'HARD_BLOCK') {
    lines.push('');
    lines.push('해제: <code>/r3_unblock</code> (텔레그램, ADR-0195) 또는 ENV ACK (ADR-0120)');
  } else if (state.state === 'SHADOW_ONLY') {
    lines.push('');
    lines.push('<i>다음 정상 스캔 (위반 없음 또는 24h decay) 시 자동 회복 — 영속 latch 없음 (ADR-0401).</i>');
  }
  return lines.join('\n');
}

// ─── ADR-0118 §"진단 추정" 확장 — TECHNICAL_PROVIDER_DEGRADED 운영자 노출 ───
/**
 * ADR-0411 의 Yahoo↔KIS 괴리 KIS recovery 종목 마커 (`technicalProviderDegraded=true`)
 * 를 운영자가 `/scan_blockers` 1 명령으로 즉시 인지하도록 표면화. 시계열 evaluator
 * 14개 PROVIDER_DEGRADED 강등 → score=0 자연 진입 차단 상태 가시화.
 *
 * ENV `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true` 시 섹션 미노출 (default ON).
 * ADR-0157 정확 비교 의무 정합.
 */
const TECHNICAL_PROVIDER_DEGRADED_TOP_N = 5;

export function isScanBlockersProviderDegradedDisabled(): boolean {
  return process.env.SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED === 'true';
}

function formatKstHm(iso: string | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const kst = new Date(ts + 9 * 3_600_000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * TECHNICAL_PROVIDER_DEGRADED 종목 섹션 SSOT 빌더.
 *
 * 입력: WatchlistEntry 배열 (호출자 책임 — `loadWatchlist()` 결과 그대로).
 * 출력: 섹션 string 또는 null.
 *
 * null 반환 조건:
 *   - ENV `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true`
 *   - degraded 종목 0건
 *
 * 정렬: `technicalProviderDegradedAt` 내림차순 (최신 먼저), 부재 시 `addedAt` fallback,
 * 잘못된 ISO 도 안전 fallback (정렬 후순위).
 *
 * Top N 기본 5, 초과 시 "외 M개" 라벨.
 */
export function formatTechnicalProviderDegradedSection(
  entries: ReadonlyArray<WatchlistEntry>,
  options: { topN?: number } = {},
): string | null {
  if (isScanBlockersProviderDegradedDisabled()) return null;

  const degraded = entries.filter((e) => e.technicalProviderDegraded === true);
  if (degraded.length === 0) return null;

  const topN = Math.max(1, options.topN ?? TECHNICAL_PROVIDER_DEGRADED_TOP_N);

  const sorted = [...degraded].sort((a, b) => {
    const aIso = a.technicalProviderDegradedAt ?? a.addedAt;
    const bIso = b.technicalProviderDegradedAt ?? b.addedAt;
    const aTs = Date.parse(aIso);
    const bTs = Date.parse(bIso);
    const aValid = Number.isFinite(aTs);
    const bValid = Number.isFinite(bTs);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1; // invalid → after valid
    if (!bValid) return -1;
    return bTs - aTs; // desc
  });

  const shown = sorted.slice(0, topN);
  const remaining = degraded.length - shown.length;

  const lines: string[] = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('⚠️ <b>[기술 데이터 PROVIDER_DEGRADED]</b>');
  lines.push('Yahoo↔KIS 괴리로 시계열 evaluator 강등 (ADR-0411)');
  lines.push('');
  lines.push(`대상 ${degraded.length}개${remaining > 0 ? ` — Top ${topN}` : ''}:`);
  for (const entry of shown) {
    const tsLabel = formatKstHm(entry.technicalProviderDegradedAt);
    lines.push(`  • ${entry.code} ${entry.name}${tsLabel ? ` (${tsLabel} KST)` : ''}`);
  }
  if (remaining > 0) {
    lines.push(`  • 외 ${remaining}개`);
  }
  lines.push('');
  lines.push('영향:');
  lines.push('  • 신규 진입 자연 차단 (시계열 evaluator score=0)');
  lines.push('  • 학습 데이터 계속 수집');
  lines.push('  • WATCHLIST_HOLD — universe 보존');

  return lines.join('\n');
}

// ─── ADR-0412 — Frozen Quote Detector + R3 Streak Skip 표시 ───
/**
 * Frozen Quote 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용.
 *
 * dataQuality === 'OK' 시 null (간결성 — 정상 시 미노출).
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 금지 (frozen quote 는 데이터 품질 진단, 매수 차단 아님)
 *   - "결함" / "에러" 표현 금지 — "데이터 품질 문제" 로 분류
 */
export function formatFrozenQuoteSection(fq: FrozenQuoteResult | undefined | null): string | null {
  if (!fq) return null;
  if (fq.dataQuality === 'OK') return null;

  const icon = fq.dataQuality === 'STALE' ? '🔴' : '🟠';
  const label = fq.dataQuality === 'STALE' ? 'STALE' : 'SUSPECT';
  const ratioPct = (fq.frozenRatio * 100).toFixed(1);
  const lines: string[] = [];
  lines.push('');
  lines.push(`${icon} <b>[Frozen Quote — 데이터 품질 진단]</b>`);
  lines.push(
    `  • dataQuality: <b>${label}</b> (${ratioPct}%, ${fq.frozenCount}/${fq.comparableCount} 종목)`,
  );
  lines.push(`  • 사유: ${fq.reason}`);
  if (fq.symbols.length > 0) {
    lines.push(`  • 영향 종목: ${fq.symbols.slice(0, 5).join(', ')}${fq.symbols.length > 5 ? ` 외 ${fq.symbols.length - 5}개` : ''}`);
  }
  lines.push('');
  lines.push('영향 (ADR-0412):');
  lines.push('  • R3 hard block 누적 제외 (입력 데이터 오염 — guard 활성)');
  lines.push('  • Shadow learning 유지 — 학습 데이터 보존');
  lines.push('  • <i>가격 데이터 품질 문제 — 다음 스캔 시 자동 회복 가능</i>');

  return lines.join('\n');
}

/**
 * R3 Streak Skip 라인 빌더 — `/scan_blockers` 메시지 추가용.
 *
 * `skipped=false` 시 null (정상 누적 — 미노출).
 * 사용자 명시:
 *   - "R3 hard block 누적 제외" 표현 사용 (매수 차단 아님)
 */
export function formatR3StreakSkipLine(skip: { skipped: boolean; reason?: string } | undefined | null): string | null {
  if (!skip || !skip.skipped) return null;

  const reasonLabels: Record<string, string> = {
    KRX_NON_TRADING_DAY: 'KRX_NON_TRADING_DAY (휴장일/주말)',
    VOLUME_CLOCK_CLOSED: 'VOLUME_CLOCK_CLOSED (점심·장외 시간대)',
    EMERGENCY_STOP: 'EMERGENCY_STOP (운영자 비상정지)',
    MANUAL_BLOCK_NEW_BUY: 'MANUAL_BLOCK_NEW_BUY (운영자 수동 가드)',
    SELL_ONLY_MODE: 'SELL_ONLY_MODE (운영자 정책 차단)',
    R6_DEFENSE_REGIME: 'R6_DEFENSE_REGIME (블랙스완 방어)',
    VIX_BLOCK: 'VIX_BLOCK (VIX 게이팅)',
    FOMC_BLOCK: 'FOMC_BLOCK (FOMC 게이팅)',
    BLOCKED_DAY_SCAN: 'BLOCKED_DAY_SCAN (거시 게이트)',
    DATA_STARVED_SCAN: 'DATA_STARVED_SCAN (MTAS/DART 결손)',
    FROZEN_QUOTE_STALE: 'FROZEN_QUOTE_STALE (입력 데이터 오염)',
  };
  const label = skip.reason ? (reasonLabels[skip.reason] ?? skip.reason) : '미상';

  return `⏸ <b>[R3 Streak]</b> R3 hard block 누적 제외 — ${label} (ADR-0412/0419)`;
}

// ─── ADR-0414 — Price Integrity Checker + Correction Overlay (Stage 1 Read-Only) ───
/**
 * Price Integrity 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용 (Stage 1 Read-Only).
 *
 * 모든 status === 'OK' 시 null (간결성 — 정상 시 미노출).
 *
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 **금지** — Stage 1 Read-Only, 진단 only.
 *   - "결함" / "에러" 표현 **금지** — "데이터 품질 문제" (ADR-0412 정합).
 *   - Stage 1 표기 — "관측 + 검증" 명시.
 */
export function formatPriceIntegritySection(
  pi:
    | {
        totalSamples: number;
        statusCounts: Record<PriceIntegrityStatus, number>;
        topAffected: Array<{ symbol: string; status: PriceIntegrityStatus }>;
      }
    | undefined
    | null,
): string | null {
  if (!pi) return null;
  if (pi.totalSamples <= 0) return null;
  // OK 외 status 카운트 합산 — 모두 0 시 미노출
  const affectedTotal =
    (pi.statusCounts.SUSPECT ?? 0) +
    (pi.statusCounts.STALE ?? 0) +
    (pi.statusCounts.FROZEN_QUOTE ?? 0) +
    (pi.statusCounts.PRICE_BASE_MISMATCH ?? 0) +
    (pi.statusCounts.REVERSE_GAP_SUSPECT ?? 0) +
    (pi.statusCounts.FAILED ?? 0);
  if (affectedTotal === 0) return null;

  const lines: string[] = [];
  lines.push('');
  lines.push('🔍 <b>[Price Integrity — Stage 1 관측]</b>');
  lines.push(
    `  • 표본 ${pi.totalSamples}개 / 영향 ${affectedTotal}개 (OK 외)`,
  );
  // 분포 상위 표기 — 0건 status 미노출
  const orderedStatuses: ReadonlyArray<PriceIntegrityStatus> = [
    'PRICE_BASE_MISMATCH',
    'STALE',
    'REVERSE_GAP_SUSPECT',
    'SUSPECT',
    'FROZEN_QUOTE',
    'FAILED',
  ];
  for (const s of orderedStatuses) {
    const c = pi.statusCounts[s] ?? 0;
    if (c > 0) {
      lines.push(`  • ${s}: ${c}개`);
    }
  }
  if (pi.topAffected.length > 0) {
    const top = pi.topAffected.slice(0, 5);
    const top5 = top.map((t) => `${t.symbol}(${t.status})`).join(', ');
    const remain = pi.topAffected.length - top.length;
    lines.push(
      `  • 영향 종목 Top: ${top5}${remain > 0 ? ` 외 ${remain}개` : ''}`,
    );
  }
  lines.push('');
  lines.push('영향 (ADR-0414, Stage 1):');
  lines.push('  • 데이터 품질 진단 — 매수 차단 아님');
  lines.push('  • <i>관측 + 검증 단계 — 의사결정 변경 0건</i>');

  return lines.join('\n');
}

/**
 * Price Correction Overlay 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용 (Stage 1 Read-Only).
 *
 * `correctionType` 분포 + averageConfidence + DROP_GAP_CALCULATION 카운트 노출.
 * `correctionType === 'NONE'` 만 있을 시 null (정상 — 미노출).
 *
 * **Stage 1 정책 명시** — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
 */
export function formatPriceCorrectionOverlaySection(
  pc:
    | {
        totalSamples: number;
        correctionTypeCounts: Record<PriceCorrectionType, number>;
        averageConfidence: number;
        dropGapCalculationCount: number;
        shadowOnlySuggestedCount: number;
      }
    | undefined
    | null,
): string | null {
  if (!pc) return null;
  if (pc.totalSamples <= 0) return null;
  const noneCount = pc.correctionTypeCounts.NONE ?? 0;
  const totalNonNone = pc.totalSamples - noneCount;
  if (totalNonNone <= 0) return null;

  const lines: string[] = [];
  lines.push('');
  lines.push('🛠 <b>[Price Correction Overlay — Stage 1 Read-Only]</b>');
  lines.push(
    `  • 표본 ${pc.totalSamples}개 / 보정 후보 ${totalNonNone}개 (NONE 제외)`,
  );
  lines.push(
    `  • 평균 confidence: ${pc.averageConfidence.toFixed(3)}`,
  );
  // 분포 상위 표기 — 0건 type 미노출, NONE 마지막
  const orderedTypes: ReadonlyArray<PriceCorrectionType> = [
    'USE_KIS_CURRENT',
    'USE_KRX_PREV_CLOSE',
    'USE_RECENT_DAILY_CLOSE',
    'DROP_GAP_CALCULATION',
    'SHADOW_ONLY',
  ];
  for (const t of orderedTypes) {
    const c = pc.correctionTypeCounts[t] ?? 0;
    if (c > 0) {
      lines.push(`  • ${t}: ${c}개`);
    }
  }
  if (pc.dropGapCalculationCount > 0) {
    lines.push(
      `  • <i>DROP_GAP_CALCULATION ${pc.dropGapCalculationCount}건 — 사용자 명시: 틀린 gap 계산보다 gap 미사용 우월</i>`,
    );
  }
  if (pc.shadowOnlySuggestedCount > 0) {
    lines.push(
      `  • SHADOW_ONLY ${pc.shadowOnlySuggestedCount}건 — 보정 불가, Shadow learning 만`,
    );
  }
  lines.push('');
  lines.push('영향 (ADR-0414, Stage 1):');
  lines.push('  • <b>corrected 값 LIVE 매수 판단 사용 0건</b> (절대 원칙 #3)');
  lines.push('  • 관측 + 검증만 — 의사결정 변경은 Stage 2/3 후속 PR');

  return lines.join('\n');
}
