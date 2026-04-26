// @responsibility KRX 휴장일 SSOT — 정적 STATIC_HOLIDAYS + 운영자 patch (ADR-0045) 통합 Set
/**
 * krxHolidays.ts — KRX 휴장일 관리
 *
 * 한국거래소(KRX) 휴장일 목록. 해마다 변동되므로 연 초에 점검·갱신한다.
 * KRX 공식 공지: https://www.krx.co.kr (시장정보 > 휴장일 안내)
 *
 * ⚠️  연말(12월) 이전에 다음 연도분을 추가하는 것을 권장한다.
 *
 * PR-D (ADR-0045): 정적 STATIC_HOLIDAYS 위에 영속 patch (`krxHolidayRepo`) 가 추가.
 * 부팅 시 `reloadKrxHolidaySet()` 1회 호출로 patch 반영. 운영자가 응급 추가 시
 * `data/krx-holiday-patch.json` 직접 편집 후 재시작.
 */

import { loadKrxHolidayPatch } from '../persistence/krxHolidayRepo.js';

/** KRX 공식 휴장일 목록 (YYYY-MM-DD, KST 기준) — 정적 fallback. */
const STATIC_HOLIDAYS: ReadonlySet<string> = new Set<string>([
  // ── 2026 ──────────────────────────────────────────────────────────────────
  '2026-01-01', // 신정
  '2026-02-16', // 설날 연휴
  '2026-02-17', // 설날
  '2026-02-18', // 설날 연휴
  '2026-03-01', // 삼일절
  '2026-05-01', // 근로자의 날 (KRX 휴장)
  '2026-05-05', // 어린이날
  '2026-05-25', // 부처님 오신 날
  '2026-06-06', // 현충일
  '2026-08-15', // 광복절
  '2026-09-24', // 추석 연휴
  '2026-09-25', // 추석
  '2026-09-26', // 추석 연휴
  '2026-10-03', // 개천절
  '2026-10-09', // 한글날
  '2026-12-25', // 성탄절

  // ── 2027 ──────────────────────────────────────────────────────────────────
  '2027-01-01', // 신정
  '2027-02-06', // 설날 연휴
  '2027-02-07', // 설날
  '2027-02-08', // 설날 연휴
  '2027-03-01', // 삼일절
  '2027-05-05', // 어린이날
  '2027-05-12', // 부처님 오신 날
  '2027-06-06', // 현충일
  '2027-08-15', // 광복절
  '2027-09-14', // 추석 연휴
  '2027-09-15', // 추석
  '2027-09-16', // 추석 연휴
  '2027-10-03', // 개천절
  '2027-10-09', // 한글날
  '2027-12-25', // 성탄절
]);

/**
 * 활성 휴장일 Set — STATIC_HOLIDAYS + patch 합집합.
 * `reloadKrxHolidaySet()` 호출 시 patch 가 다시 합쳐진다. ReadonlySet 타입으로 export
 * 하여 외부에서 mutate 차단.
 *
 * trancheExecutor.ts 등 기존 호출자가 `KRX_HOLIDAYS` 를 import 해도 인스턴스가 동일
 * (재할당이 아니라 .clear()/.add() mutate) 하므로 reload 시 자동 반영된다.
 */
const _runtimeSet = new Set<string>(STATIC_HOLIDAYS);

export const KRX_HOLIDAYS: ReadonlySet<string> = _runtimeSet;

/**
 * patch 파일을 다시 읽어 활성 Set 을 갱신한다.
 * 부팅 시 1회 호출. 운영자가 patch 편집 후 수동 reload 도 가능.
 */
export function reloadKrxHolidaySet(): void {
  _runtimeSet.clear();
  for (const v of STATIC_HOLIDAYS) _runtimeSet.add(v);
  try {
    const patch = loadKrxHolidayPatch();
    for (const v of patch) _runtimeSet.add(v);
  } catch (e: unknown) {
    console.warn('[KrxHolidays] patch reload 실패 — 정적 Set 만 사용:', e instanceof Error ? e.message : e);
  }
}

/**
 * 주어진 날짜(YYYY-MM-DD KST 기준)가 KRX 공휴일인지 판정.
 * 정적 STATIC_HOLIDAYS + 영속 patch 합산 결과.
 */
export function isKrxHoliday(dateYmd: string): boolean {
  return _runtimeSet.has(dateYmd);
}

/**
 * 정적 STATIC_HOLIDAYS 만 반환 — patch 미적용 view. 감사·테스트용.
 */
export function getStaticKrxHolidays(): ReadonlySet<string> {
  return STATIC_HOLIDAYS;
}
