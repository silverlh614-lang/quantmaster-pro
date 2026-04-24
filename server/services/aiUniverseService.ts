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

export type AiUniverseMode = 'MOMENTUM' | 'QUANT_SCREEN' | 'BEAR_SCREEN' | 'EARLY_DETECT';

export interface AiUniverseCandidate extends StockMasterEntry {
  /** 후보를 발견한 1차 출처 (Google Search 결과 displayLink) */
  discoveredFrom: string[];
  /** Naver Finance 스냅샷 — enrichment 실패 시 null */
  snapshot: NaverStockSnapshot | null;
}

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
  };
}

const MODE_QUERIES: Record<AiUniverseMode, string[]> = {
  MOMENTUM: ['오늘 급등주', '거래량 급증 종목'],
  EARLY_DETECT: ['거래량 마름 후 돌파', '신고가 돌파 종목'],
  QUANT_SCREEN: ['저PER 저PBR 우량주', '실적 개선주'],
  BEAR_SCREEN: ['약세장 방어주', '고배당 우량주'],
};

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

  const diag = {
    googleQueries: 0,
    googleHits: 0,
    masterMisses: 0,
    enrichSucceeded: 0,
    enrichFailed: 0,
    budgetExceeded: false,
  };

  // 1. 종목 마스터 stale 확인 + 1회 다운로드 (24h TTL)
  if (isMasterStale()) {
    if (tryConsume('krx_master_refresh', 1)) {
      const ok = await refreshKrxStockMaster();
      if (!ok) console.warn('[AiUniverseService] 마스터 갱신 실패 — 기존 디스크 캐시로 진행');
    } else {
      diag.budgetExceeded = true;
    }
  }

  // 2. Google Search 로 후보 발굴
  const queries = MODE_QUERIES[mode];
  const candidatesByCode = new Map<string, { entry: StockMasterEntry; sources: Set<string> }>();
  for (const q of queries) {
    const result = await googleSearch(q, { num: 5 });
    diag.googleQueries++;
    if (result.source === 'BUDGET_EXCEEDED') {
      diag.budgetExceeded = true;
      break;
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
  const ranked = Array.from(candidatesByCode.values())
    .sort((a, b) => b.sources.size - a.sources.size)
    .slice(0, maxCandidates);

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

// 테스트 전용 — mode → queries 매핑 lock
export const __testOnly = { MODE_QUERIES };
