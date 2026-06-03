/**
 * @responsibility 주말만 건너뛰는 영업일 근사 가산(휴일 미인식) — nearMiss/gate2 학습 라벨 연속성 공용 helper.
 *
 * 의도적 근사: 주말(토/일)만 스킵하고 KRX 공휴일은 건너뛰지 않는다. 휴일-인식이 아니다.
 * 휴일-인식 정정(영속 forward-return 라벨 마이그레이션)은 별도 작업(중복카탈로그 #2-B)으로 추적한다.
 * 휴일+주말 SSOT 가 필요하면 krxHolidays.addBusinessDaysFromKstDate 를 사용할 것 — 본 helper 와 혼동 금지.
 *
 * 입력/출력: 'YYYY-MM-DD'(KST date key) → 'YYYY-MM-DD'. UTC 자정 기준 일 가산.
 */

/**
 * 주말만 건너뛰는 영업일 근사 가산. 공휴일은 영업일로 취급한다(의도적 근사).
 *
 * @param ymd  기준 날짜 'YYYY-MM-DD'
 * @param businessDays  가산할 영업일 수(주말 제외)
 * @returns 'YYYY-MM-DD'
 */
export function addWeekdaysApprox(ymd: string, businessDays: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  let added = 0;
  while (added < businessDays) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}
