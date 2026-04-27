/**
 * @responsibility 학습 입력 영업일 검증 — 비영업일 레코드 자동 필터링·거부 진단 헬퍼 (ADR-0043)
 *
 * 학습 엔진(`backtestEngine` / `failureToWeight` / `nightlyReflection` /
 * `recommendationTracker`) 이 trade 레코드를 입력으로 받을 때, 비영업일에 발생한
 * 레코드(이론적으로는 발생하지 않지만 데이터 정합성 사고로 누적될 수 있음) 가 학습
 * 풀에 진입하지 못하도록 차단하는 단일 헬퍼.
 *
 * 본 PR 에서는 헬퍼만 도입. 실제 적용은 호출자별 후속 PR (회귀 위험 격리).
 */

import { isTradingDay } from '../utils/marketDayClassifier.js';

const REJECTED_SAMPLE_LIMIT = 5;

export interface RejectedSample {
  recordId: string;
  date: string;
  reason: string;
}

export interface TradingDayFilterResult<T> {
  validRecords: T[];
  rejectedCount: number;
  /** 디버깅용 — 거부된 레코드 최대 5건 샘플. */
  rejectedSamples: RejectedSample[];
}

/**
 * 영업일 KST 가 아닌 레코드를 자동 필터링.
 *
 * @param records 학습 입력 후보
 * @param getDateKst 레코드에서 KST YYYY-MM-DD 추출. undefined 반환 시 KST_DATE_MISSING 거부.
 * @param getId 레코드 식별자 추출 (디버깅 샘플용).
 */
export function filterToTradingDayRecords<T>(
  records: T[],
  getDateKst: (rec: T) => string | undefined,
  getId: (rec: T) => string,
): TradingDayFilterResult<T> {
  const validRecords: T[] = [];
  const rejectedSamples: RejectedSample[] = [];
  let rejectedCount = 0;

  for (const rec of records) {
    const date = getDateKst(rec);
    if (!date) {
      rejectedCount += 1;
      if (rejectedSamples.length < REJECTED_SAMPLE_LIMIT) {
        rejectedSamples.push({
          recordId: getId(rec),
          date: '',
          reason: 'KST_DATE_MISSING',
        });
      }
      continue;
    }
    if (!isTradingDay(date)) {
      rejectedCount += 1;
      if (rejectedSamples.length < REJECTED_SAMPLE_LIMIT) {
        rejectedSamples.push({
          recordId: getId(rec),
          date,
          reason: 'NON_TRADING_DAY',
        });
      }
      continue;
    }
    validRecords.push(rec);
  }

  return { validRecords, rejectedCount, rejectedSamples };
}

/**
 * `[periodStart, periodEnd]` (KST YYYY-MM-DD, 양 끝 포함) 사이 영업일 수.
 * 학습 윈도우의 분모를 달력일이 아닌 영업일로 정확히 계산하기 위함.
 *
 * 잘못된 입력(역순 등) 시 0 반환.
 */
export function countTradingDays(periodStart: string, periodEnd: string): number {
  if (!periodStart || !periodEnd) return 0;
  if (periodStart > periodEnd) return 0;

  let count = 0;
  let cursor = periodStart;
  // 안전 상한 — 오타로 인한 무한 루프 차단 (3년치 영업일 ≈ 750).
  const MAX_ITERATIONS = 1100;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (isTradingDay(cursor)) count += 1;
    if (cursor === periodEnd) return count;
    cursor = shiftYmd(cursor, 1);
  }
  return count;
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
