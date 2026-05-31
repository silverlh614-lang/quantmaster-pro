// @responsibility KIS chk-holiday(CTCA0903R) opnd_yn L1 휴장 캘린더 fetch leaf — realDataKisGet 단일 통로 (ADR-0548)
/**
 * ADR-0548 — KIS 국내휴장일조회(chk-holiday / CTCA0903R) 휴장 권위 출처 leaf 모듈.
 *
 * query.ts 1,500줄 한계(ADR-0537 baseline 해소) 보존을 위해 자기완결 fetcher 를
 * 본 leaf 로 분리하고 query.ts 는 byte-equivalent 로 re-export 한다(공개 경로 유지).
 */

import { realDataKisGet } from '../http.js';
import { getKisOverrides } from '../overrides.js';
import { HAS_REAL_DATA_CLIENT } from '../constants.js';
import { pickKisRows, isAcceptedEmptyKisResponse, extractKisString } from './helpers.js';
import type { KisApiPriority } from '../../kisRateLimiter.js';

/**
 * KIS chk-holiday(CTCA0903R) 응답의 날짜별 row.
 * 핵심 필드는 `opnd_yn`(개장일여부) — `'N'` 이 휴장 권위 판정.
 */
export interface KisHolidayEntry {
  /** YYYYMMDD (KIS 원본 8자리) */
  bassDt: string;
  /** 요일구분코드 (01=일 … 07=토) */
  wdayDvsnCd?: string;
  /** 영업일여부 Y/N */
  bzdyYn?: string;
  /** 거래일여부 Y/N */
  trDayYn?: string;
  /** 개장일여부 Y/N — 'N' 이 휴장(권위). 주문 가능 여부 판정 기준. */
  opndYn: string;
  /** 결제일여부 Y/N */
  sttlDayYn?: string;
}

const _KIS_HOLIDAY_TR_ID = 'CTCA0903R';
const _KIS_HOLIDAY_PATH = '/uapi/domestic-stock/v1/quotations/chk-holiday';
/** 연속조회 재귀 최대 깊이 가드 — 1콜당 최대 100건, 연 단위면 통상 4콜 이내. */
const _KIS_HOLIDAY_MAX_PAGES = 8;

function _mapKisHolidayRow(row: Record<string, string>): KisHolidayEntry | null {
  const bassDt = extractKisString(row, ['bass_dt', 'BASS_DT']);
  const opndYn = extractKisString(row, ['opnd_yn', 'OPND_YN']);
  if (!bassDt || !opndYn) return null;
  const entry: KisHolidayEntry = { bassDt, opndYn };
  const wday = extractKisString(row, ['wday_dvsn_cd', 'WDAY_DVSN_CD']);
  const bzdy = extractKisString(row, ['bzdy_yn', 'BZDY_YN']);
  const trDay = extractKisString(row, ['tr_day_yn', 'TR_DAY_YN']);
  const sttl = extractKisString(row, ['sttl_day_yn', 'STTL_DAY_YN']);
  if (wday !== undefined) entry.wdayDvsnCd = wday;
  if (bzdy !== undefined) entry.bzdyYn = bzdy;
  if (trDay !== undefined) entry.trDayYn = trDay;
  if (sttl !== undefined) entry.sttlDayYn = sttl;
  return entry;
}

/**
 * KIS chk-holiday(CTCA0903R) opnd_yn L1 휴장 출처 fetch — realDataKisGet 단일 통로, 실패 시 null(STATIC fallback).
 *
 * ADR-0548. `bassDt`(YYYYMMDD) 부터의 개장일여부 캘린더를 반환한다. KIS 응답 body 의
 * 연속조회 키(ctx_area_fk/nk)가 비어있지 않으면 다음 페이지를 재귀 조회(최대
 * `_KIS_HOLIDAY_MAX_PAGES` 깊이 가드). realDataKisGet 은 헤더를 노출하지 않으므로
 * tr_cont 헤더 대신 body 의 ctx_area 키로 페이지네이션 종료를 판정한다.
 *
 * ★ 운영 제약: KIS docstring "가급적 1일 1회 호출". 임의 호출 금지 — cron(syncKisHolidayCalendar)
 *   에서만 호출하고 idempotent skip 으로 실호출을 연 1~2회로 제한한다.
 *
 * KIS 미설정/빈 응답/오류 시 null 반환(불변식 #6 — provider 장애 ≠ 약세 신호, STATIC fallback).
 */
export async function fetchKisHolidayCalendar(
  bassDt: string,
  priority: KisApiPriority = 'LOW',
): Promise<KisHolidayEntry[] | null> {
  const overrides = getKisOverrides();
  if (overrides.fetchKisHolidayCalendar) return overrides.fetchKisHolidayCalendar(bassDt);
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;
  const safeBassDt = bassDt.replace(/-/g, '');
  if (!/^\d{8}$/.test(safeBassDt)) {
    console.warn('[KIS] chk-holiday BASS_DT 형식 오류 — null 반환:', bassDt);
    return null;
  }
  try {
    const collected: KisHolidayEntry[] = [];
    const seen = new Set<string>();
    let ctxAreaFk = '';
    let ctxAreaNk = '';
    for (let page = 0; page < _KIS_HOLIDAY_MAX_PAGES; page += 1) {
      const data = await realDataKisGet(
        _KIS_HOLIDAY_TR_ID,
        _KIS_HOLIDAY_PATH,
        {
          BASS_DT: safeBassDt,
          CTX_AREA_NK: ctxAreaNk,
          CTX_AREA_FK: ctxAreaFk,
        },
        priority,
      );
      if (isAcceptedEmptyKisResponse(data)) break;
      const rows = pickKisRows(data);
      if (rows.length === 0) break;
      for (const row of rows) {
        const entry = _mapKisHolidayRow(row as Record<string, string>);
        if (entry && !seen.has(entry.bassDt)) {
          seen.add(entry.bassDt);
          collected.push(entry);
        }
      }
      // 연속조회: KIS body 의 ctx_area_fk/nk 가 비어있지 않으면 다음 페이지 존재.
      const root = data as { ctx_area_fk?: string; ctx_area_nk?: string; CTX_AREA_FK?: string; CTX_AREA_NK?: string } | null;
      const nextFk = (root?.ctx_area_fk ?? root?.CTX_AREA_FK ?? '').trim();
      const nextNk = (root?.ctx_area_nk ?? root?.CTX_AREA_NK ?? '').trim();
      if (!nextFk && !nextNk) break;
      ctxAreaFk = nextFk;
      ctxAreaNk = nextNk;
    }
    if (collected.length === 0) return null;
    return collected;
  } catch (e) {
    console.error('[KIS] chk-holiday(국내휴장일조회) 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}
