/**
 * @responsibility KRX 종목 마스터 영속 캐시 — 부팅·24h TTL 만료 시 1회 다운로드 (ADR-0011, PR-25-A)
 *
 * AI 추천·자동매매 양쪽이 같은 종목 마스터를 참조한다. KRX 호출은 부팅 또는
 * TTL 만료 시점 1회뿐이며, 평소에는 메모리·디스크 캐시에서 매핑한다. 다운로드
 * 자체가 실패해도 부팅을 막지 않는다 — 빈 Map 반환으로 fallback.
 */

import fs from 'fs';
import { emitMaintenanceWarn } from '../observability/maintenanceWarn.js';
import { KRX_STOCK_MASTER_FILE, ensureDataDir } from './paths.js';
import { isKstWeekend } from '../utils/marketClock.js';

export interface StockMasterEntry {
  code: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'OTHER';
  sector?: string;
  /** KRX 원천 master 분류: 보통주/우선주/ETF/ETN/ELW/REITs/SPAC 등 필터 입력. */
  securityType?: string;
  stockType?: string;
  department?: string;
  /**
   * ADR-0455: KRX master DB enrichment 옵셔널 필드 (Tier 0 OpenAPI / Tier 1 CSV 둘 다 추출).
   * 모두 후방호환 — 기존 영속 데이터 (이전 PR 들) 는 undefined 유지, 다음 refresh 사이클부터 자연 채움.
   * 기존 reader (`getStockByCode`, `getStockByName`, `extractStocksFromText`) 무영향.
   */
  /** ISIN (국제 증권 식별 번호, 12자리). ADR-0456 DART name disambiguation 의 입력. */
  isin?: string;
  /** 상장일 (YYYY-MM-DD 또는 YYYYMMDD). 신규 IPO 식별 + 상장 경력 학습 입력. */
  listDate?: string;
  /** 상장주식수 (KRX 공시 기준). 시가총액 산출 입력 (`marketCap = listedShares × currentPrice`). */
  listedShares?: number;
  /** 영문 종목명. ADR-0456 DART name disambiguation 의 fuzzy matching 입력. */
  nameEng?: string;
}

export interface KrxMasterMetadata {
  last_full_master_refresh_at: number | null;
  last_successful_krx_master_at: number | null;
  raw_krx_master_total: number;
  kospi_total: number;
  kosdaq_total: number;
  konex_total_optional: number;
  tradable_universe_total: number;
  scanner_candidate_total: number;
  watchlist_total: number;
  source_markets: Array<'KOSPI' | 'KOSDAQ' | 'KONEX' | 'OTHER'>;
  is_partial: boolean;
  stale: boolean;
  cache_version: string;
}

export interface StockMasterStore {
  fetchedAt: number;
  entries: StockMasterEntry[];
  metadata?: KrxMasterMetadata;
}

export const MASTER_TTL_MS = 24 * 60 * 60 * 1000;
export const RAW_KRX_MASTER_MIN_TOTAL = 2000;
export const TRADABLE_KRX_UNIVERSE_MIN_TOTAL = 1500;
export const KRX_MASTER_CACHE_VERSION = 'krx-full-master-v2';

let _store: StockMasterStore | null = null;
let _byCode: Map<string, StockMasterEntry> | null = null;
let _byName: Map<string, StockMasterEntry> | null = null;


export function getKrxMarketCounts(entries: StockMasterEntry[]): {
  raw_krx_master_total: number;
  kospi_total: number;
  kosdaq_total: number;
  konex_total_optional: number;
  other_total: number;
} {
  const counts = {
    raw_krx_master_total: entries.length,
    kospi_total: 0,
    kosdaq_total: 0,
    konex_total_optional: 0,
    other_total: 0,
  };
  for (const e of entries) {
    if (e.market === 'KOSPI') counts.kospi_total++;
    else if (e.market === 'KOSDAQ') counts.kosdaq_total++;
    else if (e.market === 'KONEX') counts.konex_total_optional++;
    else counts.other_total++;
  }
  return counts;
}

