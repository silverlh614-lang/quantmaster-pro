/**
 * @responsibility AI 추천 universe 발굴 + enrichment 단일 통로 — KIS/KRX 비의존 (ADR-0011, PR-25-A, PR-37)
 *
 * 절대 규칙 #3 의 AI 추천 전용 신규 통로. PR-37 부터 5-Tier Fallback 사슬:
 * Tier 1 GOOGLE_OK → Tier 2 SNAPSHOT → Tier 3 QUANT (Yahoo) → Tier 4 NAVER →
 * Tier 5 SEED. snapshot 갱신 권한은 Tier 1 만 (ADR-0016). 자동매매 경로는 호출 금지 —
 * signalScanner 등은 그대로 stockService/kisClient 사용.
 */

import { googleSearch } from '../clients/googleSearchClient.js';
import { fetchNaverStockSnapshots, fetchNaverStockSnapshot, type NaverStockSnapshot } from '../clients/naverFinanceClient.js';
import {
  extractStocksFromText,
  getStockByCode,
  isMasterStale,
  type StockMasterEntry,
} from '../persistence/krxStockMasterRepo.js';
import { refreshMultiSourceMaster } from './multiSourceStockMaster.js';
import { tryConsume } from '../persistence/aiCallBudgetRepo.js';
import { isKstWeekend, classifyMarketDataMode } from '../utils/marketClock.js';
import {
  saveAiUniverseSnapshot,
  loadAiUniverseSnapshot,
} from '../persistence/aiUniverseSnapshotRepo.js';
import { generateQuantitativeCandidates } from './quantitativeCandidateGenerator.js';
import type {
  AiUniverseMode as AiUniverseModeType,
  AiUniverseSourceStatus as AiUniverseSourceStatusType,
  AiUniverseDiagnostics,
  MarketDataMode,
  AiUniverseSnapshot,
} from './aiUniverseTypes.js';

export type { MarketDataMode } from './aiUniverseTypes.js';
export type AiUniverseMode = AiUniverseModeType;

export interface AiUniverseCandidate extends StockMasterEntry {
  /** 후보를 발견한 1차 출처 (Google Search 결과 displayLink) */
  discoveredFrom: string[];
  /** Naver Finance 스냅샷 — enrichment 실패 시 null */
  snapshot: NaverStockSnapshot | null;
}

/**
 * universe 응답의 출처 단일 SSOT. 9값 — Tier 1~5 + 진입 실패 사유 4종.
 * PR-25-A 의 6값에서 PR-37 에서 +`FALLBACK_SNAPSHOT`/`FALLBACK_QUANT`/`FALLBACK_NAVER`.
 */
export type AiUniverseSourceStatus = AiUniverseSourceStatusType;

export interface AiUniverseResult {
  mode: AiUniverseMode;
  candidates: AiUniverseCandidate[];
  fetchedAt: number;
  diagnostics: AiUniverseDiagnostics;
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
 * KST 오늘 날짜 (YYYY-MM-DD).
 */
function todayKstDate(now: number = Date.now()): string {
  const kst = new Date(now + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Tier 1 — Google CSE 매칭 시도. universe 발굴 결과 + 메타 반환.
 * candidatesByCode 가 비어있으면 호출자가 nonOkSources 로 sourceStatus 결정.
 */
async function tryTier1Google(
  mode: AiUniverseMode,
  diag: AiUniverseDiagnostics,
): Promise<{
  ranked: Array<{ entry: StockMasterEntry; sources: Set<string> }>;
  nonOkSources: Set<'NOT_CONFIGURED' | 'BUDGET_EXCEEDED' | 'ERROR'>;
}> {
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
        if (existing) existing.sources.add(item.displayLink);
        else candidatesByCode.set(entry.code, { entry, sources: new Set([item.displayLink]) });
      }
    }
  }
  const ranked = Array.from(candidatesByCode.values()).sort((a, b) => b.sources.size - a.sources.size);
  return { ranked, nonOkSources };
}

/**
 * Tier 2 — 디스크 snapshot 적용. 7일 이내 + sourceStatus=GOOGLE_OK 만 사용.
 * snapshot 의 candidates 를 ranked 형태로 변환 (snapshot 은 enrichment 정보를 보존하지 않음 — 호출 시점에 재시도).
 */
function tryTier2Snapshot(
  mode: AiUniverseMode,
  now: number,
): {
  ranked: Array<{ entry: StockMasterEntry; sources: Set<string> }>;
  ageDays: number;
  tradingDate: string | null;
} | null {
  const snap = loadAiUniverseSnapshot(mode, now);
  if (!snap) return null;
  const ageDays = Math.floor((now - snap.generatedAt) / (24 * 60 * 60 * 1000));
  const ranked = snap.candidates.map((c) => ({
    entry: { code: c.code, name: c.name, market: c.market } as StockMasterEntry,
    sources: new Set<string>(c.sources.length > 0 ? c.sources : ['snapshot']),
  }));
  return { ranked, ageDays, tradingDate: snap.tradingDate };
}

