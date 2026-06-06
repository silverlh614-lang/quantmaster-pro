// @responsibility Regime Learning backfill timestamp 회복 SSOT — 레거시 카운터팩추얼 백로그 fallback(id epoch / tradingDate).
import type { RegimeBackfillTimestampSource, RegimeWritableRow } from './types.js';

/**
 * cf_<epochMs>_<code> 형태 id 에서 epoch(ms) 를 ISO 로 복원(레거시 카운터팩추얼 백로그 timestamp 회복).
 * recordCounterfactualCase 가 `cf_${Date.now()}_${code}` 로 id 발급(counterfactualShadow.ts:251) —
 * id epoch 는 동일 now 에서 찍은 signalTime 과 같은 instant. snapshotId 기반 id(`cf_decision_...`)는
 * epoch 자리에 숫자가 없어 매칭 안 됨 → 오탐 없음.
 */
export function idEpochTimestamp(id: string | undefined): string | undefined {
  if (typeof id !== 'string') return undefined;
  const m = /^cf_(\d{10,})_/.exec(id);
  if (!m) return undefined;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** 첫 번째 비어있지 않은(trim 후 non-empty) 문자열. nullish + 빈문자열 모두 skip → timestampSourceOf 와 정합. */
function firstNonEmpty(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

/**
 * 학습 row 의 대표 timestamp 회복. signalTime→…→signalDate 우선, 이후 레거시 백로그 fallback:
 * tradingDate(일자) → cf id epoch(빌드 instant ≈ signalTime). 신규 행은 signalTime 스탬프됨(counterfactualShadow.ts:255).
 */
export function timestampOf(row: RegimeWritableRow): string | undefined {
  return firstNonEmpty(
    row.signalTime,
    row.entryAt,
    row.detectedAt,
    row.createdAt,
    row.closedAt,
    row.updatedAt,
    row.lastUpdatedAt,
    row.signalDate ? `${row.signalDate}T00:00:00.000Z` : undefined,
    row.tradingDate ? `${row.tradingDate}T00:00:00.000Z` : undefined,
    idEpochTimestamp(row.id),
  );
}

export function timestampSourceOf(row: RegimeWritableRow): RegimeBackfillTimestampSource {
  const has = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';
  if (has(row.signalTime)) return 'SIGNAL_TIME';
  if (has(row.entryAt)) return 'ENTRY_AT';
  if (has(row.detectedAt)) return 'DETECTED_AT';
  if (has(row.createdAt)) return 'CREATED_AT';
  if (has(row.closedAt)) return 'CLOSED_AT';
  if (has(row.updatedAt)) return 'UPDATED_AT';
  if (has(row.lastUpdatedAt)) return 'LAST_UPDATED_AT';
  if (has(row.signalDate)) return 'SIGNAL_DATE';
  if (has(row.tradingDate)) return 'TRADING_DATE';
  if (idEpochTimestamp(row.id)) return 'ID_EPOCH';
  return 'MISSING';
}
