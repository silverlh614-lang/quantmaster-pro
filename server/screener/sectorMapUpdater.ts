/**
 * sectorMapUpdater.ts — KRX 전종목 섹터 스냅샷 수집 + 폴백 체인
 *
 * @responsibility KRX 정보데이터시스템 JSON 엔드포인트에서 KOSPI·KOSDAQ 전종목의
 * 업종 분류를 수집하여 data/krx-sector-map.json 으로 저장한다. KRX 장애(HTTP 400/500·
 * 타임아웃) 시에는 sectorSources.ts 의 4단계 폴백 체인(KRX → Naver → Yahoo → Gemini)을
 * 호출해 기존 파일이 진부화되는 것을 막는다.
 *
 * 호출 경로:
 *   - CLI: scripts/updateSectorMap.ts (주간 수동 실행 또는 최초 부트스트랩용)
 *   - 스케줄러: maintenanceJobs.ts (매주 월요일 03:00 KST · 평일 04:00 KST 일일 재시도)
 *
 * 안전성:
 *   1. 원자적 쓰기(tmp → rename) — 중간 실패 시 기존 파일 보존
 *   2. KRX 응답 검증 — 기대치 이하(KOSPI/KOSDAQ 각 500행 미만) 시 폴백으로 낙하
 *   3. KRX 장애시 trdDd 를 최근 영업일 5일까지 역추적 후 Naver/Yahoo/Gemini 폴백
 *   4. 폴백 결과라도 최소 커버리지(기존 + 신규 합산 MIN_TOTAL_ROWS) 충족 시에만 저장
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

const KRX_URL    = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const KRX_BLD    = 'dbms/MDC/STAT/standard/MDCSTAT03901';
const TIMEOUT_MS = 15_000;

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

// ── KRX 조회 ──────────────────────────────────────────────────────────────────

async function fetchMarket(mktId: MktId, trdDd: string, verbose: boolean): Promise<KrxRow[]> {
  const body = new URLSearchParams({
    bld:         KRX_BLD,
    mktId,
    trdDd,
    money:       '1',
    csvxls_isNo: 'false',
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`KRX ${mktId} timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  try {
    const res = await fetch(KRX_URL, {
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
    if (verbose) console.log(`[SectorMapUpdater] ${mktId} ${rows.length}행 수신`);
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
    fetchMarket('STK', trdDd, verbose),
    fetchMarket('KSQ', trdDd, verbose),
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
 * KRX 벌크 스냅샷 시도 — 최근 영업일 N일까지 trdDd 를 역추적한다.
 * KRX 는 장 전·공휴일 직후에 400 을 내기도 해서 단일 거래일만으로는 취약.
 * 성공 시 {map, diagnostic} · 모두 실패 시 null.
 */
async function attemptKrxWithDateRetry(
  verbose: boolean,
): Promise<{ map: Record<string, string>; namesByCode: Record<string, string>; diagnostic: string } | null> {
  const dates = recentWeekdaysYYYYMMDD(5);
  const diagnostics: string[] = [];
  for (const trdDd of dates) {
    const r = await buildSectorMapOnce(trdDd, verbose).catch((e) => ({
      map: {}, namesByCode: {}, diagnostic: `KRX(${trdDd}): exception ${e instanceof Error ? e.message : String(e)}`,
    }));
    if (r && Object.keys(r.map).length >= MIN_TOTAL_ROWS) {
      return {
        map:        r.map,
        namesByCode:r.namesByCode,
        diagnostic: [...diagnostics, r.diagnostic].join(' | '),
      };
    }
    diagnostics.push(r?.diagnostic ?? `KRX(${trdDd}): 알 수 없는 실패`);
  }
  return { map: {}, namesByCode: {}, diagnostic: diagnostics.join(' | ') };
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
      const r = await attemptKrxWithDateRetry(verbose);
      if (!r) return null;
      Object.assign(namesBox, r.namesByCode);
      return { map: r.map, diagnostic: r.diagnostic };
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
