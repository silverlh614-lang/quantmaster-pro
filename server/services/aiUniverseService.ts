/**
 * @responsibility AI 추천 universe 발굴 + enrichment 단일 통로 — KIS/KRX 비의존 (ADR-0011, PR-25-A)
 *
 * 절대 규칙 #3 의 AI 추천 전용 신규 통로. googleSearchClient + naverFinanceClient +
 * krxStockMasterRepo 3개 소스를 결합해 (1) Google Search 로 후보 universe 발굴,
 * (2) Naver Finance 로 enrichment, (3) KRX 마스터로 종목명·시장 매핑한다. 자동매매
 * 경로는 호출 금지 — signalScanner 등은 그대로 stockService/kisClient 사용.
 */

import { googleSearch } from '../clients/googleSearchClient.js';
import { fetchNaverStockSnapshots, type NaverStockSnapshot } from '../clients/naverFinanceClient.js';
import {
  extractStocksFromText,
  getStockByCode,
  isMasterStale,
  refreshKrxStockMaster,
  type StockMasterEntry,
} from '../persistence/krxStockMasterRepo.js';
import { tryConsume } from '../persistence/aiCallBudgetRepo.js';
import { isKstWeekend } from '../utils/marketClock.js';

export type AiUniverseMode = 'MOMENTUM' | 'QUANT_SCREEN' | 'BEAR_SCREEN' | 'EARLY_DETECT';

export interface AiUniverseCandidate extends StockMasterEntry {
  /** 후보를 발견한 1차 출처 (Google Search 결과 displayLink) */
  discoveredFrom: string[];
  /** Naver Finance 스냅샷 — enrichment 실패 시 null */
  snapshot: NaverStockSnapshot | null;
}

/**
 * Google 결과의 origin 상태. AI 추천이 "완료되었는데 아무것도 없음" 오인을 막기 위해
 * 클라이언트가 사용자에게 정확한 사유를 표시할 수 있도록 우선순위 단일 값으로 요약한다.
 * - GOOGLE_OK: 실제 Google CSE 매칭 성공
 * - FALLBACK_SEED: Google 매칭 0건 → 하드코딩 seed 로 대체
 * - NOT_CONFIGURED: GOOGLE_SEARCH_API_KEY/CX 미설정
 * - BUDGET_EXCEEDED: google_search bucket 일일 한도 초과
 * - ERROR: HTTP / fetch 오류
 * - NO_MATCHES: Google 결과는 있었지만 KRX 마스터 매칭 0건 (or 마스터 비어있음)
 */
export type AiUniverseSourceStatus =
  | 'GOOGLE_OK'
  | 'FALLBACK_SEED'
  | 'NOT_CONFIGURED'
  | 'BUDGET_EXCEEDED'
  | 'ERROR'
  | 'NO_MATCHES';

export interface AiUniverseResult {
  mode: AiUniverseMode;
  candidates: AiUniverseCandidate[];
  fetchedAt: number;
  diagnostics: {
    googleQueries: number;
    googleHits: number;
    masterMisses: number;
    enrichSucceeded: number;
    enrichFailed: number;
    budgetExceeded: boolean;
    sourceStatus: AiUniverseSourceStatus;
    fallbackUsed: boolean;
  };
}

const MODE_QUERIES: Record<AiUniverseMode, string[]> = {
  MOMENTUM: ['오늘 급등주', '거래량 급증 종목'],
  EARLY_DETECT: ['거래량 마름 후 돌파', '신고가 돌파 종목'],
  QUANT_SCREEN: ['저PER 저PBR 우량주', '실적 개선주'],
  BEAR_SCREEN: ['약세장 방어주', '고배당 우량주'],
};

/**
 * Google Search 미설정·예산 초과·매칭 실패 시 사용하는 KR 시총 상위 baseline.
 * Gemini 가 최소한의 universe 로 기능을 이어가도록 보장 (사용자 체감 "완료만 뜨고
 * 아무것도 없음" 오인 차단). naver_finance 일일 예산 1000 이 충분히 덮는다.
 * mode 별로 성격에 맞는 부분집합만 노출한다.
 */
