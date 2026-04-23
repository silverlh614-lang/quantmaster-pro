/**
 * kellyHealthCard.ts — Idea 5: 종목별 Kelly 헬스 카드 포맷터.
 *
 * entryKellySnapshot(Idea 1) 을 기준으로 각 활성 포지션의 Kelly 의사결정이
 * 진입 이후 어떻게 변했는지를 단일 텔레그램 메시지로 렌더링한다.
 *
 * 카드 한 장 당 4개 신호:
 *   1. 진입 시점 tier/grade/Kelly
 *   2. 현재 추정 Kelly (현재 IPS 에 진입 시점 rawKelly 를 재적용 → decay %)
 *   3. IPS · 레짐 전이 여부
 *   4. 권고 (HOLD / WATCH / TRIM 50% / EXIT)
 *
 * 권고 로직 (조건부 · 확정 아님) — 운영자 최종 판단용 참고값:
 *   - decay ≥ 50%      → TRIM 50%
 *   - decay ≥ 30%      → WATCH (근거 명시)
 *   - 레짐 downgrade   → TRIM 50% (레짐 < 진입 레짐)
 *   - regimeAtEntry 가 R1/R2 계열이었는데 현재 R5/R6 → EXIT
 *   - else             → HOLD
 *
 * 페르소나 원칙 10: "조건부 판단 + 리스크 동시 제시" — 매 카드에 근거·반대 시나리오 1줄 포함.
 */

import { IPS_KELLY_TABLE } from './kellyDampener.js';
import { isOpenShadowStatus } from './entryEngine.js';
import {
  getRemainingQty,
  type ServerShadowTrade,
  type EntryKellySnapshot,
} from '../persistence/shadowTradeRepo.js';
import { halfLifeSnapshot, type HalfLifeSnapshot } from './kellyHalfLife.js';
import { computeKellyCoverageRatio, KELLY_COVERAGE_TRIM_THRESHOLD } from './accountRiskBudget.js';

export interface KellyHealthCardInput {
  shadows: ServerShadowTrade[];
  currentIps: number;
  currentRegime: string;
  /** 현재 IPS 감쇠 배율 (0.1 ~ 1.0) */
  currentIpsMultiplier: number;
}

type Recommendation = 'HOLD' | 'WATCH' | 'TRIM_50' | 'EXIT';

interface HealthCardRow {
  code: string;
  name: string;
  snapshot?: EntryKellySnapshot;
  /** entryKelly 에 현재 IPS 감쇠비를 곱한 추정치 (decay 측정용) */
  currentEstimatedKelly: number | null;
  /** decay % — 양수 = 축소. null 이면 snapshot 누락으로 산정 불가. */
  decayPct: number | null;
  regimeShift: 'SAME' | 'UP' | 'DOWN' | 'UNKNOWN';
  /** Idea 3: 시간 감쇠 스냅샷 (Kelly half-life). null = snapshot/entryIso 없음. */
  halfLife?: HalfLifeSnapshot | null;
  /** Idea 11: Kelly coverage ratio (effectiveKelly / R-cap). */
  coverageRatio?: number | null;
  recommendation: Recommendation;
  rationale: string;
}

