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

import { loadKrxHolidayPatch, appendKrxHolidayPatch } from '../persistence/krxHolidayRepo.js';

/** KRX 공식 휴장일 목록 (YYYY-MM-DD, KST 기준) — 정적 fallback. */
const STATIC_HOLIDAYS: ReadonlySet<string> = new Set<string>([
  // ── 2026 ──────────────────────────────────────────────────────────────────
  '2026-01-01', // 신정
  '2026-02-16', // 설날 연휴
  '2026-02-17', // 설날
  '2026-02-18', // 설날 연휴
  '2026-03-01', // 삼일절
  '2026-03-02', // 삼일절 대체공휴일 (3/1 일요일)
  '2026-05-01', // 근로자의 날 (KRX 휴장)
  '2026-05-05', // 어린이날
  '2026-05-25', // 부처님 오신 날
  '2026-06-03', // 제9회 전국동시지방선거 (법정 공휴일 → KRX 휴장)
  '2026-06-06', // 현충일 (토요일 — 현충일은 대체공휴일 제외 대상)
  '2026-08-15', // 광복절
  '2026-08-17', // 광복절 대체공휴일 (8/15 토요일)
  '2026-09-24', // 추석 연휴
  '2026-09-25', // 추석
  '2026-09-26', // 추석 연휴 (토요일 — 설날·추석은 일요일 겹침에만 대체, 9/28 대체 없음)
  '2026-10-03', // 개천절
  '2026-10-05', // 개천절 대체공휴일 (10/3 토요일)
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

/** KST 기준 Date → 'YYYY-MM-DD'. (영업일 계산 SSOT) */
export function formatKstYmd(kstDate: Date): string {
  const y = kstDate.getUTCFullYear();
  const m = `${kstDate.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${kstDate.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD'(KST) 가 KRX 영업일인지 — 주말·휴장일 제외. */
export function isKrxBusinessDay(ymd: string, holidays: ReadonlySet<string> = KRX_HOLIDAYS): boolean {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(ymd);
}

/** baseYmd('YYYY-MM-DD')에서 N 영업일 뒤 날짜('YYYY-MM-DD'). 영업일 계산 SSOT. */
export function addBusinessDaysFromKstDate(
  baseYmd: string,
  businessDays: number,
  holidays: ReadonlySet<string> = KRX_HOLIDAYS,
): string {
  if (businessDays <= 0) return baseYmd;
  const date = new Date(`${baseYmd}T00:00:00.000Z`);
  let added = 0;
  while (added < businessDays) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isKrxBusinessDay(formatKstYmd(date), holidays)) added += 1;
  }
  return formatKstYmd(date);
}

// ─── ADR-0548: KIS chk-holiday(CTCA0903R) L1 휴장 권위 → patch(addedBy:'sync') 동기화 ───

/**
 * KIS 휴장 권위를 krxHolidayRepo patch(addedBy:sync)로 영속·reload — ENV gate, cron 1회, idempotent.
 *
 * ADR-0548. `KIS_HOLIDAY_CALENDAR_ENABLED==='true'` 일 때만 동작(default OFF → byte-equivalent).
 * 당해+차년도 각각, 이미 충분히 등록된 연도(`MIN_SYNCED_HOLIDAYS_PER_YEAR` 이상)는 KIS 호출
 * 없이 skip 하여 KIS docstring "가급적 1일 1회 호출" 제약을 강제한다.
 *
 * KIS fetch 실패(null) 시 STATIC ∪ patch 안전망 유지(불변식 #6 — provider 장애 ≠ 약세 신호).
 *
 * ★ 순환참조 회피: 본 모듈(krxHolidays) → query.ts → marketDayClassifier → krxHolidays 정적
 *   사이클을 끊기 위해 fetch fetcher 를 비동기 동적 import 로 지연 로딩한다. 동기 휴일 함수
 *   (`isKrxHoliday` 등)는 무변경.
 */
export async function syncKisHolidayCalendar(
  opts: { now?: Date } = {},
): Promise<{ added: number; skipped: boolean }> {
  if (process.env.KIS_HOLIDAY_CALENDAR_ENABLED !== 'true') {
    return { added: 0, skipped: true };
  }

  const now = opts.now ?? new Date();
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const baseYear = kst.getUTCFullYear();
  const targetYears = [baseYear, baseYear + 1];

  // 동적 import — 정적 사이클 회피 + 경량 leaf 직접 로드.
  // query.js facade 대신 leaf(holidayCalendar)를 직접 import 하여 marketDayClassifier
  // 경유 사이클(query→marketDayClassifier→krxHolidays)을 원천 차단한다.
  const { fetchKisHolidayCalendar } = await import('../clients/kisClient/query/holidayCalendar.js');

  let totalAdded = 0;
  let anyFetched = false;

  for (const year of targetYears) {
    // 이미 충분히 등록된 연도는 KIS 호출 없이 skip (idempotent + 호출 빈도 가드).
    if (_countHolidaysInActiveSet(year) >= _MIN_SYNCED_HOLIDAYS_PER_YEAR) {
      continue;
    }

    const entries = await fetchKisHolidayCalendar(`${year}0101`);
    if (!entries) {
      // KIS 실패/미설정 — STATIC 안전망 유지(불변식 #6). 로깅 후 다음 연도 진행.
      console.warn(`[KrxHolidays] KIS chk-holiday ${year} 미응답 — STATIC fallback 유지`);
      continue;
    }
    anyFetched = true;

    const patchEntries = entries
      .filter((e) => e.opndYn === 'N')
      .map((e) => _kisYmdToDashed(e.bassDt))
      .filter((d): d is string => d !== null && _isWeekdayYmd(d))
      .map((date) => ({
        date,
        reason: 'KIS chk-holiday',
        addedBy: 'sync' as const,
        addedAt: new Date().toISOString(),
      }));

    if (patchEntries.length > 0) {
      totalAdded += appendKrxHolidayPatch(patchEntries);
    }
  }

  if (anyFetched) {
    reloadKrxHolidaySet();
  }

  return { added: totalAdded, skipped: false };
}

/** 연 단위 KIS 응답이 정상이라면 통상 휴장일 ≥ 이 값. 미만이면 미동기로 간주해 재호출. */
const _MIN_SYNCED_HOLIDAYS_PER_YEAR = 8;

/** 활성 Set(STATIC ∪ patch)에서 특정 연도 휴장일 개수. */
function _countHolidaysInActiveSet(year: number): number {
  let count = 0;
  const prefix = `${year}-`;
  for (const ymd of _runtimeSet) {
    if (ymd.startsWith(prefix)) count += 1;
  }
  return count;
}

/** 'YYYYMMDD'(KIS) → 'YYYY-MM-DD'. 형식 오류 시 null. */
function _kisYmdToDashed(bassDt: string): string | null {
  if (!/^\d{8}$/.test(bassDt)) return null;
  return `${bassDt.slice(0, 4)}-${bassDt.slice(4, 6)}-${bassDt.slice(6, 8)}`;
}

/** 'YYYY-MM-DD' 가 평일(월~금)인지 — 주말은 patch 등록 대상에서 제외(휴장이 아니라 비영업). */
function _isWeekdayYmd(ymd: string): boolean {
  const dow = new Date(`${ymd}T00:00:00.000Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}