function dedupeMasterEntries(entries: StockMasterEntry[]): StockMasterEntry[] {
  const byCode = new Map<string, StockMasterEntry>();
  for (const e of entries) {
    if (!/^\d{6}$/.test(e.code)) continue;
    const prev = byCode.get(e.code);
    if (!prev) {
      byCode.set(e.code, e);
      continue;
    }
    // KOSPI/KOSDAQ row wins over OTHER when duplicate standard code appears.
    const prevRank = prev.market === 'KOSPI' || prev.market === 'KOSDAQ' ? 2 : prev.market === 'KONEX' ? 1 : 0;
    const nextRank = e.market === 'KOSPI' || e.market === 'KOSDAQ' ? 2 : e.market === 'KONEX' ? 1 : 0;
    if (nextRank > prevRank) byCode.set(e.code, e);
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function isTradableKrxEquity(entry: StockMasterEntry): boolean {
  if (!(entry.market === 'KOSPI' || entry.market === 'KOSDAQ')) return false;
  const joined = [entry.name, entry.securityType, entry.stockType, entry.department]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  if (/ETF|ETN|ELW/.test(joined)) return false;
  if (/스팩|SPAC|기업인수목적/.test(joined)) return false;
  if (/리츠|REIT/.test(joined)) return false;
  if (/우선주|종류주|1우|2우|3우|우B|우\)/.test(joined)) return false;
  if (/관리|거래정지|정리매매|투자위험/.test(joined)) return false;
  return true;
}

export function getTradableKrxUniverse(entries: StockMasterEntry[] = getAllStockEntries()): StockMasterEntry[] {
  return entries.filter(isTradableKrxEquity);
}

export function buildKrxMasterMetadata(input: {
  entries: StockMasterEntry[];
  now?: number;
  scannerCandidateTotal?: number;
  watchlistTotal?: number;
  isPartial?: boolean;
  stale?: boolean;
  previous?: KrxMasterMetadata | null;
}): KrxMasterMetadata {
  const now = input.now ?? Date.now();
  const counts = getKrxMarketCounts(input.entries);
  const tradable = getTradableKrxUniverse(input.entries).length;
  const source_markets = (['KOSPI', 'KOSDAQ', 'KONEX', 'OTHER'] as const).filter((m) =>
    input.entries.some((e) => e.market === m),
  );
  const fullOk = counts.raw_krx_master_total >= RAW_KRX_MASTER_MIN_TOTAL && tradable >= TRADABLE_KRX_UNIVERSE_MIN_TOTAL;
  return {
    last_full_master_refresh_at: now,
    last_successful_krx_master_at: fullOk ? now : (input.previous?.last_successful_krx_master_at ?? null),
    raw_krx_master_total: counts.raw_krx_master_total,
    kospi_total: counts.kospi_total,
    kosdaq_total: counts.kosdaq_total,
    konex_total_optional: counts.konex_total_optional,
    tradable_universe_total: tradable,
    scanner_candidate_total: input.scannerCandidateTotal ?? 0,
    watchlist_total: input.watchlistTotal ?? 0,
    source_markets,
    is_partial: input.isPartial ?? !fullOk,
    stale: input.stale ?? false,
    cache_version: KRX_MASTER_CACHE_VERSION,
  };
}

export function getKrxMasterMetadata(now: number = Date.now()): KrxMasterMetadata {
  if (!_store) {
    const disk = loadFromDisk();
    if (disk) {
      _store = disk;
      rebuildIndex(disk);
    }
  }
  const entries = _store?.entries ?? [];
  return buildKrxMasterMetadata({
    entries,
    now: _store?.fetchedAt ?? now,
    scannerCandidateTotal: _store?.metadata?.scanner_candidate_total ?? 0,
    watchlistTotal: _store?.metadata?.watchlist_total ?? 0,
    isPartial: _store?.metadata?.is_partial,
    stale: _store ? now - _store.fetchedAt > MASTER_TTL_MS : true,
    previous: _store?.metadata ?? null,
  });
}

function rebuildIndex(store: StockMasterStore): void {
  _byCode = new Map();
  _byName = new Map();
  for (const e of store.entries) {
    _byCode.set(e.code, e);
    _byName.set(e.name, e);
  }
}

function loadFromDisk(): StockMasterStore | null {
  ensureDataDir();
  if (!fs.existsSync(KRX_STOCK_MASTER_FILE)) return null;
  try {
    const raw = fs.readFileSync(KRX_STOCK_MASTER_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StockMasterStore;
    if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch (e) {
    emitMaintenanceWarn({ domain: 'DATA', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master disk load failed.', dedupKey: 'p3:krx-master:disk-load', error: e });
    return null;
  }
}

function saveToDisk(store: StockMasterStore): void {
  ensureDataDir();
  try {
    fs.writeFileSync(KRX_STOCK_MASTER_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    emitMaintenanceWarn({ domain: 'DATA', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master disk save failed.', dedupKey: 'p3:krx-master:disk-save', error: e });
  }
}

export function isMasterStale(now: number = Date.now()): boolean {
  if (!_store) {
    const disk = loadFromDisk();
    if (!disk) return true;
    _store = disk;
    rebuildIndex(disk);
  }
  return now - _store.fetchedAt > MASTER_TTL_MS;
}

/** 메모리·디스크 마스터 size (테스트·모니터링용). */
export function getMasterSize(): number {
  if (!_store) {
    const disk = loadFromDisk();
    if (disk) {
      _store = disk;
      rebuildIndex(disk);
    }
  }
  return _store?.entries.length ?? 0;
}

/**
 * 전체 마스터 entry 목록 — Tier 3 (PR-37) universe 모집단 등에서 사용.
 * 디스크 미로드 시 자동 로드. 마스터 부재 시 빈 배열.
 * 반환 배열은 호출자가 변형 가능한 새 array 이며 내부 store 와 분리된다.
 */
export function getAllStockEntries(): StockMasterEntry[] {
  if (!_store) {
    const disk = loadFromDisk();
    if (!disk) return [];
    _store = disk;
    rebuildIndex(disk);
  }
  return [..._store.entries];
}


export function updateKrxMasterRuntimeCounts(input: { scannerCandidateTotal?: number; watchlistTotal?: number }): void {
  if (!_store) {
    const disk = loadFromDisk();
    if (!disk) return;
    _store = disk;
    rebuildIndex(disk);
  }
  const metadata = buildKrxMasterMetadata({
    entries: _store.entries,
    now: _store.fetchedAt,
    scannerCandidateTotal: input.scannerCandidateTotal ?? _store.metadata?.scanner_candidate_total ?? 0,
    watchlistTotal: input.watchlistTotal ?? _store.metadata?.watchlist_total ?? 0,
    isPartial: _store.metadata?.is_partial,
    stale: Date.now() - _store.fetchedAt > MASTER_TTL_MS,
    previous: _store.metadata ?? null,
  });
  _store = { ..._store, metadata };
  saveToDisk(_store);
}

export function getStockByCode(code: string): StockMasterEntry | null {
  if (!_byCode) {
    const disk = loadFromDisk();
    if (!disk) return null;
    _store = disk;
    rebuildIndex(disk);
  }
  return _byCode!.get(code) ?? null;
}

export function getStockByName(name: string): StockMasterEntry | null {
  if (!_byName) {
    const disk = loadFromDisk();
    if (!disk) return null;
    _store = disk;
    rebuildIndex(disk);
  }
  return _byName!.get(name) ?? null;
}

/**
 * 종목명/문자열 안에서 알려진 종목명을 longest-match 로 추출.
 * 매치된 위치를 placeholder 로 마스킹해 같은 영역의 짧은 이름이 중복 매치되지 않도록 한다.
 * Google Search snippet 파싱 시 사용.
 */
export function extractStocksFromText(text: string, limit: number = 10): StockMasterEntry[] {
  if (!_byName) {
    const disk = loadFromDisk();
    if (!disk) return [];
    _store = disk;
    rebuildIndex(disk);
  }
  const names = Array.from(_byName!.keys()).sort((a, b) => b.length - a.length);
  const found: StockMasterEntry[] = [];
  const seen = new Set<string>();
  let scratch = text;
  for (const name of names) {
    if (name.length < 2) continue;
    if (!scratch.includes(name)) continue;
    const entry = _byName!.get(name)!;
    if (!seen.has(entry.code)) {
      seen.add(entry.code);
      found.push(entry);
    }
    // 매치 영역을 placeholder 로 치환 — 짧은 이름이 같은 자리를 중복 매치하지 못하게.
    scratch = scratch.split(name).join('\\0'.repeat(name.length));
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * 마스터 갱신 — 외부에서 fetch 한 entries 를 메모리·디스크에 영속화.
 * 실제 KRX 다운로드 로직은 호출자(`refreshKrxStockMaster()`)가 책임.
 */
export function setStockMaster(
  entries: StockMasterEntry[],
  now: number = Date.now(),
  metadata?: Partial<KrxMasterMetadata>,
): void {
  const normalizedEntries = dedupeMasterEntries(entries);
  const previous = _store?.metadata ?? loadFromDisk()?.metadata ?? null;
  const built = buildKrxMasterMetadata({ entries: normalizedEntries, now, previous });
  const store: StockMasterStore = {
    fetchedAt: now,
    entries: normalizedEntries,
    metadata: { ...built, ...metadata },
  };
  _store = store;
  rebuildIndex(store);
  saveToDisk(store);
}

/**
 * KRX 마스터 다운로드 — `MDCSTAT00101` 호출 후 영속화. 실패 시 false 반환.
 * 부팅 시 1회 + 24h TTL 만료 시 호출. 절대 규칙 #2 (kisClient 단일 통로) 와 무관 —
 * KRX 공개 통계 endpoint 는 별도 출처.
 */
export async function refreshKrxStockMaster(): Promise<boolean> {
  // 주말 단락: KRX CSV 가 비거나 불안정 — 디스크 캐시가 있으면 fetchedAt 을 now 로
  // 갱신해 isMasterStale() 가 24h TTL 내 false 반환하도록 한다. 갱신 없이 return
  // 하면 매 호출마다 stale 로 판정되어 불필요한 리소스 소비가 발생함 (PR-28 버그).
  if (isKstWeekend()) {
    const disk = loadFromDisk();
    if (disk) {
      // fetchedAt 을 now 로 재설정 — 주말 동안 repeated stale 판정 방지.
      setStockMaster(disk.entries);
      console.debug('[KrxStockMasterRepo] 주말 — KRX CSV 다운로드 생략, 디스크 캐시 유지');
      return true;
    }
    console.debug('[KrxStockMasterRepo] 주말 — 디스크 캐시 없음, 월요일까지 대기');
    return false;
  }
  // krxPost (같은 프로젝트의 krxClient) 가 bld 엔드포인트에서 성공하는 헤더 셋을
  // 그대로 차용. fileDn 경로가 UA/Referer 없으면 bot 으로 판정해 빈 응답을 주는
  // 사례가 보고되어 있다.
  const KRX_BASE = (process.env.KRX_PUBLIC_API_BASE ?? 'http://data.krx.co.kr').replace(/\/$/, '');
  const KRX_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/octet-stream, text/csv, */*',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${KRX_BASE}/contents/MDC/STAT/standard/MDCSTAT01901.cmd`,
    'Origin':  KRX_BASE,
  };
  try {
    const otpRes = await fetch(`${KRX_BASE}/comm/fileDn/GenerateOTP/generate.cmd`, {
      method: 'POST',
      headers: KRX_HEADERS,
      body: new URLSearchParams({
        mktId: 'ALL',
        share: '1',
        csvxls_isNo: 'false',
        name: 'fileDown',
        url: 'dbms/MDC/STAT/standard/MDCSTAT01901',
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!otpRes.ok) {
      emitMaintenanceWarn({ domain: 'PROVIDER', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master OTP request failed.', dedupKey: `p3:krx-master:otp:${otpRes.status}`, details: { status: otpRes.status } });
      return false;
    }
    const otp = (await otpRes.text()).trim();
    // 진단 로그 — 평일 다운로드 시도 시 원인 특정용. OTP 가 빈 문자열이면 원인 확정.
    console.log(`[KrxMaster:diag] OTP status=${otpRes.status} otp.len=${otp.length} otp.head="${otp.slice(0, 40)}"`);
    if (otp.length === 0) {
      emitMaintenanceWarn({ domain: 'PROVIDER', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master OTP response was empty.', dedupKey: 'p3:krx-master:otp-empty', details: { detailsSuppressed: true } });
      return false;
    }

    const dataRes = await fetch(`${KRX_BASE}/comm/fileDn/download_csv/download.cmd`, {
      method: 'POST',
      headers: KRX_HEADERS,
      body: new URLSearchParams({ code: otp }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!dataRes.ok) {
      emitMaintenanceWarn({ domain: 'PROVIDER', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master CSV download failed.', dedupKey: `p3:krx-master:csv:${dataRes.status}`, details: { status: dataRes.status } });
      return false;
    }
    const csv = await dataRes.text();
    // 진단 로그 — 응답 본문 첫 200자 + 크기. HTML 오류 페이지인지 CSV 헤더인지 즉시 판별.
    console.log(`[KrxMaster:diag] CSV status=${dataRes.status} bytes=${csv.length} head="${csv.slice(0, 200).replace(/\n/g, '\\n')}"`);
    const entries = parseKrxMasterCsv(csv);
    if (entries.length === 0) {
      emitMaintenanceWarn({ domain: 'DATA', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master CSV parsed zero rows; keeping active cache.', dedupKey: 'p3:krx-master:csv-empty', details: { bytes: csv.length, detailsSuppressed: true } });
      return false;
    }
    // 검증 임계 (ADR-0013) — count >= 2,000 + 코드/시장 비율. 미통과 시 활성 캐시 보존.
    const validation = validateMasterPayload(entries);
    if (!validation.valid) {
      emitMaintenanceWarn({ domain: 'DATA', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master validation failed; keeping active cache.', dedupKey: `p3:krx-master:validation:${validation.reason}`, details: { reason: validation.reason, detail: validation.detail, detailsSuppressed: true } });
      return false;
    }
    setStockMaster(entries);
    console.log(`[KrxStockMasterRepo] ✅ KRX 마스터 ${entries.length}건 갱신`);
    return true;
  } catch (e) {
    emitMaintenanceWarn({ domain: 'PROVIDER', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master refresh failed.', dedupKey: 'p3:krx-master:refresh', error: e });
    return false;
  }
}

/** KRX 다운로드 결과 — orchestrator (multiSourceStockMaster) 용 raw 페치. */
export interface KrxFetchResult {
  ok: boolean;
  entries: StockMasterEntry[];
  rawBytes: number;
  reason?: 'WEEKEND' | 'OTP_HTTP' | 'OTP_EMPTY' | 'CSV_HTTP' | 'HTML_DETECTED' | 'EMPTY_PARSE' | 'EXCEPTION';
  detail?: string;
}

/**
 * 활성 마스터를 갱신하지 않는 raw 페치 — 검증·shadow 갱신 결정은 호출자가 한다.
 * `refreshKrxStockMaster()` 와 다르게 setStockMaster 를 호출하지 않는다 (ADR-0013).
 */
export async function fetchKrxMasterEntries(): Promise<KrxFetchResult> {
  if (isKstWeekend()) {
    return { ok: false, entries: [], rawBytes: 0, reason: 'WEEKEND' };
  }
  const KRX_BASE = (process.env.KRX_PUBLIC_API_BASE ?? 'http://data.krx.co.kr').replace(/\/$/, '');
  const KRX_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/octet-stream, text/csv, */*',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${KRX_BASE}/contents/MDC/STAT/standard/MDCSTAT01901.cmd`,
    'Origin':  KRX_BASE,
  };
  try {
    const otpRes = await fetch(`${KRX_BASE}/comm/fileDn/GenerateOTP/generate.cmd`, {
      method: 'POST',
      headers: KRX_HEADERS,
      body: new URLSearchParams({
        mktId: 'ALL',
        share: '1',
        csvxls_isNo: 'false',
        name: 'fileDown',
        url: 'dbms/MDC/STAT/standard/MDCSTAT01901',
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!otpRes.ok) {
      return { ok: false, entries: [], rawBytes: 0, reason: 'OTP_HTTP', detail: `${otpRes.status}` };
    }
    const otp = (await otpRes.text()).trim();
    if (otp.length === 0) {
      return { ok: false, entries: [], rawBytes: 0, reason: 'OTP_EMPTY' };
    }
    const dataRes = await fetch(`${KRX_BASE}/comm/fileDn/download_csv/download.cmd`, {
      method: 'POST',
      headers: KRX_HEADERS,
      body: new URLSearchParams({ code: otp }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!dataRes.ok) {
      return { ok: false, entries: [], rawBytes: 0, reason: 'CSV_HTTP', detail: `${dataRes.status}` };
    }
    const csv = await dataRes.text();
    if (isLikelyHtmlResponse(csv)) {
      return { ok: false, entries: [], rawBytes: csv.length, reason: 'HTML_DETECTED' };
    }
    const entries = parseKrxMasterCsv(csv);
    if (entries.length === 0) {
      return { ok: false, entries: [], rawBytes: csv.length, reason: 'EMPTY_PARSE' };
    }
    return { ok: true, entries: dedupeMasterEntries(entries), rawBytes: csv.length };
  } catch (e) {
    return { ok: false, entries: [], rawBytes: 0, reason: 'EXCEPTION', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * KRX 응답 본문이 HTML 오류 페이지인지 감지 (ADR-0013).
 * KRX 가 점검·rate-limit·세션 만료 시 CSV 대신 HTML 을 반환하는 사례가 있다.
 * head 200바이트의 시작 토큰을 검사해 HTML 이면 true. CSV (BOM/숫자/한글) 는 false.
 */
export function isLikelyHtmlResponse(body: string): boolean {
  if (typeof body !== 'string' || body.length === 0) return false;
  const head = body.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<?xml');
}


function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells.map((c) => c.replace(/^"|"$/g, '').trim());
}

/** 외부 노출 — KRX CSV 파서 (테스트 가능하도록 분리). HTML 응답 감지 시 빈 배열. */
function classifyKrxMarket(marketRaw: string): StockMasterEntry['market'] {
  if (marketRaw === 'KOSPI') return 'KOSPI';
  if (marketRaw === 'KOSDAQ') return 'KOSDAQ';
  if (marketRaw === 'KONEX') return 'KONEX';
  return 'OTHER';
}

export function parseKrxMasterCsv(csv: string): StockMasterEntry[] {
  if (isLikelyHtmlResponse(csv)) {
    emitMaintenanceWarn({ domain: 'DATA', code: 'P3_KRX_MASTER_REPO_DEGRADED', source: 'KRX_MASTER_REPO', message: 'KRX stock master CSV parser detected HTML response.', dedupKey: 'p3:krx-master:html-response', details: { detailsSuppressed: true } });
    return [];
  }
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const out: StockMasterEntry[] = [];
  // KRX MDCSTAT01901 컬럼 (한국어 헤더): cols[0] 표준코드(ISIN), cols[1] 단축코드,
  //   cols[2] 한글 종목명, cols[3] 한글 종목약명, cols[4] 영문 종목명,
  //   cols[5] 상장일, cols[6] 시장구분, cols[7] 증권구분, cols[8] 소속부,
  //   cols[9] 주식종류, cols[10] 액면가, cols[11] 상장주식수
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 7) continue;
    const code = cols[1];
    const name = cols[2];
    const marketRaw = cols[6];
    if (!/^\d{6}$/.test(code) || !name) continue;
    const market: StockMasterEntry['market'] = classifyKrxMarket(marketRaw);
    // ADR-0455: 옵셔널 enrichment 필드 — CSV 컬럼 길이 가드 + 빈 값 skip (정합 보존).
    const entry: StockMasterEntry = { code, name, market };
    if (cols[7]) entry.securityType = cols[7];
    if (cols[8]) entry.department = cols[8];
    if (cols[9]) entry.stockType = cols[9];
    const isinRaw = cols[0];
    if (isinRaw && /^[A-Z0-9]{12}$/i.test(isinRaw)) entry.isin = isinRaw.toUpperCase();
    const nameEngRaw = cols.length > 4 ? cols[4] : '';
    if (nameEngRaw && nameEngRaw.length > 0) entry.nameEng = nameEngRaw;
    const listDateRaw = cols.length > 5 ? cols[5] : '';
    if (listDateRaw && /^\d{4}[-/]?\d{2}[-/]?\d{2}$/.test(listDateRaw)) {
      // KRX CSV 는 보통 'YYYY/MM/DD' 또는 'YYYY-MM-DD' — 'YYYY-MM-DD' 정규화.
      entry.listDate = listDateRaw.replace(/[/]/g, '-');
    }
    const listedSharesRaw = cols.length > 11 ? cols[11].replace(/,/g, '') : '';
    const listedSharesNum = listedSharesRaw ? Number(listedSharesRaw) : NaN;
    if (Number.isFinite(listedSharesNum) && listedSharesNum > 0) {
      entry.listedShares = listedSharesNum;
    }
    out.push(entry);
  }
  return out;
}

export interface MasterValidationResult {
  valid: boolean;
  count: number;
  reason?: 'EMPTY' | 'BELOW_MIN' | 'BAD_CODE_RATIO' | 'BAD_MARKET_RATIO';
  detail?: string;
}

/**
 * 종목 마스터 payload 검증 — Tier 1/2 응답을 받기 전에 통과해야 함 (ADR-0013).
 * - count >= minCount (기본 2,000)
 * - 6자리 코드 매치율 >= 95%
 * - KOSPI+KOSDAQ 비율 >= 80%
 *
 * 검증 실패 시 호출자는 shadow/seed 로 폴백하고 기존 활성 마스터를 보존해야 한다.
 */
export function validateMasterPayload(
  entries: StockMasterEntry[],
  minCount: number = 2000,
): MasterValidationResult {
  const count = entries.length;
  if (count === 0) return { valid: false, count, reason: 'EMPTY', detail: '0건' };
  if (count < minCount) return { valid: false, count, reason: 'BELOW_MIN', detail: `${count} < ${minCount}` };

  const validCodeCount = entries.filter((e) => /^\d{6}$/.test(e.code)).length;
  const codeRatio = validCodeCount / count;
  if (codeRatio < 0.95) {
    return { valid: false, count, reason: 'BAD_CODE_RATIO', detail: `${(codeRatio * 100).toFixed(1)}%` };
  }

  const equityCount = entries.filter((e) => e.market === 'KOSPI' || e.market === 'KOSDAQ').length;
  const marketRatio = equityCount / count;
  if (marketRatio < 0.8) {
    return { valid: false, count, reason: 'BAD_MARKET_RATIO', detail: `${(marketRatio * 100).toFixed(1)}%` };
  }

  return { valid: true, count };
}

/**
 * ADR-0455: KRX master enrichment coverage 진단 (운영자 가시화).
 *
 * 4 옵셔널 필드 (isin/listDate/listedShares/nameEng) 의 채움 비율을 % 로 산출.
 * `/krx_master_status` 같은 진단 명령 / 부팅 로그에서 호출.
 *
 * 산출 정책:
 * - 분모: total entries (빈 store → 모든 비율 0)
 * - 분자: 각 필드별 truthy + 정규식 통과 entry 수
 * - 외부 호출 0건 (in-memory store read-only)
 */
export interface KrxMasterEnrichmentCoverage {
  total: number;
  isinCoveragePct: number;
  listDateCoveragePct: number;
  listedSharesCoveragePct: number;
  nameEngCoveragePct: number;
}

export function getKrxMasterEnrichmentCoverage(): KrxMasterEnrichmentCoverage {
  const entries = getAllStockEntries();
  const total = entries.length;
  if (total === 0) {
    return {
      total: 0,
      isinCoveragePct: 0,
      listDateCoveragePct: 0,
      listedSharesCoveragePct: 0,
      nameEngCoveragePct: 0,
    };
  }
  let isin = 0;
  let listDate = 0;
  let listedShares = 0;
  let nameEng = 0;
  for (const e of entries) {
    if (typeof e.isin === 'string' && e.isin.length > 0) isin++;
    if (typeof e.listDate === 'string' && e.listDate.length > 0) listDate++;
    if (typeof e.listedShares === 'number' && Number.isFinite(e.listedShares) && e.listedShares > 0) {
      listedShares++;
    }
    if (typeof e.nameEng === 'string' && e.nameEng.length > 0) nameEng++;
  }
  return {
    total,
    isinCoveragePct: Math.round((isin / total) * 1000) / 10,
    listDateCoveragePct: Math.round((listDate / total) * 1000) / 10,
    listedSharesCoveragePct: Math.round((listedShares / total) * 1000) / 10,
    nameEngCoveragePct: Math.round((nameEng / total) * 1000) / 10,
  };
}

// 테스트 전용
export const __testOnly = {
  parseCsvLine,
  reset(): void {
    _store = null;
    _byCode = null;
    _byName = null;
  },
};