/** 레짐 tier 정수 매핑 — 숫자가 높을수록 방어적(리스크-오프). R1 < R2 < … < R6. */
function regimeSeverity(r: string | undefined | null): number | null {
  if (!r) return null;
  const m = r.match(/R(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** snapshot.regimeAtEntry vs current → SAME/UP(덜 위험)/DOWN(더 위험)/UNKNOWN. */
function classifyRegimeShift(entry: string | undefined, current: string): HealthCardRow['regimeShift'] {
  const a = regimeSeverity(entry);
  const b = regimeSeverity(current);
  if (a == null || b == null) return 'UNKNOWN';
  if (a === b) return 'SAME';
  return b > a ? 'DOWN' : 'UP';
}

/** 현재 IPS 에 해당하는 Kelly 감쇠 배율 (kellyDampener 테이블 공유). */
function ipsMultiplierForIps(ips: number): number {
  for (const row of IPS_KELLY_TABLE) {
    if (ips >= row.threshold) return row.multiplier;
  }
  return 1.0;
}

/**
 * 현재 추정 Kelly 계산.
 *   effectiveKellyAtEntry 는 진입 순간 IPS 상태로 적용된 값이므로,
 *   현재 IPS 감쇠 배율 / 진입 시점 IPS 감쇠 배율 비율을 곱해 동일 신호가
 *   지금 재진입할 때 받을 Kelly 를 근사한다.
 *
 *   current ≈ effectiveKellyAtEntry × (mult_now / mult_then)
 */
function estimateCurrentKelly(
  snap: EntryKellySnapshot,
  currentIpsMultiplier: number,
): number {
  const entryMult = ipsMultiplierForIps(snap.ipsAtEntry);
  if (entryMult <= 0) return snap.effectiveKelly;
  return snap.effectiveKelly * (currentIpsMultiplier / entryMult);
}

function decide(
  decayPct: number | null,
  regimeShift: HealthCardRow['regimeShift'],
  snapshotRegime: string | undefined,
  currentRegime: string,
  halfLife?: HalfLifeSnapshot | null,
  coverageRatio?: number | null,
): { recommendation: Recommendation; rationale: string } {
  // 레짐 급전환 우선 — Kelly 수치보다 시장 구조 전환이 더 강한 신호.
  const entrySev = regimeSeverity(snapshotRegime);
  const currSev = regimeSeverity(currentRegime);
  if (entrySev != null && currSev != null && currSev - entrySev >= 3) {
    return {
      recommendation: 'EXIT',
      rationale: `레짐 급전환 ${snapshotRegime}→${currentRegime} (Δ${currSev - entrySev}) — 진입 근거 소멸`,
    };
  }
  if (regimeShift === 'DOWN') {
    return {
      recommendation: 'TRIM_50',
      rationale: `레짐 악화 ${snapshotRegime}→${currentRegime} — 진입 당시보다 방어적 환경`,
    };
  }
  // Idea 3 — 시간 감쇠 기반 trim 권고.
  if (halfLife && halfLife.timeDecayWeight < 0.4) {
    return {
      recommendation: 'TRIM_50',
      rationale: `보유 ${halfLife.daysHeld.toFixed(0)}일 · half-life ${halfLife.halfLifeDays}일 · weight ${halfLife.timeDecayWeight.toFixed(2)} — 시간 감쇠로 근거 약화`,
    };
  }
  // Idea 11 — Coverage ratio 기반 trim (effectiveKelly 가 R-cap 을 못 채우는 경우).
  if (coverageRatio != null && coverageRatio < KELLY_COVERAGE_TRIM_THRESHOLD) {
    return {
      recommendation: 'TRIM_50',
      rationale: `Kelly coverage ${coverageRatio.toFixed(2)} < ${KELLY_COVERAGE_TRIM_THRESHOLD} — 자기 리스크 한도 미충족 (저확신 포지션)`,
    };
  }
  if (decayPct != null) {
    if (decayPct >= 50) {
      return {
        recommendation: 'TRIM_50',
        rationale: `Kelly ${decayPct.toFixed(0)}% decay — IPS 변곡 감쇠 누적`,
      };
    }
    if (decayPct >= 30) {
      return {
        recommendation: 'WATCH',
        rationale: `Kelly ${decayPct.toFixed(0)}% decay — 추가 악화 시 50% trim 고려`,
      };
    }
  }
  return {
    recommendation: 'HOLD',
    rationale: '진입 시점 대비 Kelly·레짐 유의 변화 없음 — 보유 유지',
  };
}

function buildRow(
  trade: ServerShadowTrade,
  input: KellyHealthCardInput,
): HealthCardRow {
  const snap = trade.entryKellySnapshot;
  if (!snap) {
    return {
      code: trade.stockCode,
      name: trade.stockName,
      snapshot: undefined,
      currentEstimatedKelly: null,
      decayPct: null,
      regimeShift: 'UNKNOWN',
      recommendation: 'HOLD',
      rationale: '레거시 포지션 — entryKellySnapshot 누락. 신규 진입부터 스냅샷 기록.',
    };
  }

  const current = estimateCurrentKelly(snap, input.currentIpsMultiplier);
  const decayPct = snap.effectiveKelly > 0
    ? Math.max(0, (1 - current / snap.effectiveKelly) * 100)
    : null;
  const regimeShift = classifyRegimeShift(snap.regimeAtEntry, input.currentRegime);
  // Idea 3 — 시간 감쇠 스냅샷
  const halfLife = halfLifeSnapshot({
    entryKelly: snap.effectiveKelly,
    entryIso: snap.snapshotAt ?? trade.signalTime,
    regime: snap.regimeAtEntry,
  });
  // Idea 11 — coverage ratio (현재 추정 Kelly 기준)
  const coverageRatio = computeKellyCoverageRatio(current);
  const { recommendation, rationale } = decide(
    decayPct, regimeShift, snap.regimeAtEntry, input.currentRegime,
    halfLife, coverageRatio,
  );

  return {
    code: trade.stockCode,
    name: trade.stockName,
    snapshot: snap,
    currentEstimatedKelly: current,
    decayPct,
    regimeShift,
    halfLife,
    coverageRatio,
    recommendation,
    rationale,
  };
}

function emojiForRecommendation(rec: Recommendation): string {
  switch (rec) {
    case 'HOLD':    return '🟢';
    case 'WATCH':   return '🟡';
    case 'TRIM_50': return '🟠';
    case 'EXIT':    return '🔴';
  }
}

function renderCard(row: HealthCardRow, currentIps: number): string {
  const emoji = emojiForRecommendation(row.recommendation);
  const head = `${emoji} <b>${row.name}</b> (${row.code})`;

  if (!row.snapshot) {
    return [
      head,
      `   <i>${row.rationale}</i>`,
    ].join('\n');
  }

  const s = row.snapshot;
  const capLabel = s.effectiveKelly >= s.fractionalCap - 1e-6 ? ' (캡 적용)' : '';
  const entryLine =
    `   진입: ${s.tier} · ${s.signalGrade} · ${s.effectiveKelly.toFixed(2)} Kelly${capLabel}`;
  const currentKelly = row.currentEstimatedKelly ?? 0;
  const decayLabel = row.decayPct == null
    ? 'n/a'
    : `${row.decayPct >= 0 ? '-' : '+'}${Math.abs(row.decayPct).toFixed(1)}%`;
  const healthTag = row.decayPct == null
    ? 'UNKNOWN'
    : row.decayPct >= 50 ? 'CRITICAL'
    : row.decayPct >= 30 ? 'WARN'
    : 'HEALTHY';
  const currentLine = `   현재: ${currentKelly.toFixed(2)} Kelly (${decayLabel} decay, ${healthTag})`;
  const regimeSymbol = row.regimeShift === 'SAME' ? '유지'
    : row.regimeShift === 'DOWN' ? '악화'
    : row.regimeShift === 'UP' ? '개선'
    : '미상';
  const ipsLine = `   IPS: ${s.ipsAtEntry.toFixed(0)}→${currentIps.toFixed(0)} · 레짐: ${s.regimeAtEntry}→${regimeSymbol}`;
  // Idea 3 + 11 — 시간 감쇠 + Coverage ratio 한 줄
  const hl = row.halfLife;
  const hlLabel = hl
    ? `보유 ${hl.daysHeld.toFixed(0)}일 (half=${hl.halfLifeDays}일, weight ${hl.timeDecayWeight.toFixed(2)})`
    : 'n/a';
  const covLabel = row.coverageRatio == null
    ? 'n/a'
    : `${row.coverageRatio.toFixed(2)}${row.coverageRatio < 1 ? ' ⚠' : ''}`;
  const extraLine = `   ⏱ ${hlLabel} · Cov ${covLabel}`;
  const recLabel = row.recommendation === 'HOLD' ? 'HOLD'
    : row.recommendation === 'WATCH' ? 'WATCH (추가 악화 시 TRIM)'
    : row.recommendation === 'TRIM_50' ? '50% trim (Kelly 비례 축소)'
    : 'EXIT (전량 청산 고려)';
  const recLine = `   권고: ${recLabel}`;
  const rationaleLine = `   <i>${row.rationale}</i>`;
  return [head, entryLine, currentLine, ipsLine, extraLine, recLine, rationaleLine].join('\n');
}

/**
 * `/kelly` 명령어 응답용 전체 메시지 조립.
 * 활성 포지션이 없으면 안내 문구만 반환.
 */
export function formatKellyHealthCards(input: KellyHealthCardInput): string {
  const active = input.shadows
    .filter(t => isOpenShadowStatus(t.status) && getRemainingQty(t) > 0)
    .sort((a, b) => (a.stockName ?? '').localeCompare(b.stockName ?? ''));

  const header = [
    '🎯 <b>/kelly — 종목별 Kelly 헬스</b>',
    `현재 IPS: ${input.currentIps.toFixed(0)} (감쇠 ×${input.currentIpsMultiplier.toFixed(2)}) · 레짐: ${input.currentRegime}`,
    '━━━━━━━━━━━━━━━━━',
  ].join('\n');

  if (active.length === 0) {
    return header + '\n' + '활성 포지션이 없습니다.';
  }

  const rows = active.map(t => buildRow(t, input));
  const cards = rows.map(r => renderCard(r, input.currentIps)).join('\n━━━━━━━━━━━━━━━━━\n');

  const legacyCount = rows.filter(r => !r.snapshot).length;
  const footer = legacyCount > 0
    ? `\n━━━━━━━━━━━━━━━━━\n<i>⚠ ${legacyCount}개 포지션은 레거시(entryKellySnapshot 누락) — 신규 진입부터 자동 기록.</i>`
    : '';

  return header + '\n' + cards + footer;
}
