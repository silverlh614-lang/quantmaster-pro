/**
 * sectorMapUpdater.ts — KRX 전종목 섹터 스냅샷 수집 + 폴백 체인
 *
 * @responsibility KRX 전종목의 종목코드·업종 분류를 수집하여
 * data/krx-sector-map.json 으로 저장한다.
 *
 * 수집 우선순위:
 *   ① 신규 OpenAPI (openapi.krx.co.kr / data-dbg.krx.co.kr, KRX_API_KEY 인증)
 *      — krxOpenApi.ts 의 fetchKospiDailyTrade/fetchKosdaqDailyTrade 를 사용해
 *        전종목 code·name·sector(소속부)를 가져온다. sector 필드가 "우량기업부"
 *        처럼 업종과 무관한 값이면 아래 폴백 체인이 namesByCode 로 업종을 보충.
 *   ② 레거시 공개 엔드포인트 (data.krx.co.kr MDCSTAT03901, 인증 불필요)
 *      — **KRX_API_KEY 미설정** 배포용 폴백. 키가 설정돼 있으면 스킵하고 바로
 *        Naver/Yahoo/Gemini 체인으로 넘어간다. 레거시 엔드포인트는 공지 없이
 *        응답 스키마가 바뀌거나 차단되는 일이 잦아 인증 키가 있는 배포에서는
 *        재현성 없는 노이즈가 된다.
 *   ③ Naver → Yahoo → Gemini 체인 (sectorSources.ts) — 누락분 업종 보충.
 *
 * 안전성:
 *   1. 원자적 쓰기(tmp → rename) — 중간 실패 시 기존 파일 보존
 *   2. KRX 응답 검증 — 기대치 이하(KOSPI/KOSDAQ 각 500행 미만) 시 폴백으로 낙하
 *   3. 거래일을 최근 영업일 5일까지 역추적 후 Naver/Yahoo/Gemini 폴백
 *   4. 폴백 결과라도 최소 커버리지(MIN_TOTAL_ROWS) 충족 시에만 저장
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import { invalidateSectorMapCache } from './sectorMap.js';
import {
  buildSectorMapWithFallback,
  loadExistingSectorMap,
} from './sectorSources.js';
import { SECTOR_MAP as MANUAL_OVERRIDES } from './pipelineHelpers.js';
import {
  fetchKospiDailyTrade,
  fetchKosdaqDailyTrade,
  isKrxOpenApiHealthy,
  getKrxOpenApiStatus,
  type KrxStockDailyRow,
} from '../clients/krxOpenApi.js';

const KRX_LEGACY_URL = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const KRX_LEGACY_BLD = 'dbms/MDC/STAT/standard/MDCSTAT03901';
const TIMEOUT_MS     = 15_000;

const OUT_PATH  = path.join(DATA_DIR, 'krx-sector-map.json');
const META_PATH = path.join(DATA_DIR, 'krx-sector-map.meta.json');

const MIN_ROWS_PER_MARKET = 500;   // KOSPI·KOSDAQ 각각 최소 500종목
const MIN_TOTAL_ROWS      = 1500;  // 전체 최소 1,500종목

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface KrxRow {
  ISU_SRT_CD?: string;   // 종목코드 (6자리)
  ISU_ABBRV?:  string;   // 종목약명
  IDX_IND_NM?: string;   // 지수업종명 (섹터)
  MKT_TP_NM?:  string;   // KOSPI/KOSDAQ
}

interface KrxResponse {
  OutBlock_1?: KrxRow[];
}

type MktId = 'STK' | 'KSQ';

export interface UpdateResult {
  count:       number;
  updatedAt:   string;
  trdDd:       string;
  /** 데이터 출처 라벨 — 'KRX' | 'KRX-fail→Naver' | 'KRX-fail→Naver+Yahoo+Gemini' | 'carry-over' 등 */
  source:      string;
  /** 폴백 진단 로그 — 텔레그램 알림·관측성용 */
  diagnostics: string[];
}