const SEED_UNIVERSE: Array<{ code: string; name: string; market: 'KOSPI' | 'KOSDAQ'; tags: Array<'LARGE_MOMENTUM' | 'DEFENSIVE' | 'VALUE' | 'GROWTH_MID'> }> = [
  { code: '005930', name: '삼성전자',     market: 'KOSPI',  tags: ['LARGE_MOMENTUM', 'VALUE'] },
  { code: '000660', name: 'SK하이닉스',   market: 'KOSPI',  tags: ['LARGE_MOMENTUM'] },
  { code: '373220', name: 'LG에너지솔루션', market: 'KOSPI', tags: ['LARGE_MOMENTUM', 'GROWTH_MID'] },
  { code: '207940', name: '삼성바이오로직스', market: 'KOSPI', tags: ['LARGE_MOMENTUM', 'GROWTH_MID'] },
  { code: '005380', name: '현대차',       market: 'KOSPI',  tags: ['LARGE_MOMENTUM', 'VALUE'] },
  { code: '000270', name: '기아',         market: 'KOSPI',  tags: ['LARGE_MOMENTUM', 'VALUE'] },
  { code: '005490', name: 'POSCO홀딩스',  market: 'KOSPI',  tags: ['VALUE'] },
  { code: '035420', name: 'NAVER',        market: 'KOSPI',  tags: ['GROWTH_MID'] },
  { code: '035720', name: '카카오',       market: 'KOSPI',  tags: ['GROWTH_MID'] },
  { code: '051910', name: 'LG화학',       market: 'KOSPI',  tags: ['GROWTH_MID'] },
  { code: '006400', name: '삼성SDI',      market: 'KOSPI',  tags: ['GROWTH_MID'] },
  { code: '068270', name: '셀트리온',     market: 'KOSPI',  tags: ['GROWTH_MID'] },
  { code: '012330', name: '현대모비스',   market: 'KOSPI',  tags: ['VALUE'] },
  { code: '015760', name: '한국전력',     market: 'KOSPI',  tags: ['DEFENSIVE', 'VALUE'] },
  { code: '017670', name: 'SK텔레콤',     market: 'KOSPI',  tags: ['DEFENSIVE'] },
  { code: '033780', name: 'KT&G',         market: 'KOSPI',  tags: ['DEFENSIVE'] },
  { code: '097950', name: 'CJ제일제당',   market: 'KOSPI',  tags: ['DEFENSIVE'] },
  { code: '055550', name: '신한지주',     market: 'KOSPI',  tags: ['VALUE', 'DEFENSIVE'] },
  { code: '105560', name: 'KB금융',       market: 'KOSPI',  tags: ['VALUE', 'DEFENSIVE'] },
  { code: '247540', name: '에코프로비엠', market: 'KOSDAQ', tags: ['GROWTH_MID'] },
  { code: '086520', name: '에코프로',     market: 'KOSDAQ', tags: ['GROWTH_MID'] },
  { code: '091990', name: '셀트리온헬스케어', market: 'KOSDAQ', tags: ['GROWTH_MID'] },
  { code: '196170', name: '알테오젠',     market: 'KOSDAQ', tags: ['GROWTH_MID'] },
  { code: '066970', name: '엘앤에프',     market: 'KOSDAQ', tags: ['GROWTH_MID'] },
];

