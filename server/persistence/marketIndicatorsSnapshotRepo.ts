/**
 * @responsibility /api/market-indicators 응답 last-known-good snapshot 영속 SSOT (ADR-0065 PR-γ)
 *
 * /api/market-indicators 가 9개 Yahoo 호출을 Promise.allSettled 로 병렬 발사하지만,
 * 실패한 필드는 그대로 null 반환되어 클라이언트 UI 가 "—" 로 표시되거나 flicker (성공
 * → null → 성공 → null) 가 발생했다. 본 모듈은 11 필드 별 last-known-good + 캡처 시각을
 * 디스크에 영속해 일시 실패 시 stale fallback 을 제공한다.
 *
 * 정책 (ADR-0065 §3):
 * - 매 요청 fetch 직후 성공 필드만 snapshot 갱신 (atomic write tmp → rename).
 * - 실패한 필드는 snapshot.last 에서 fill — 라우터가 X-Field-Stale 헤더에 필드명 누적.
 * - 모든 필드 실패 + snapshot 도 비어있으면 기존대로 null 응답 (graceful baseline).
 * - 손상 JSON 은 빈 객체 fallback — 다음 정상 fetch 가 자동 복구.
 */
import fs from 'fs';

import { ensureDataDir, MARKET_INDICATORS_SNAPSHOT_FILE } from './paths.js';

/** 가격성 단순 숫자 필드 (가격이 있으면 number, 실패 시 null). */
export type ScalarField = number | null;

/** kospi/kosdaq quote 객체 — fetchYahoo 결과 변환된 형태. */
export interface QuoteFieldValue {
  price: number;
  change: number;
  changePct: number;
}

/** /api/market-indicators 응답의 11 필드 (fetchedAt 제외). */
export interface MarketIndicatorsFresh {
  vix: ScalarField;
  us10yYield: ScalarField;
  usShortRate: ScalarField;
  samsungIri: ScalarField;
  vkospi: ScalarField;
  vkospiDayChange: ScalarField;
  vkospi5dTrend: ScalarField;
  kospi: QuoteFieldValue | null;
  kosdaq: QuoteFieldValue | null;
  ewyReturn: ScalarField;
  mtumReturn: ScalarField;
}

/** 각 필드별 last-known-good 엔트리 — 값 + 캡처 시각 ISO. */
export interface SnapshotFieldEntry<T> {
  value: T;
  capturedAt: string;
}

/** 디스크 영속 스키마. */
export interface MarketIndicatorsSnapshot {
  vix?: SnapshotFieldEntry<number>;
  us10yYield?: SnapshotFieldEntry<number>;
  usShortRate?: SnapshotFieldEntry<number>;
  samsungIri?: SnapshotFieldEntry<number>;
  vkospi?: SnapshotFieldEntry<number>;
  vkospiDayChange?: SnapshotFieldEntry<number>;
  vkospi5dTrend?: SnapshotFieldEntry<number>;
  kospi?: SnapshotFieldEntry<QuoteFieldValue>;
  kosdaq?: SnapshotFieldEntry<QuoteFieldValue>;
  ewyReturn?: SnapshotFieldEntry<number>;
  mtumReturn?: SnapshotFieldEntry<number>;
  /** 마지막 갱신 시각 — 진단·디버깅용. */
  updatedAt?: string;
}

/** 11 필드 키 SSOT — 회귀 테스트가 응답 스키마와 정합 검증. */
export const MARKET_INDICATOR_FIELDS = [
  'vix', 'us10yYield', 'usShortRate', 'samsungIri',
  'vkospi', 'vkospiDayChange', 'vkospi5dTrend',
  'kospi', 'kosdaq', 'ewyReturn', 'mtumReturn',
] as const;

export type MarketIndicatorField = typeof MARKET_INDICATOR_FIELDS[number];

/**
 * 디스크 snapshot 로드. 파일 부재/손상 시 빈 객체 — 호출자(라우터)는 fill 단계에서
 * snapshot 의 부재 필드를 그대로 null 로 둔다 (graceful 첫 부팅).
 */