// ── KRX 원본 섹터명 → 프로젝트 표준 섹터명 별칭 ───────────────────────────────
// LEADING_SECTORS 의 값과 부분일치(includes) 매칭이 되도록 정규화.
// 과도한 단순화는 2단계 운영 후 경험에 따라 별칭 테이블을 다듬어 나간다.
const SECTOR_ALIASES: Record<string, string> = {
  '전기전자':    '반도체',
  '전기·전자':  '반도체',
  '의약품':     '바이오',
  '운수장비':   '자동차',
  '운수·창고':  '운송',
  '운수창고':   '운송',
  '서비스업':   'IT서비스',
  '건설업':     '건설',
  '기계·장비':  '기계',
  '기계장비':   '기계',
  '철강금속':   '철강',
  '비금속광물':  '소재',
  '화학':       '화학',
  '음식료품':   '식품',
  '섬유·의복':  '의류',
  '섬유의복':   '의류',
  '유통업':     '유통',
  '통신업':     '통신',
  '금융업':     '금융',
  '증권':       '금융',
  '보험':       '금융',
  '종이목재':   '소재',
  '전기가스업':  '유틸리티',
};

function normalizeSector(raw: string | undefined): string {
  if (!raw) return '미분류';
  const trimmed = raw.trim();
  if (!trimmed) return '미분류';
  return SECTOR_ALIASES[trimmed] ?? trimmed;
}

// ── 최근 개장일 (KST 기준) ────────────────────────────────────────────────────

export function recentWeekdayYYYYMMDD(now = new Date()): string {
  // KST = UTC+9. 시스템 로컬 타임존과 무관하게 동작하도록 UTC 기준으로만 계산.
  // now.getTime() 는 epoch ms (타임존 독립) — 9시간 더해 UTC 메서드로 읽으면 KST 달력이 된다.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  while (kst.getUTCDay() === 0 || kst.getUTCDay() === 6) {
    kst.setUTCDate(kst.getUTCDate() - 1);
  }
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 최근 영업일 N개를 최신순으로 반환 — KRX HTTP 400(공휴일·프리오픈)시 역추적용. */
function recentWeekdaysYYYYMMDD(count: number, now = new Date()): string[] {
  const out: string[] = [];
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  while (out.length < count) {
    if (kst.getUTCDay() !== 0 && kst.getUTCDay() !== 6) {
      const y = kst.getUTCFullYear();
      const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
      const d = String(kst.getUTCDate()).padStart(2, '0');
      out.push(`${y}${m}${d}`);
    }
    kst.setUTCDate(kst.getUTCDate() - 1);
  }
  return out;
}

// ── KRX 조회 (② 레거시 공개 엔드포인트) ──────────────────────────────────────

