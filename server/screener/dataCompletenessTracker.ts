/**
 * dataCompletenessTracker.ts — 종목별 데이터 완성도 스코어링 (당일 롤링)
 *
 * pipelineDiagnosis가 Yahoo/KIS "연결성"만 봤던 것을 종목 단위의 "데이터 완성도"로
 * 확장한다. 빈 스캔의 두 원인을 분리하기 위한 인프라:
 *
 *   (A) 신호 부재 — 데이터 충분, 게이트가 거부
 *   (B) 데이터 부재 — MTAS/DART 데이터가 빈곤해서 게이트 평가 자체가 불완전
 *
 * 대응 방식이 완전히 다르다. (A)는 문턱 완화, (B)는 매수 자체 보류 + 데이터 원천 점검.
 *
 * 지표
 *   - mtasFailRate  = mtas 보강 실패 / 시도
 *   - dartNullRate  = dart ocfRatio null / dart 조회 시도
 *   - perStock: code별 { mtas, dart } booleans (최신값)
 *
 * 임계치
 *   - aggregateFailRate > 0.30 → "데이터 빈곤 스캔" 플래그 ON
 *   - 플래그 ON일 때 상위 레이어(signalScanner/entryEngine)가 매수 보류
 *
 * 리셋
 *   - 매일 KST 08:00 자동 리셋 (새 장 시작 전)
 *   - 명시적 resetDataCompleteness() 호출로도 초기화
 */

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface PerStockCompleteness {
  code: string;
  mtasAvailable:  boolean | null;  // null = 아직 시도 없음
  dartAvailable:  boolean | null;
  /** 0~1, 높을수록 데이터 충분. mtas+dart 가중 평균. */
  score: number;
  updatedAt: string;
}

export interface CompletenessSnapshot {
  mtasAttempts:    number;
  mtasSuccess:     number;
  mtasFailRate:    number;   // 0~1
  dartAttempts:    number;
  dartNullCount:   number;
  dartNullRate:    number;   // 0~1
  aggregateFailRate: number; // max(mtasFailRate, dartNullRate)
  isDataStarved:   boolean;
  perStock:        PerStockCompleteness[];
  flippedAt:       string | null;  // isDataStarved ON으로 마지막 전환된 시각 ISO
  updatedAt:       string;
}

// ── 내부 상태 ────────────────────────────────────────────────────────────────

const _perStock = new Map<string, PerStockCompleteness>();
let _mtasAttempts  = 0;
let _mtasSuccess   = 0;
let _dartAttempts  = 0;
let _dartNullCount = 0;
let _flippedAt: string | null = null;
let _isDataStarvedCache = false;

const DATA_STARVED_THRESHOLD = 0.30;  // 30% 초과 시 플래그 ON
const MIN_SAMPLE_FOR_FLAG    = 10;    // 너무 적은 표본으로 경보하지 않음

// ── 업데이트 API ─────────────────────────────────────────────────────────────

function upsertPerStock(code: string, patch: Partial<PerStockCompleteness>): void {
  const prev = _perStock.get(code);
  const merged: PerStockCompleteness = {
    code,
    mtasAvailable: patch.mtasAvailable ?? prev?.mtasAvailable ?? null,
    dartAvailable: patch.dartAvailable ?? prev?.dartAvailable ?? null,
    score: 0,
    updatedAt: new Date().toISOString(),
  };
  // 점수: mtas 0.6, dart 0.4 가중
  const mtasComponent = merged.mtasAvailable === true ? 0.6 : merged.mtasAvailable === false ? 0 : 0.3;
  const dartComponent = merged.dartAvailable === true ? 0.4 : merged.dartAvailable === false ? 0 : 0.2;
  merged.score = Math.max(0, Math.min(1, mtasComponent + dartComponent));
  _perStock.set(code, merged);
}

