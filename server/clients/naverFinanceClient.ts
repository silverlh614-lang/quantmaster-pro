/**
 * @responsibility Naver Finance 모바일 API 단일 통로 — AI 추천 enrichment 무비용 소스 (ADR-0011, PR-25-A)
 *
 * 비공식이지만 m.stock.naver.com 모바일 앱이 사용하는 안정 endpoint. KIS/KRX
 * 자동매매 quota 침범 없이 종목 현재가·PER/PBR·시총·외인비율을 무료로 조회한다.
 * 자동매매 경로는 호출 금지 — 이 모듈은 AI 추천 경로 전용.
 */

import { tryConsume } from '../persistence/aiCallBudgetRepo.js';

const NAVER_BASE = 'https://m.stock.naver.com/api/stock';
const TIMEOUT_MS = 6000;

/**
 * 단기 negative cache — Naver 가 특정 종목코드에 대해 4xx(409 throttle, 404 없음, 410 폐지)
 * 를 반환하면 5분간 재시도 차단. 일일 예산이 같은 실패 코드로 반복 소진되는 것을 방지하고
 * 스케줄러 cron 의 매 호출 사이클에서 동일 실패를 누적하지 않도록 한다.
 */
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const _negativeCache = new Map<string, number>();

function isNegativelyCached(code: string): boolean {
  const expiresAt = _negativeCache.get(code);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    _negativeCache.delete(code);
    return false;
  }
  return true;
}

function recordNegative(code: string): void {
  _negativeCache.set(code, Date.now() + NEGATIVE_TTL_MS);
  // 메모리 가드 — 200건 초과 시 만료된 것 정리
  if (_negativeCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _negativeCache.entries()) {
      if (v <= now) _negativeCache.delete(k);
    }
  }
}

/** 테스트 전용 — negative cache 초기화. */
export function resetNaverNegativeCache(): void {
  _negativeCache.clear();
}

export interface NaverStockSnapshot {
  code: string;
  name: string;
  closePrice: number;
  changeRate: number;
  marketCap: number;
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  dividendYield: number;
  foreignerOwnRatio: number;
  source: 'NAVER_MOBILE';
}

const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://m.stock.naver.com/',
};

function parseNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').replace(/%$/, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * totalInfos 밸류에이션 값 파서 — 한국어 단위 접미사(배·원·주·%) 제거 후 숫자화.
 * Naver 는 per "165.96배"·pbr "13.52배"·eps "10,587원"·bps "129,912원"·배당 "0.13%" 처럼
 * 값에 단위를 붙여 보내, 콤마·말미%만 제거하는 parseNumber 로는 NaN→0 으로 떨어졌다
 * (per/pbr/eps/bps 전 항목 0 결함 — 사용자 prod 보고). 콤마 제거 후 숫자·부호·소수점만
 * 남겨 Number 화한다. 시총(조/억 복합 표기)은 parseMarketCapWon 으로 별도 처리.
 */
function parseUnitNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const cleaned = v.replace(/,/g, '').replace(/[^0-9.+-]/g, '').trim();
  if (!cleaned || /^[+\-.]+$/.test(cleaned)) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 시가총액 "131조 2,368억" → 원 단위 숫자(131,236,800,000,000). 조=1e12·억=1e8·만=1e4 자리값 합산.
 * formatMarketCapKr(aiUniverseRouter, 단위:원)·display 와 단위 정합 — 합산 결과 그대로 marketCap 으로
 * 전달하면 marketCapDisplay 가 "131조 2,368억"로 복원된다. 단위 토큰 부재 시 콤마 제거 숫자 그대로.
 */