/**
 * Tier 3 — Yahoo OHLCV 정량 후보 생성.
 */
async function tryTier3Quant(
  mode: AiUniverseMode,
  maxCandidates: number,
): Promise<{
  ranked: Array<{ entry: StockMasterEntry; sources: Set<string> }>;
  tradingDate: string | null;
} | null> {
  const result = await generateQuantitativeCandidates(mode, { maxCandidates, universeLimit: 50 });
  if (result.stale || result.candidates.length === 0) return null;
  const ranked = result.candidates.map((c) => ({
    entry: { code: c.code, name: c.name, market: c.market } as StockMasterEntry,
    sources: new Set<string>(['quant:yahoo']),
  }));
  return { ranked, tradingDate: result.tradingDateRef };
}

/**
 * Tier 4 — Naver Finance 모바일 단독. SEED_UNIVERSE 의 mode 별 부분집합을
 * Naver 로 enrichment 하여 시총·PER/PBR 만 보강. 뉴스·촉매 정보 없음 명시.
 */
async function tryTier4Naver(
  mode: AiUniverseMode,
  maxCandidates: number,
): Promise<{
  ranked: Array<{ entry: StockMasterEntry; sources: Set<string> }>;
  snapshotMap: Map<string, NaverStockSnapshot>;
} | null> {
  const seed = buildSeedFallback(mode, maxCandidates);
  if (seed.length === 0) return null;
  const snapshotMap = new Map<string, NaverStockSnapshot>();
  // 직렬 호출 — Naver client 가 4-건 동시성을 이미 사용하지만, 여기는 fallback 경로라
  // 부담을 더 낮춰 negative cache 활성 시 즉시 0건으로 끝남.
  for (const entry of seed) {
    const snap = await fetchNaverStockSnapshot(entry.code);
    if (snap) snapshotMap.set(entry.code, snap);
  }
  if (snapshotMap.size === 0) return null;
  const ranked = seed
    .filter((e) => snapshotMap.has(e.code))
    .map((entry) => ({
      entry,
      sources: new Set<string>(['naver:market_leaders']),
    }));
  return { ranked, snapshotMap };
}

/**
 * Tier 5 — 하드코딩 SEED_UNIVERSE 로 마지막 보루.
 */
function tryTier5Seed(
  mode: AiUniverseMode,
  maxCandidates: number,
): Array<{ entry: StockMasterEntry; sources: Set<string> }> {
  const seed = buildSeedFallback(mode, maxCandidates);
  return seed.map((entry) => ({
    entry,
    sources: new Set<string>(['seed:market_leaders']),
  }));
}