export function loadMarketIndicatorsSnapshot(): MarketIndicatorsSnapshot {
  try {
    if (!fs.existsSync(MARKET_INDICATORS_SNAPSHOT_FILE)) return {};
    const raw = fs.readFileSync(MARKET_INDICATORS_SNAPSHOT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as MarketIndicatorsSnapshot;
  } catch (e) {
    console.warn(
      '[MarketIndicatorsSnapshot] 손상된 JSON — 빈 객체 fallback:',
      e instanceof Error ? e.message : e,
    );
    return {};
  }
}

/** atomic write — tmp 파일 작성 후 rename 으로 원자적 교체. 실패 시 false. */
export function saveMarketIndicatorsSnapshot(snapshot: MarketIndicatorsSnapshot): boolean {
  ensureDataDir();
  const tmp = `${MARKET_INDICATORS_SNAPSHOT_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, MARKET_INDICATORS_SNAPSHOT_FILE);
    return true;
  } catch (e) {
    console.warn(
      '[MarketIndicatorsSnapshot] 저장 실패:',
      e instanceof Error ? e.message : e,
    );
    try { fs.unlinkSync(tmp); } catch { /* not present */ }
    return false;
  }
}

/**
 * fresh 응답의 *성공한* 필드만 snapshot 에 머지. null 필드는 snapshot 의 last-known-good
 * 을 보존한다. capturedAt 은 호출 시점 ISO.
 *
 * 부수효과 없음 — 새 객체 반환.
 */
export function mergeFreshIntoSnapshot(
  current: MarketIndicatorsSnapshot,
  fresh: MarketIndicatorsFresh,
  capturedAt: string,
): MarketIndicatorsSnapshot {
  const next: MarketIndicatorsSnapshot = { ...current, updatedAt: capturedAt };

  for (const field of MARKET_INDICATOR_FIELDS) {
    const value = fresh[field];
    if (value === null || value === undefined) continue;
    // 숫자 필드 NaN/Infinity 가드
    if (typeof value === 'number' && (!Number.isFinite(value))) continue;
    // kospi/kosdaq quote: price 가 number 가 아니면 무시
    if (typeof value === 'object') {
      const q = value as QuoteFieldValue;
      if (typeof q.price !== 'number' || !Number.isFinite(q.price) || q.price <= 0) continue;
    }
    (next as Record<string, SnapshotFieldEntry<number | QuoteFieldValue>>)[field] = {
      value: value as number | QuoteFieldValue,
      capturedAt,
    };
  }

  return next;
}

/** Fill 결과 — 응답 본체 + stale 필드 목록 (X-Field-Stale 헤더). */
export interface FilledMarketIndicators {
  body: MarketIndicatorsFresh;
  staleFields: MarketIndicatorField[];
}

/**
 * 실패한 (null) 필드를 snapshot.last 로 채우고 stale 필드 목록을 반환한다.
 * snapshot 에도 없는 필드는 그대로 null 유지.
 */
export function fillMissingFromSnapshot(
  fresh: MarketIndicatorsFresh,
  snapshot: MarketIndicatorsSnapshot,
): FilledMarketIndicators {
  const body: MarketIndicatorsFresh = { ...fresh };
  const staleFields: MarketIndicatorField[] = [];

  for (const field of MARKET_INDICATOR_FIELDS) {
    if (body[field] !== null && body[field] !== undefined) continue;
    const snap = snapshot[field];
    if (snap?.value !== undefined && snap.value !== null) {
      // 숫자 필드 vs quote 필드 분기 — 런타임 타입 안전 (snapshot 은 mergeFresh 가 검증)
      (body as unknown as Record<string, ScalarField | QuoteFieldValue>)[field] = snap.value;
      staleFields.push(field);
    }
  }

  return { body, staleFields };
}

/** 테스트 전용 — 파일 강제 삭제. */
export const __testOnly = {
  removeSnapshotFile(): void {
    try { fs.unlinkSync(MARKET_INDICATORS_SNAPSHOT_FILE); } catch { /* not present */ }
  },
};
