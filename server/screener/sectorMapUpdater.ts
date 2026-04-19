/**
 * sectorMapUpdater.ts — KRX 전종목 섹터 스냅샷 수집
 *
 * @responsibility KRX 정보데이터시스템 JSON 엔드포인트에서 KOSPI·KOSDAQ 전종목의
 * 업종 분류를 수집하여 data/krx-sector-map.json 으로 저장한다. 이 모듈은 "외부 데이터
 * 수집·정규화·파일 쓰기" 한 가지 책임만 담당한다. 조회는 sectorMap.ts 가 담당한다.
 *
 * 호출 경로:
 *   - CLI: scripts/updateSectorMap.ts (주간 수동 실행 또는 최초 부트스트랩용)
 *   - 스케줄러: maintenanceJobs.ts (매주 월요일 03:00 KST)
 *
 * 안전성:
 *   1. 원자적 쓰기(tmp → rename) — 중간 실패 시 기존 파일 보존
 *   2. 응답 검증 — 기대치 이하(KOSPI/KOSDAQ 각 500행 미만) 시 기존 파일 유지하고 throw
 *   3. 최근 개장일 역산 — 주말엔 금요일 거래일로 조회
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import { invalidateSectorMapCache } from './sectorMap.js';

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
  count:     number;
  updatedAt: string;
  trdDd:     string;
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

async function buildSectorMap(trdDd: string, verbose: boolean): Promise<Record<string, string>> {
  const [kospiRes, kosdaqRes] = await Promise.allSettled([
    fetchMarket('STK', trdDd, verbose),
    fetchMarket('KSQ', trdDd, verbose),
  ]);

  const kospi  = kospiRes.status  === 'fulfilled' ? kospiRes.value  : [];
  const kosdaq = kosdaqRes.status === 'fulfilled' ? kosdaqRes.value : [];

  if (kospiRes.status === 'rejected') {
    throw new Error(`KOSPI 조회 실패: ${String(kospiRes.reason)}`);
  }
  if (kosdaqRes.status === 'rejected') {
    throw new Error(`KOSDAQ 조회 실패: ${String(kosdaqRes.reason)}`);
  }
  if (kospi.length < MIN_ROWS_PER_MARKET) {
    throw new Error(`KOSPI 응답 이상 — ${kospi.length}행 (<${MIN_ROWS_PER_MARKET})`);
  }
  if (kosdaq.length < MIN_ROWS_PER_MARKET) {
    throw new Error(`KOSDAQ 응답 이상 — ${kosdaq.length}행 (<${MIN_ROWS_PER_MARKET})`);
  }

  const all = [...kospi, ...kosdaq];
  if (all.length < MIN_TOTAL_ROWS) {
    throw new Error(`총 응답 이상 — ${all.length}행 (<${MIN_TOTAL_ROWS})`);
  }

  const map: Record<string, string> = {};
  let skipped = 0;
  for (const r of all) {
    const code = (r.ISU_SRT_CD ?? '').trim();
    if (!code || !/^\d{5,6}$/.test(code)) { skipped++; continue; }
    const padded = code.padStart(6, '0');
    const sector = normalizeSector(r.IDX_IND_NM);
    if (sector === '미분류') { skipped++; continue; }
    map[padded] = sector;
  }
  if (verbose) console.log(`[SectorMapUpdater] 유효 ${Object.keys(map).length}개 / 스킵 ${skipped}개`);
  return map;
}

// ── 원자적 저장 ───────────────────────────────────────────────────────────────

function atomicWriteJson(target: string, payload: unknown): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, target);
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * KRX 전종목 섹터 스냅샷 갱신. 성공 시 data/krx-sector-map.json 를 원자적으로 교체하고
 * sectorMap.ts 의 mtime 캐시를 즉시 무효화한다. 실패 시 throw 하며 기존 파일은 보존된다.
 */
export async function updateKrxSectorMap(opts: { verbose?: boolean } = {}): Promise<UpdateResult> {
  const { verbose = false } = opts;
  ensureDataDir();

  const trdDd = recentWeekdayYYYYMMDD();
  if (verbose) console.log(`[SectorMapUpdater] trdDd=${trdDd} 조회 시작`);

  const map = await buildSectorMap(trdDd, verbose);
  const count = Object.keys(map).length;
  if (count < MIN_TOTAL_ROWS) {
    throw new Error(`정규화 후 매핑 ${count}개 (<${MIN_TOTAL_ROWS}) — 기존 파일 유지`);
  }

  const updatedAt = new Date().toISOString();
  atomicWriteJson(OUT_PATH, map);
  atomicWriteJson(META_PATH, {
    updatedAt,
    source: `KRX ${KRX_BLD} (trdDd=${trdDd})`,
    count,
  });

  // 조회 계층의 mtime 캐시를 즉시 무효화 — 다음 getSectorByCode() 호출부터 새 맵 반영
  invalidateSectorMapCache();

  if (verbose) console.log(`[SectorMapUpdater] ✅ ${count}개 저장 → ${OUT_PATH}`);
  return { count, updatedAt, trdDd };
}
