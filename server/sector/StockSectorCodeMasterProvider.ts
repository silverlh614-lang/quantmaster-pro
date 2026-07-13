// @responsibility ADR-0601 D4 — KIS 종목 마스터(kospi/kosdaq_code.mst)에서 종목별 지수업종 대/중/소 코드를 일캐시로 제공.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import { extractMstFromZipBuffer } from './SectorIndexMasterProvider.js';

const KIS_STOCK_MASTER_URLS = {
  KOSPI: 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip',
  KOSDAQ: 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip',
} as const;

/** 공식 파서(stocks_info/kis_kospi|kosdaq_code_mst.py) 고정폭 tail 바이트 수 — tail 은 전부 ASCII. */
const MASTER_TAIL_BYTES = { KOSPI: 228, KOSDAQ: 222 } as const;

export type StockMasterMarket = keyof typeof KIS_STOCK_MASTER_URLS;

export interface StockSectorCodeRow {
  symbol: string;
  market: StockMasterMarket;
  /** 지수업종 대분류 코드 (tail offset 3~7). */
  sectorLargeCode: string;
  /** 지수 업종 중분류 코드 (tail offset 7~11). */
  sectorMediumCode: string;
  /** 지수업종 소분류 코드 (tail offset 11~15). */
  sectorSmallCode: string;
}

export interface StockSectorCodeMasterResult {
  loaded: boolean;
  rowCount: number;
  kospiRows: number;
  kosdaqRows: number;
  downloadedMarkets: StockMasterMarket[];
  cacheFallbackMarkets: StockMasterMarket[];
  parseStatus: 'OK' | 'PARTIAL' | 'FAILED';
  bySymbol: Map<string, StockSectorCodeRow>;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE';
  reasonCodes: string[];
  fetchedAt: string;
}

export interface LoadStockSectorCodeMasterOptions {
  urls?: Partial<Record<StockMasterMarket, string>>;
  cacheDir?: string;
  fetchZip?: (url: string) => Promise<Buffer>;
  writeCache?: boolean;
  now?: () => Date;
}

const DEFAULT_CACHE_DIR = path.join(DATA_DIR, 'stock-sector-master');
const MARKETS: StockMasterMarket[] = ['KOSPI', 'KOSDAQ'];

function cacheFileFor(cacheDir: string, market: StockMasterMarket): string {
  return path.join(cacheDir, `${market.toLowerCase()}_code.mst`);
}

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

async function defaultFetchZip(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`stock master zip fetch failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function asciiField(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString('latin1').trim();
}

/** 종목 마스터 1개 시장 파싱 — 단축코드(앞 9B)와 tail 고정폭의 업종 코드 3종만 추출 (한글 미사용 → cp949 디코딩 불필요). */
export function parseStockMasterBuffer(buffer: Buffer, market: StockMasterMarket): StockSectorCodeRow[] {
  const tailBytes = MASTER_TAIL_BYTES[market];
  const rows: StockSectorCodeRow[] = [];
  let lineStart = 0;
  for (let i = 0; i <= buffer.length; i += 1) {
    if (i !== buffer.length && buffer[i] !== 0x0a) continue;
    let lineEnd = i;
    if (lineEnd > lineStart && buffer[lineEnd - 1] === 0x0d) lineEnd -= 1;
    const line = buffer.subarray(lineStart, lineEnd);
    lineStart = i + 1;
    if (line.length < tailBytes + 9) continue;
    const symbolRaw = asciiField(line, 0, 9);
    const symbol = symbolRaw.replace(/[^0-9]/g, '');
    if (symbol.length !== 6) continue;
    const tailStart = line.length - tailBytes;
    const sectorLargeCode = asciiField(line, tailStart + 3, tailStart + 7);
    const sectorMediumCode = asciiField(line, tailStart + 7, tailStart + 11);
    const sectorSmallCode = asciiField(line, tailStart + 11, tailStart + 15);
    if (!/^\d{1,4}$/.test(sectorMediumCode) && !/^\d{1,4}$/.test(sectorLargeCode)) continue;
    rows.push({ symbol, market, sectorLargeCode, sectorMediumCode, sectorSmallCode });
  }
  return rows;
}

let memoized: { dateKey: string; result: StockSectorCodeMasterResult } | null = null;

/** 테스트 격리용 — 운영 경로 미사용. */
export function __resetStockSectorCodeMasterMemoForTest(): void {
  memoized = null;
}

/**
 * KOSPI/KOSDAQ 종목 마스터를 일 1회(KST) 다운로드·캐시하고 symbol→업종코드 맵을 반환한다.
 * 다운로드 실패 시 디스크 캐시 fallback, 둘 다 실패한 시장은 PARTIAL/FAILED 로 정직 보고
 * (결손 ≠ 신호 — 소비처는 missing 유지). 프로세스 내 일자 메모이즈로 재호출 비용 0.
 */
export async function loadStockSectorCodeMaster(
  options: LoadStockSectorCodeMasterOptions = {},
): Promise<StockSectorCodeMasterResult> {
  const now = options.now?.() ?? new Date();
  const dateKey = kstDateKey(now);
  if (memoized && memoized.dateKey === dateKey) return memoized.result;
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const fetchZip = options.fetchZip ?? defaultFetchZip;
  const result: StockSectorCodeMasterResult = {
    loaded: false,
    rowCount: 0,
    kospiRows: 0,
    kosdaqRows: 0,
    downloadedMarkets: [],
    cacheFallbackMarkets: [],
    parseStatus: 'FAILED',
    bySymbol: new Map(),
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    reasonCodes: [],
    fetchedAt: now.toISOString(),
  };
  let okMarkets = 0;
  for (const market of MARKETS) {
    const cacheFile = cacheFileFor(cacheDir, market);
    let mst: Buffer | null = null;
    try {
      const zip = await fetchZip(options.urls?.[market] ?? KIS_STOCK_MASTER_URLS[market]);
      mst = extractMstFromZipBuffer(zip);
      result.downloadedMarkets.push(market);
      if (options.writeCache !== false) {
        try {
          ensureDataDir();
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, mst);
        } catch {
          result.reasonCodes.push(`${market}_CACHE_WRITE_FAILED`);
        }
      }
    } catch {
      result.reasonCodes.push(`${market}_DOWNLOAD_FAILED`);
      try {
        if (fs.existsSync(cacheFile)) {
          mst = fs.readFileSync(cacheFile);
          result.cacheFallbackMarkets.push(market);
        }
      } catch {
        mst = null;
      }
    }
    if (!mst) {
      result.providerIssue = true;
      result.reasonCodes.push(`${market}_MASTER_UNAVAILABLE`);
      continue;
    }
    const rows = parseStockMasterBuffer(mst, market);
    if (rows.length === 0) {
      result.providerIssue = true;
      result.reasonCodes.push(`${market}_PARSE_EMPTY`);
      continue;
    }
    okMarkets += 1;
    if (market === 'KOSPI') result.kospiRows = rows.length;
    else result.kosdaqRows = rows.length;
    for (const row of rows) result.bySymbol.set(row.symbol, row);
  }
  result.rowCount = result.bySymbol.size;
  result.loaded = result.rowCount > 0;
  result.parseStatus = okMarkets === MARKETS.length ? 'OK' : okMarkets > 0 ? 'PARTIAL' : 'FAILED';
  memoized = { dateKey, result };
  return result;
}