/**
 * mode 별 Google Search 쿼리 → 5-Tier Fallback 사슬로 universe 를 발굴한다.
 *
 * Tier 1 GOOGLE_OK → Tier 2 SNAPSHOT(≤7d) → Tier 3 QUANT(Yahoo) → Tier 4 NAVER → Tier 5 SEED.
 * snapshot 갱신은 Tier 1 + candidates ≥ 3 일 때만 (ADR-0016 §4).
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
  const fallbackDisabled = process.env.AI_UNIVERSE_FALLBACK_DISABLED === 'true';

  const diag: AiUniverseDiagnostics = {
    googleQueries: 0,
    googleHits: 0,
    masterMisses: 0,
    enrichSucceeded: 0,
    enrichFailed: 0,
    budgetExceeded: false,
    sourceStatus: 'GOOGLE_OK',
    fallbackUsed: false,
    marketMode: classifyMarketDataMode(),
    tradingDateRef: null,
    snapshotAgeDays: null,
    tierAttempts: [],
  };

  // 0. 종목 마스터 stale 확인 + 멀티소스 폴백 갱신 (ADR-0013, 24h TTL)
  if (isMasterStale()) {
    if (tryConsume('krx_master_refresh', 1)) {
      const result = await refreshMultiSourceMaster();
      if (result.finalSource === 'NONE') {
        const logger = isKstWeekend() ? console.debug : console.warn;
        logger('[AiUniverseService] 마스터 갱신 실패 — 모든 tier 실패, 기존 캐시로 진행');
      } else if (result.usedFallback) {
        console.warn(
          `[AiUniverseService] 마스터 갱신: ${result.finalSource} fallback ` +
          `사용 (${result.finalCount}건). attempts=${result.attempts.map((a) => `${a.source}:${a.ok ? 'OK' : a.reason ?? 'NG'}`).join('→')}`,
        );
      }
    } else {
      diag.budgetExceeded = true;
    }
  }

  let ranked: Array<{ entry: StockMasterEntry; sources: Set<string> }> = [];
  let tier4SnapshotMap: Map<string, NaverStockSnapshot> | null = null;

  // ── Tier 1 ────────────────────────────────────────────────────────────
  const tier1 = await tryTier1Google(mode, diag);
  if (tier1.ranked.length > 0) {
    diag.sourceStatus = 'GOOGLE_OK';
    diag.tierAttempts.push('GOOGLE_OK');
    ranked = tier1.ranked.slice(0, maxCandidates);
    diag.tradingDateRef = todayKstDate(fetchedAt);
  } else {
    // Tier 1 실패 — sourceStatus 후보 결정
    let pendingStatus: AiUniverseSourceStatus;
    if (tier1.nonOkSources.has('NOT_CONFIGURED')) pendingStatus = 'NOT_CONFIGURED';
    else if (tier1.nonOkSources.has('BUDGET_EXCEEDED')) pendingStatus = 'BUDGET_EXCEEDED';
    else if (tier1.nonOkSources.has('ERROR')) pendingStatus = 'ERROR';
    else pendingStatus = 'NO_MATCHES';
    diag.tierAttempts.push(pendingStatus);

    if (fallbackDisabled) {
      // ADR-0011 동작 호환 — Tier 1 실패 시 Tier 5 즉시.
      const seedRanked = tryTier5Seed(mode, maxCandidates);
      if (seedRanked.length > 0) {
        diag.sourceStatus = 'FALLBACK_SEED';
        diag.tierAttempts.push('FALLBACK_SEED');
        diag.fallbackUsed = true;
        diag.marketMode = 'DEGRADED';
        ranked = seedRanked;
      } else {
        diag.sourceStatus = pendingStatus;
      }
    } else {
      // ── Tier 2 ────────────────────────────────────────────────────────
      const tier2 = tryTier2Snapshot(mode, fetchedAt);
      if (tier2 && tier2.ranked.length > 0) {
        diag.sourceStatus = 'FALLBACK_SNAPSHOT';
        diag.tierAttempts.push('FALLBACK_SNAPSHOT');
        diag.fallbackUsed = true;
        diag.snapshotAgeDays = tier2.ageDays;
        diag.tradingDateRef = tier2.tradingDate;
        ranked = tier2.ranked.slice(0, maxCandidates);
      } else {
        // ── Tier 3 ────────────────────────────────────────────────────
        const tier3 = await tryTier3Quant(mode, maxCandidates);
        if (tier3 && tier3.ranked.length > 0) {
          diag.sourceStatus = 'FALLBACK_QUANT';
          diag.tierAttempts.push('FALLBACK_QUANT');
          diag.fallbackUsed = true;
          diag.marketMode = 'DEGRADED';
          diag.tradingDateRef = tier3.tradingDate;
          ranked = tier3.ranked.slice(0, maxCandidates);
        } else {
          // ── Tier 4 ──────────────────────────────────────────────────
          const tier4 = await tryTier4Naver(mode, maxCandidates);
          if (tier4 && tier4.ranked.length > 0) {
            diag.sourceStatus = 'FALLBACK_NAVER';
            diag.tierAttempts.push('FALLBACK_NAVER');
            diag.fallbackUsed = true;
            diag.marketMode = 'DEGRADED';
            ranked = tier4.ranked.slice(0, maxCandidates);
            tier4SnapshotMap = tier4.snapshotMap;
          } else {
            // ── Tier 5 ────────────────────────────────────────────────
            const seedRanked = tryTier5Seed(mode, maxCandidates);
            if (seedRanked.length > 0) {
              diag.sourceStatus = 'FALLBACK_SEED';
              diag.tierAttempts.push('FALLBACK_SEED');
              diag.fallbackUsed = true;
              diag.marketMode = 'DEGRADED';
              ranked = seedRanked;
              console.warn(
                `[AiUniverseService] Tier 1~4 실패 (status=${pendingStatus}) — seed ${seedRanked.length}건 사용`,
              );
            } else {
              diag.sourceStatus = pendingStatus;
            }
          }
        }
      }
    }
  }

  // 4. Naver Finance enrichment — Tier 4 는 이미 snapshot 보유, 그 외는 새로 호출.
  let snapshots: Map<string, NaverStockSnapshot>;
  if (tier4SnapshotMap) {
    snapshots = tier4SnapshotMap;
  } else if (enrich && ranked.length > 0) {
    snapshots = await fetchNaverStockSnapshots(ranked.map((r) => r.entry.code));
  } else {
    snapshots = new Map<string, NaverStockSnapshot>();
  }

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

  // snapshot 갱신 — Tier 1 + candidates ≥ 3 일 때만 (ADR-0016 §4)
  if (diag.sourceStatus === 'GOOGLE_OK' && candidates.length >= 3) {
    const snapshot: AiUniverseSnapshot = {
      mode,
      generatedAt: fetchedAt,
      tradingDate: diag.tradingDateRef ?? todayKstDate(fetchedAt),
      marketMode: diag.marketMode,
      sourceStatus: 'GOOGLE_OK',
      candidates: candidates.map((c) => ({
        code: c.code,
        name: c.name,
        market: (c.market === 'KOSPI' || c.market === 'KOSDAQ') ? c.market : 'KOSPI',
        sources: c.discoveredFrom,
      })),
      diagnostics: diag,
    };
    saveAiUniverseSnapshot(mode, snapshot);
  }

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