function buildSeedFallback(mode: AiUniverseMode, limit: number): StockMasterEntry[] {
  const wanted: Array<'LARGE_MOMENTUM' | 'DEFENSIVE' | 'VALUE' | 'GROWTH_MID'> =
    mode === 'BEAR_SCREEN' ? ['DEFENSIVE', 'VALUE']
    : mode === 'QUANT_SCREEN' ? ['VALUE', 'DEFENSIVE', 'GROWTH_MID']
    : mode === 'EARLY_DETECT' ? ['GROWTH_MID', 'LARGE_MOMENTUM']
    : ['LARGE_MOMENTUM', 'GROWTH_MID'];
  const out: StockMasterEntry[] = [];
  for (const tag of wanted) {
    for (const s of SEED_UNIVERSE) {
      if (!s.tags.includes(tag)) continue;
      if (out.some((e) => e.code === s.code)) continue;
      out.push({ code: s.code, name: s.name, market: s.market });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * mode 별 Google Search 쿼리를 실행해 universe 를 발굴한다.
 *
 * @param options.maxCandidates 최종 반환할 최대 종목 수 (기본 12)
 * @param options.enrich Naver Finance 스냅샷을 함께 채울지 (기본 true)
 */
export async function discoverUniverse(
  mode: AiUniverseMode,
  options: { maxCandidates?: number; enrich?: boolean } = {},
): Promise<AiUniverseResult> {
  const maxCandidates = Math.max(1, Math.min(options.maxCandidates ?? 12, 30));
  const enrich = options.enrich ?? true;
  const fetchedAt = Date.now();

  const diag: AiUniverseResult['diagnostics'] = {
    googleQueries: 0,
    googleHits: 0,
    masterMisses: 0,
    enrichSucceeded: 0,
    enrichFailed: 0,
    budgetExceeded: false,
    sourceStatus: 'GOOGLE_OK',
    fallbackUsed: false,
  };

  // 1. 종목 마스터 stale 확인 + 1회 다운로드 (24h TTL)
  if (isMasterStale()) {
    if (tryConsume('krx_master_refresh', 1)) {
      const ok = await refreshKrxStockMaster();
      if (!ok) {
        // 주말엔 krxStockMasterRepo 자체가 단락되므로 정보 가치 0 → debug.
        const logger = isKstWeekend() ? console.debug : console.warn;
        logger('[AiUniverseService] 마스터 갱신 실패 — 기존 디스크 캐시로 진행');
      }
    } else {
      diag.budgetExceeded = true;
    }
  }

  // 2. Google Search 로 후보 발굴
  const queries = MODE_QUERIES[mode];
  const candidatesByCode = new Map<string, { entry: StockMasterEntry; sources: Set<string> }>();
  const nonOkSources = new Set<'NOT_CONFIGURED' | 'BUDGET_EXCEEDED' | 'ERROR'>();
  for (const q of queries) {
    const result = await googleSearch(q, { num: 5 });
    diag.googleQueries++;
    if (result.source === 'BUDGET_EXCEEDED') {
      diag.budgetExceeded = true;
      nonOkSources.add('BUDGET_EXCEEDED');
      break;
    }
    if (result.source === 'NOT_CONFIGURED') {
      nonOkSources.add('NOT_CONFIGURED');
      break;
    }
    if (result.source === 'ERROR') {
      nonOkSources.add('ERROR');
      continue;
    }
    if (result.source !== 'GOOGLE_CSE') continue;
    diag.googleHits += result.items.length;

    for (const item of result.items) {
      const blob = `${item.title} ${item.snippet}`;
      const found = extractStocksFromText(blob, 5);
      if (found.length === 0) {
        diag.masterMisses++;
        continue;
      }
      for (const entry of found) {
        const existing = candidatesByCode.get(entry.code);
        if (existing) {
          existing.sources.add(item.displayLink);
        } else {
          candidatesByCode.set(entry.code, {
            entry,
            sources: new Set([item.displayLink]),
          });
        }
      }
    }
  }

  // 3. 상위 maxCandidates 개로 컷오프 (출처 다양성 우선)
  let ranked = Array.from(candidatesByCode.values())
    .sort((a, b) => b.sources.size - a.sources.size)
    .slice(0, maxCandidates);

  // 3b. Google 결과 0건 → mode 별 seed fallback. Gemini 가 최소 universe 로 동작하도록
  //     보장. 사용자 관점 "버튼 누르면 완료만 뜨고 아무것도 없음" 핵심 원인 차단.
  if (ranked.length === 0) {
    if (nonOkSources.has('NOT_CONFIGURED')) diag.sourceStatus = 'NOT_CONFIGURED';
    else if (nonOkSources.has('BUDGET_EXCEEDED')) diag.sourceStatus = 'BUDGET_EXCEEDED';
    else if (nonOkSources.has('ERROR')) diag.sourceStatus = 'ERROR';
    else diag.sourceStatus = 'NO_MATCHES';

    const seed = buildSeedFallback(mode, maxCandidates);
    if (seed.length > 0) {
      ranked = seed.map((entry) => ({
        entry,
        sources: new Set<string>(['seed:market_leaders']),
      }));
      diag.fallbackUsed = true;
      console.warn(
        `[AiUniverseService] Google 매칭 0건 (status=${diag.sourceStatus}) — seed ${seed.length}건으로 대체`,
      );
    }
  }

  // 4. Naver Finance 로 enrichment (옵션)
  const snapshots = enrich
    ? await fetchNaverStockSnapshots(ranked.map((r) => r.entry.code))
    : new Map<string, NaverStockSnapshot>();

  const candidates: AiUniverseCandidate[] = ranked.map((r) => {
    const snap = snapshots.get(r.entry.code) ?? null;
    if (snap) diag.enrichSucceeded++;
    else if (enrich) diag.enrichFailed++;
    return {
      ...r.entry,
      discoveredFrom: Array.from(r.sources),
      snapshot: snap,
    };
  });

  return { mode, candidates, fetchedAt, diagnostics: diag };
}

/**
 * 단일 종목의 enrichment — 종목코드를 이미 알고 있을 때 Google Search 건너뜀.
 * AI 추천이 watchlist 의 알려진 종목을 점수화할 때 사용.
 */
export async function enrichKnownStock(code: string): Promise<AiUniverseCandidate | null> {
  const entry = getStockByCode(code);
  if (!entry) return null;
  const snapshots = await fetchNaverStockSnapshots([code]);
  return {
    ...entry,
    discoveredFrom: ['known'],
    snapshot: snapshots.get(code) ?? null,
  };
}

// 테스트 전용 — mode → queries 매핑 lock + seed fallback 검증
export const __testOnly = { MODE_QUERIES, SEED_UNIVERSE, buildSeedFallback };