/** KIS MTAS 보강 시도 결과 기록. */
export function recordMtasAttempt(code: string, success: boolean): void {
  _mtasAttempts++;
  if (success) _mtasSuccess++;
  upsertPerStock(code, { mtasAvailable: success });
  _reevaluateFlag();
}

/**
 * DART 재무 조회 시도 결과 기록.
 * hasData=false는 "조회는 됐으나 핵심 필드(ocfRatio)가 null"을 뜻한다.
 */
export function recordDartAttempt(code: string, hasData: boolean): void {
  _dartAttempts++;
  if (!hasData) _dartNullCount++;
  upsertPerStock(code, { dartAvailable: hasData });
  _reevaluateFlag();
}

function _reevaluateFlag(): void {
  const s = getCompletenessSnapshot();
  if (s.isDataStarved && !_isDataStarvedCache) {
    _flippedAt = new Date().toISOString();
    _isDataStarvedCache = true;
    console.warn(
      `[DataCompleteness] ⚠️ 데이터 빈곤 스캔 플래그 ON — ` +
      `mtasFail ${(s.mtasFailRate * 100).toFixed(1)}% / dartNull ${(s.dartNullRate * 100).toFixed(1)}%`,
    );
  } else if (!s.isDataStarved && _isDataStarvedCache) {
    _isDataStarvedCache = false;
    console.log('[DataCompleteness] 데이터 빈곤 플래그 OFF');
  }
}

// ── 조회 API ─────────────────────────────────────────────────────────────────

export function getCompletenessSnapshot(): CompletenessSnapshot {
  const mtasFailRate   = _mtasAttempts > 0 ? (_mtasAttempts - _mtasSuccess) / _mtasAttempts : 0;
  const dartNullRate   = _dartAttempts > 0 ? _dartNullCount / _dartAttempts : 0;
  const aggregateFail  = Math.max(mtasFailRate, dartNullRate);
  const totalAttempts  = _mtasAttempts + _dartAttempts;
  const isDataStarved  = totalAttempts >= MIN_SAMPLE_FOR_FLAG && aggregateFail > DATA_STARVED_THRESHOLD;

  return {
    mtasAttempts:      _mtasAttempts,
    mtasSuccess:       _mtasSuccess,
    mtasFailRate:      parseFloat(mtasFailRate.toFixed(3)),
    dartAttempts:      _dartAttempts,
    dartNullCount:     _dartNullCount,
    dartNullRate:      parseFloat(dartNullRate.toFixed(3)),
    aggregateFailRate: parseFloat(aggregateFail.toFixed(3)),
    isDataStarved,
    perStock:          Array.from(_perStock.values()),
    flippedAt:         _flippedAt,
    updatedAt:         new Date().toISOString(),
  };
}

/** 매수 시점에서 호출 — 데이터 빈곤 스캔이면 true를 반환해 진입을 보류한다. */
export function isDataStarvedScan(): boolean {
  return getCompletenessSnapshot().isDataStarved;
}

/** 특정 종목의 완성도 점수(0~1). 없으면 null. */
export function getStockCompletenessScore(code: string): number | null {
  const e = _perStock.get(code);
  return e ? e.score : null;
}

/**
 * 워치리스트에서 "가장 데이터 빈곤한" 종목(code)을 돌려준다.
 * 비교할 대상이 없으면 null. 기록이 없는 종목은 무시.
 */
export function findMostDataStarvedCode(candidates: string[]): { code: string; score: number } | null {
  let worst: { code: string; score: number } | null = null;
  for (const code of candidates) {
    const e = _perStock.get(code);
    if (!e) continue;
    if (!worst || e.score < worst.score) {
      worst = { code, score: e.score };
    }
  }
  return worst;
}

// ── 리셋 ─────────────────────────────────────────────────────────────────────

export function resetDataCompleteness(): void {
  _perStock.clear();
  _mtasAttempts  = 0;
  _mtasSuccess   = 0;
  _dartAttempts  = 0;
  _dartNullCount = 0;
  _flippedAt     = null;
  _isDataStarvedCache = false;
}