async function fetchLegacyMarket(mktId: MktId, trdDd: string, verbose: boolean): Promise<KrxRow[]> {
  const body = new URLSearchParams({
    bld:         KRX_LEGACY_BLD,
    mktId,
    trdDd,
    money:       '1',
    csvxls_isNo: 'false',
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`KRX ${mktId} timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  try {
    const res = await fetch(KRX_LEGACY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept':       'application/json',
        'Referer':      'http://data.krx.co.kr/',
        'User-Agent':   'Mozilla/5.0 (compatible; QuantmasterPro/1.0)',
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`KRX ${mktId} HTTP ${res.status}`);
    const json = (await res.json()) as KrxResponse;
    const rows = Array.isArray(json?.OutBlock_1) ? json.OutBlock_1 : [];
    if (verbose) console.log(`[SectorMapUpdater] ${mktId} ${rows.length}행 수신 (legacy)`);
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

// ── 매핑 빌드 ─────────────────────────────────────────────────────────────────

/** 특정 거래일 trdDd 로 1회 KRX 조회·정규화. 임계치 미달이면 null. */
async function buildSectorMapOnce(
  trdDd: string,
  verbose: boolean,
): Promise<{ map: Record<string, string>; namesByCode: Record<string, string>; diagnostic: string } | null> {
  const [kospiRes, kosdaqRes] = await Promise.allSettled([
    fetchLegacyMarket('STK', trdDd, verbose),
    fetchLegacyMarket('KSQ', trdDd, verbose),
  ]);
  const kospi  = kospiRes.status  === 'fulfilled' ? kospiRes.value  : [];
  const kosdaq = kosdaqRes.status === 'fulfilled' ? kosdaqRes.value : [];

  if (kospiRes.status === 'rejected' || kosdaqRes.status === 'rejected') {
    const reason =
      kospiRes.status  === 'rejected' ? `KOSPI: ${String(kospiRes.reason)}` :
      kosdaqRes.status === 'rejected' ? `KOSDAQ: ${String(kosdaqRes.reason)}` : 'unknown';
    return { map: {}, namesByCode: {}, diagnostic: `KRX(${trdDd}): ${reason}` };
  }

  if (kospi.length < MIN_ROWS_PER_MARKET || kosdaq.length < MIN_ROWS_PER_MARKET) {
    return {
      map: {},
      namesByCode: {},
      diagnostic: `KRX(${trdDd}): KOSPI=${kospi.length} KOSDAQ=${kosdaq.length} (임계치 ${MIN_ROWS_PER_MARKET} 미달)`,
    };
  }

  const map: Record<string, string> = {};
  const namesByCode: Record<string, string> = {};
  let skipped = 0;
  for (const r of [...kospi, ...kosdaq]) {
    const code = (r.ISU_SRT_CD ?? '').trim();
    if (!code || !/^\d{5,6}$/.test(code)) { skipped++; continue; }
    const padded = code.padStart(6, '0');
    const name   = (r.ISU_ABBRV ?? '').trim();
    if (name) namesByCode[padded] = name;
    const sector = normalizeSector(r.IDX_IND_NM);
    if (sector === '미분류') { skipped++; continue; }
    map[padded] = sector;
  }
  if (verbose) console.log(`[SectorMapUpdater] trdDd=${trdDd} 유효 ${Object.keys(map).length}개 / 스킵 ${skipped}개`);
  return {
    map,
    namesByCode,
    diagnostic: `KRX(${trdDd}): 유효 ${Object.keys(map).length}행`,
  };
}

/**
 * ② 레거시 공개 엔드포인트 벌크 스냅샷 — 최근 영업일 N일까지 trdDd 를 역추적한다.
 * KRX 공개 JSON 은 장 전·공휴일 직후에 400 을 내기도 해서 단일 거래일만으로는 취약.
 * 성공 시 {map, diagnostic} · 모두 실패 시 비어있는 map 과 누적 진단.
 */
async function attemptKrxLegacyWithDateRetry(
  verbose: boolean,
): Promise<{ map: Record<string, string>; namesByCode: Record<string, string>; diagnostic: string }> {
  const dates = recentWeekdaysYYYYMMDD(5);
  const diagnostics: string[] = [];
  for (const trdDd of dates) {
    const r = await buildSectorMapOnce(trdDd, verbose).catch((e) => ({
      map: {}, namesByCode: {}, diagnostic: `KRX-Legacy(${trdDd}): exception ${e instanceof Error ? e.message : String(e)}`,
    }));
    if (r && Object.keys(r.map).length >= MIN_TOTAL_ROWS) {
      return {
        map:        r.map,
        namesByCode:r.namesByCode,
        diagnostic: [...diagnostics, r.diagnostic].join(' | '),
      };
    }
    diagnostics.push(r?.diagnostic ?? `KRX-Legacy(${trdDd}): 알 수 없는 실패`);
  }
  return { map: {}, namesByCode: {}, diagnostic: diagnostics.join(' | ') };
}

// ── ① 신규 OpenAPI (openapi.krx.co.kr / data-dbg.krx.co.kr) ──────────────────

/**
 * 신규 OpenAPI 로 KOSPI·KOSDAQ 일별매매정보를 수집해 code/name/업종 맵을 구성한다.
 *
 * 제약:
 *   - 승인된 엔드포인트(stk_bydd_trd·ksq_bydd_trd)의 SECT_TP_NM 은 "소속부"이지
 *     레거시 MDCSTAT03901 의 IDX_IND_NM(업종) 과 동일하지 않다. 업종이 정규화되지
 *     않는 행은 map 에서 제외되지만 namesByCode 에는 남아 Naver/Yahoo/Gemini
 *     폴백 체인이 종목명 기반으로 업종을 보충한다.
 *   - KRX_API_KEY 미설정·서킷 OPEN·KRX_OPENAPI_DISABLED 상태이면 즉시 null.
 *
 * 성공 조건: KOSPI·KOSDAQ 각각 최소 MIN_ROWS_PER_MARKET 종목을 받았을 때.
 */
async function attemptKrxOpenApi(
  verbose: boolean,
): Promise<{ map: Record<string, string>; namesByCode: Record<string, string>; diagnostic: string } | null> {
  if (!isKrxOpenApiHealthy()) {
    const st = getKrxOpenApiStatus();
    const reason = !st.authKeyConfigured ? 'AUTH_KEY 미설정'
                 : !st.enabled           ? 'DISABLED'
                 : st.circuitState === 'OPEN' ? '서킷 OPEN'
                 : `상태=${st.circuitState}`;
    if (verbose) console.log(`[SectorMapUpdater] KRX OpenAPI 건너뜀 — ${reason}`);
    return null;
  }

  const dates = recentWeekdaysYYYYMMDD(5);
  const diagnostics: string[] = [];

  for (const basDd of dates) {
    const [kospiRes, kosdaqRes] = await Promise.allSettled([
      fetchKospiDailyTrade(basDd),
      fetchKosdaqDailyTrade(basDd),
    ]);
    const kospi  = kospiRes.status  === 'fulfilled' ? kospiRes.value  : [];
    const kosdaq = kosdaqRes.status === 'fulfilled' ? kosdaqRes.value : [];

    if (kospiRes.status === 'rejected' || kosdaqRes.status === 'rejected') {
      const reason =
        kospiRes.status  === 'rejected' ? `KOSPI: ${String(kospiRes.reason)}` :
        kosdaqRes.status === 'rejected' ? `KOSDAQ: ${String(kosdaqRes.reason)}` : 'unknown';
      diagnostics.push(`KRX-OpenAPI(${basDd}): ${reason}`);
      continue;
    }

    if (kospi.length < MIN_ROWS_PER_MARKET || kosdaq.length < MIN_ROWS_PER_MARKET) {
      diagnostics.push(`KRX-OpenAPI(${basDd}): KOSPI=${kospi.length} KOSDAQ=${kosdaq.length} (임계치 ${MIN_ROWS_PER_MARKET} 미달)`);
      continue;
    }

    const map:         Record<string, string> = {};
    const namesByCode: Record<string, string> = {};
    let mapped = 0;
    for (const r of [...kospi, ...kosdaq] as KrxStockDailyRow[]) {
      const code = r.code.padStart(6, '0');
      if (r.name) namesByCode[code] = r.name;
      const sector = normalizeSector(r.sector);
      if (sector !== '미분류') { map[code] = sector; mapped++; }
    }

    if (verbose) {
      console.log(
        `[SectorMapUpdater] KRX-OpenAPI(${basDd}) 수신 — ` +
        `KOSPI=${kospi.length} KOSDAQ=${kosdaq.length}, 업종매핑=${mapped}, 종목명=${Object.keys(namesByCode).length}`,
      );
    }
    return {
      map,
      namesByCode,
      diagnostic: `KRX-OpenAPI(${basDd}): KOSPI=${kospi.length} KOSDAQ=${kosdaq.length}, 업종매핑=${mapped}`,
    };
  }

  return { map: {}, namesByCode: {}, diagnostic: diagnostics.join(' | ') || 'KRX-OpenAPI: 5영업일 모두 실패' };
}

// ── 원자적 저장 ───────────────────────────────────────────────────────────────

function atomicWriteJson(target: string, payload: unknown): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, target);
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * KRX 전종목 섹터 스냅샷 갱신 (폴백 체인 포함).
 *
 * 성공 시 data/krx-sector-map.json 를 원자적으로 교체하고 sectorMap.ts 의 mtime
 * 캐시를 즉시 무효화한다. KRX 장애 시 Naver → Yahoo → Gemini 순으로 누락분을 채워
 * 최소 커버리지를 확보한다. 폴백 + 기존 파일로도 임계치 미달이면 throw 하고 기존 파일 보존.
 */
export async function updateKrxSectorMap(opts: { verbose?: boolean } = {}): Promise<UpdateResult> {
  const { verbose = false } = opts;
  ensureDataDir();

  const primaryTrdDd = recentWeekdayYYYYMMDD();
  if (verbose) console.log(`[SectorMapUpdater] 기준일 trdDd=${primaryTrdDd} 조회 시작`);

  // 폴백 체인이 참조할 기존 파일·유니버스 수집.
  const existingMap = loadExistingSectorMap(OUT_PATH);
  // 폴백 유니버스 = 기존 파일 + 수동 오버라이드 코드의 합집합.
  // KRX 가 완전 장애일 때에도 이 집합은 커버해야 함.
  const targetCodes = Array.from(new Set([
    ...Object.keys(existingMap),
    ...Object.keys(MANUAL_OVERRIDES),
  ]));

  // KRX 조회 과정에서 얻는 종목명(Gemini 프롬프트용)은 공유 컨테이너로 전달 —
  // JS 객체 참조 공유로 오케스트레이터가 Gemini 단계 진입 시점의 최신 값을 본다.
  const namesBox: Record<string, string> = {};
  const result = await buildSectorMapWithFallback({
    krxAttempt: async () => {
      // ① 신규 OpenAPI (KRX_API_KEY + openapi.krx.co.kr). 서킷 OPEN · 키 미설정이면 즉시 null.
      const oa = await attemptKrxOpenApi(verbose);
      if (oa) {
        Object.assign(namesBox, oa.namesByCode);
        if (Object.keys(oa.map).length >= MIN_TOTAL_ROWS) {
          return { map: oa.map, diagnostic: oa.diagnostic };
        }
        // OpenAPI 가 종목 리스트를 줬지만 업종(SECT_TP_NM)이 MDCSTAT03901 의 IDX_IND_NM
        // 과 달라 대부분 '미분류'로 떨어질 수 있다. 종목 리스트가 충분하면 legacy 로
        // 추가 시도 없이 아래 Naver/Yahoo/Gemini 체인이 namesByCode 로 업종을 보충한다.
        if (Object.keys(oa.namesByCode).length >= MIN_TOTAL_ROWS) {
          return {
            map: oa.map,
            diagnostic: `${oa.diagnostic} — 업종 부족, 폴백 체인으로 보충`,
          };
        }
      }
      // ② 레거시 공개 엔드포인트 (data.krx.co.kr).
      //    KRX_API_KEY 가 설정된 배포에서는 건너뛴다 — 사용자가 인증 OpenAPI 를
      //    선택한 것이므로 비인증 레거시 호스트로 폴백해 "왜 여전히 data.krx.co.kr
      //    로 가냐" 는 혼란을 만들지 않는다. OpenAPI 가 실패하면 Naver/Yahoo/
      //    Gemini 체인이 빈 map 과 namesBox 로부터 업종을 재구성한다.
      const apiKeyConfigured = !!(
        (process.env.KRX_API_KEY ?? process.env.KRX_OPENAPI_AUTH_KEY ?? '').trim()
      );
      if (apiKeyConfigured) {
        const oaDiag = oa?.diagnostic ?? 'KRX-OpenAPI: 건너뜀';
        if (verbose) {
          console.log(`[SectorMapUpdater] KRX_API_KEY 설정됨 — 레거시 data.krx.co.kr 폴백 스킵`);
        }
        return {
          map:        {},
          diagnostic: `${oaDiag} || 레거시 data.krx.co.kr 스킵(KRX_API_KEY 설정됨)`,
        };
      }

      const legacy = await attemptKrxLegacyWithDateRetry(verbose);
      Object.assign(namesBox, legacy.namesByCode);
      const oaDiag = oa?.diagnostic ?? 'KRX-OpenAPI: 건너뜀';
      return {
        map:        legacy.map,
        diagnostic: `${oaDiag} || ${legacy.diagnostic}`,
      };
    },
    existingMap,
    targetCodes,
    targetNamesByCode: namesBox,
    minTotalRows: MIN_TOTAL_ROWS,
    verbose,
  });

  const count = Object.keys(result.map).length;
  if (count < MIN_TOTAL_ROWS) {
    const diagTail = result.diagnostics.slice(-4).join(' | ');
    throw new Error(
      `모든 소스(KRX/Naver/Yahoo/Gemini) 실패 — 최종 매핑 ${count}개 (<${MIN_TOTAL_ROWS}). ` +
      `진단: ${diagTail}`,
    );
  }

  const updatedAt = new Date().toISOString();
  atomicWriteJson(OUT_PATH, result.map);
  atomicWriteJson(META_PATH, {
    updatedAt,
    source:      result.sourceLabel,
    count,
    trdDd:       primaryTrdDd,
    diagnostics: result.diagnostics,
  });

  // 조회 계층의 mtime 캐시를 즉시 무효화 — 다음 getSectorByCode() 호출부터 새 맵 반영
  invalidateSectorMapCache();

  if (verbose) console.log(`[SectorMapUpdater] ✅ ${count}개 저장 (source=${result.sourceLabel}) → ${OUT_PATH}`);
  return {
    count,
    updatedAt,
    trdDd:       primaryTrdDd,
    source:      result.sourceLabel,
    diagnostics: result.diagnostics,
  };
}