function parseMarketCapWon(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const s = v.replace(/,/g, '').replace(/\s+/g, '');
  if (!s) return 0;
  let won = 0;
  let matched = false;
  const grab = (unit: string, mult: number): void => {
    const m = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`));
    if (m) { won += parseFloat(m[1]) * mult; matched = true; }
  };
  grab('조', 1e12);
  grab('억', 1e8);
  grab('만', 1e4);
  return matched ? won : parseUnitNumber(s);
}

/**
 * 종목 단건 스냅샷. 6자리 코드 검증 + 예산 가드 + 5분 negative cache.
 * 실패 시 null 반환 (호출자가 fallback 결정).
 */
export async function fetchNaverStockSnapshot(code: string): Promise<NaverStockSnapshot | null> {
  if (!/^\d{6}$/.test(code)) return null;
  // 직전 4xx 실패가 5분 이내면 outbound 자체 스킵 — 예산 보존.
  if (isNegativelyCached(code)) return null;
  if (!tryConsume('naver_finance', 1)) return null;

  const url = `${NAVER_BASE}/${code}/integration`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      // 4xx 는 종목 자체 문제(폐지/잘못된 코드/throttle) 일 가능성이 높아 negative cache 적용.
      // 5xx 는 일시 장애로 판단하여 캐시하지 않음.
      if (res.status >= 400 && res.status < 500) {
        recordNegative(code);
      }
      if (res.status !== 404) {
        console.warn(`[NaverFinance] HTTP ${res.status} for ${code}`);
      }
      return null;
    }
    const data = await res.json() as Record<string, any>;
    const stockEnd = data.stockEndType ?? '';
    const dealTrendInfos = data.dealTrendInfos?.[0] ?? {};
    const totalInfos = data.totalInfos ?? [];
    const findInfo = (key: string): unknown => {
      const hit = totalInfos.find((t: any) => t?.code === key);
      return hit?.value ?? null;
    };

    // closePrice 필드 우선순위 — dealTrendInfos[0] (최근 거래일별 record) 가
    // 권위 있는 값. top-level `data.closePrice` 는 기준가/예전값 의미가 모호해
    // 종목별로 stale 가능 (SK하이닉스 000660 ₩1.86M vs 실제 5/29 종가 ₩2.33M
    // 케이스 — 사용자 보고). top-level 은 dealTrendInfos 부재 시 fallback 만.
    const dealCp = parseNumber(dealTrendInfos.closePrice);
    const topCp = parseNumber(data.closePrice);
    const closePrice = dealCp > 0 ? dealCp : topCp;
    const dealCr = parseNumber(dealTrendInfos.fluctuationsRatio);
    const topCr = parseNumber(data.fluctuationsRatio);
    const changeRate = dealCp > 0 ? dealCr : topCr; // closePrice 동일 출처 정합
    // 두 필드 동시 존재 + 5% 이상 괴리 시 진단 로그 (Naver 측 캐시·필드 의미 변경 감지)
    if (dealCp > 0 && topCp > 0 && Math.abs(dealCp - topCp) / dealCp > 0.05) {
      console.warn(`[NaverFinance] closePrice 괴리 ${code}: dealTrendInfos=${dealCp} top=${topCp} (dealTrendInfos 채택)`);
    }

    return {
      code,
      name: data.stockName ?? '',
      closePrice,
      changeRate,
      // 단위 접미사 처리 — 시총 "131조 2,368억"→원, per/pbr "165.96배"→숫자, eps/bps "10,587원"→숫자
      // (parseNumber 는 콤마·말미%만 제거해 배/원/조/억 을 0 으로 떨어뜨렸다 — 사용자 prod 보고 결함).
      marketCap: parseMarketCapWon(findInfo('marketValue')),
      per: parseUnitNumber(findInfo('per')),
      pbr: parseUnitNumber(findInfo('pbr')),
      eps: parseUnitNumber(findInfo('eps')),
      bps: parseUnitNumber(findInfo('bps')),
      // Naver 통합 totalInfos 실제 코드: 배당수익률=dividendYieldRatio, 외인소진율=foreignRate
      // (기존 'dividendRatio'/'foreignerOwnRatio' 는 코드 불일치로 항상 0 였음 — 키名 정정).
      dividendYield: parseUnitNumber(findInfo('dividendYieldRatio')),
      foreignerOwnRatio: parseUnitNumber(findInfo('foreignRate')),
      source: 'NAVER_MOBILE',
    };
    void stockEnd;
  } catch (e) {
    console.warn(`[NaverFinance] fetch 실패 ${code}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Yahoo `inquire`/chart 호환 형태 — extractValidChartData 가 그대로 소비. */
export interface NaverDailyChart {
  timestamp: number[]; // unix seconds, 오름차순
  indicators: { quote: [{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }] };
}

/**
 * Naver 모바일 일봉(`/price`) 응답을 Yahoo 호환 차트 형태로 정규화 (순수 함수 — 단위 테스트 대상).
 * Naver row: localTradedAt('YYYY-MM-DD')·openPrice/highPrice/lowPrice/closePrice(콤마 문자열)·
 * accumulatedTradingVolume. 최신순으로 오므로 오름차순으로 뒤집는다.
 */
export function normalizeNaverDaily(rows: unknown): NaverDailyChart | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // 날짜(ts)별 dedup — lightweight-charts 는 시간이 유일·오름차순이어야 렌더된다.
  const byTs = new Map<number, { open: number; high: number; low: number; close: number; volume: number }>();
  for (const r of rows) {
    const row = (r ?? {}) as Record<string, unknown>;
    const ms = Date.parse(String(row.localTradedAt ?? '').trim());
    const c = parseNumber(row.closePrice);
    if (!Number.isFinite(ms) || !(c > 0)) continue;
    byTs.set(Math.floor(ms / 1000), {
      open: parseNumber(row.openPrice) || c,
      high: parseNumber(row.highPrice) || c,
      low: parseNumber(row.lowPrice) || c,
      close: c,
      volume: parseNumber(row.accumulatedTradingVolume),
    });
  }
  if (byTs.size === 0) return null;
  const sorted = [...byTs.entries()].sort((a, b) => a[0] - b[0]); // 오름차순·유일
  return {
    timestamp: sorted.map(([ts]) => ts),
    indicators: {
      quote: [{
        open: sorted.map(([, v]) => v.open),
        high: sorted.map(([, v]) => v.high),
        low: sorted.map(([, v]) => v.low),
        close: sorted.map(([, v]) => v.close),
        volume: sorted.map(([, v]) => v.volume),
      }],
    },
  };
}

/**
 * 종목 일봉 OHLCV (KR 6자리). Yahoo 신뢰 철회(KR stale) 대체 — 차트 정본 소스.
 *
 * Naver `/price` 는 pageSize 60 초과 시 빈 응답을 주므로 **반드시 페이지네이션**한다
 * (이전 count=264 단일요청은 빈값→Yahoo fallback→장외 blank 결함을 유발했다).
 * 실패 시 null (호출자가 Yahoo fallback 결정). 예산 가드 + negative cache 공유.
 */
export async function fetchNaverDailyOhlcv(code: string, count = 260): Promise<NaverDailyChart | null> {
  if (!/^\d{6}$/.test(code)) return null;
  if (isNegativelyCached(code)) return null;
  if (!tryConsume('naver_finance', 1)) return null;
  const PAGE_SIZE = 60; // Naver 하드 캡 (60 OK, 90+ 빈 응답)
  const pages = Math.min(8, Math.max(1, Math.ceil(count / PAGE_SIZE)));
  const all: unknown[] = [];
  try {
    for (let page = 1; page <= pages; page++) {
      const res = await fetch(`${NAVER_BASE}/${code}/price?pageSize=${PAGE_SIZE}&page=${page}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) recordNegative(code);
        break;
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break; // 마지막 페이지 (더 과거 데이터 없음)
    }
  } catch (e) {
    console.warn(`[NaverFinance] daily fetch 실패 ${code}: ${e instanceof Error ? e.message : e}`);
  }
  return all.length > 0 ? normalizeNaverDaily(all) : null;
}

/** 외국인/기관 순매수 (frgn.naver) — 표시 전용. KIS 와 달리 장외에도 가용. */
export interface NaverInvestorTrend {
  foreignNet: number;      // 최근 5거래일 외국인 순매수 합
  institutionNet: number;  // 최근 5거래일 기관 순매수 합
  individualNet: number;   // frgn.naver 미제공 → -(외인+기관) 근사
  foreignConsecutive: number;
  isPassiveAndActive: boolean;
  foreignerOwnRatio?: number;
  dataSource: 'NAVER';
}

function parseSignedNumber(input: string): number | null {
  const cleaned = input.replace(/,/g, '').replace(/%/g, '').replace(/[^\d+\-.]/g, '').trim();
  if (!cleaned || !/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * frgn.naver(외국인/기관 매매동향) HTML 을 5일 누적 순매수로 정규화 (순수 함수 — 단위 테스트).
 * 컬럼: 날짜, 종가, 전일대비, 등락률, 거래량, 기관 순매수(nums[4]), 외국인 순매수(nums[5]),
 * 외국인 보유주수(nums[6]), 외국인 보유율%(nums[7]). 숫자/날짜는 ASCII 라 EUC-KR 디코딩 불필요.
 */
export function normalizeNaverInvestorTrend(html: string): NaverInvestorTrend | null {
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  const data: { institution: number; foreign: number; ownRatio: number | null }[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (!cells.some((c) => /\d{4}\.\d{2}\.\d{2}/.test(c))) continue;
    const nums = cells.filter((c) => c && !/\d{4}\.\d{2}\.\d{2}/.test(c));
    const institution = parseSignedNumber(nums[4] ?? '');
    const foreign = parseSignedNumber(nums[5] ?? '');
    if (institution === null && foreign === null) continue;
    data.push({ institution: institution ?? 0, foreign: foreign ?? 0, ownRatio: parseSignedNumber(nums[7] ?? '') });
  }
  if (data.length === 0) return null;
  const recent = data.slice(0, 5);
  const foreignNet = recent.reduce((s, r) => s + r.foreign, 0);
  const institutionNet = recent.reduce((s, r) => s + r.institution, 0);
  let foreignConsecutive = 0;
  for (const r of recent) {
    if (r.foreign > 0) foreignConsecutive += 1;
    else break;
  }
  return {
    foreignNet,
    institutionNet,
    individualNet: -(foreignNet + institutionNet),
    foreignConsecutive,
    isPassiveAndActive: foreignNet > 0 && institutionNet > 0,
    foreignerOwnRatio: recent[0].ownRatio ?? undefined,
    dataSource: 'NAVER',
  };
}

/** 외국인/기관 순매수 (frgn.naver, 장외 가용). 실패 시 null. */
export async function fetchNaverInvestorTrend(code: string): Promise<NaverInvestorTrend | null> {
  if (!/^\d{6}$/.test(code)) return null;
  if (isNegativelyCached(code)) return null;
  if (!tryConsume('naver_finance', 1)) return null;
  const url = `https://finance.naver.com/item/frgn.naver?code=${code}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Referer': 'https://finance.naver.com/',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) recordNegative(code);
      return null;
    }
    // 숫자/날짜는 ASCII — latin1 로 읽어 EUC-KR 디코딩 없이 파싱 (한글 라벨은 무시).
    const html = Buffer.from(await res.arrayBuffer()).toString('latin1');
    return normalizeNaverInvestorTrend(html);
  } catch (e) {
    console.warn(`[NaverFinance] frgn fetch 실패 ${code}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * 다중 종목 enrichment — 병렬 4건 제한.
 */
export async function fetchNaverStockSnapshots(codes: string[]): Promise<Map<string, NaverStockSnapshot>> {
  const out = new Map<string, NaverStockSnapshot>();
  const queue = codes.filter((c) => /^\d{6}$/.test(c));
  const CONCURRENCY = 4;
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const code = queue.shift();
      if (!code) return;
      const snap = await fetchNaverStockSnapshot(code);
      if (snap) out.set(code, snap);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
}

// 테스트 전용 — 파서 검증
export const __testOnly = {
  parseNumber,
  parseUnitNumber,
  parseMarketCapWon,
};
