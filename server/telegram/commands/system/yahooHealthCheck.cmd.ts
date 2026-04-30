// @responsibility Yahoo 데이터 무결성 진단 — 워치리스트 종목 fetchYahooQuote sanity 위반 read-only 검증
//
// ADR-0091 PR-Z4 후속 — 4/28 Railway 로그 sanity 위반 폭주 (101930.KQ +443% / 036930.KQ +114%)
// 재발 / PR-D3-D 우회 케이스 운영자 즉시 진단. 본 PR 은 *진단만* — 캐시 클리어 / 워치리스트 수정
// 별도 PR. KIS 호출 0 (yahooQuoteAdapter SSOT + 5분 캐시 재활용). 200줄 미만.

import { fetchYahooQuote, type YahooQuoteExtended } from '../../../screener/adapters/yahooQuoteAdapter.js';
import { loadWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import { getStockByCode } from '../../../persistence/krxStockMasterRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export const YAHOO_HEALTH_LIMIT = 30;
export const YAHOO_HEALTH_DETAIL_LIMIT = 15;
export const YAHOO_HEALTH_BATCH_SIZE = 5;

export type YahooHealthIssueKind =
  | 'STALE_BASE_CHANGE' | 'STALE_BASE_5D' | 'STALE_BASE_20D' | 'FETCH_FAIL' | 'UNKNOWN';

export interface YahooHealthIssueDetail {
  code: string;
  name: string;
  symbol: string | null;
  kinds: YahooHealthIssueKind[];
  changePercent?: number;
  return5d?: number;
  return20d?: number;
  issues?: Array<'changePercent' | 'return5d' | 'return20d'>;
}

export interface YahooHealthSummary {
  capturedAt: string;
  checkedCount: number;
  okCount: number;
  failCount: number;
  details: YahooHealthIssueDetail[];
}

/** quote.dataQualityIssues field → YahooHealthIssueKind 매핑 SSOT. */
export function classifyIssueKind(
  field: 'changePercent' | 'return5d' | 'return20d',
): YahooHealthIssueKind {
  if (field === 'changePercent') return 'STALE_BASE_CHANGE';
  if (field === 'return5d') return 'STALE_BASE_5D';
  return 'STALE_BASE_20D';
}

/** WatchlistEntry → Yahoo symbol 변환 SSOT. KOSPI .KS / KOSDAQ .KQ / 그 외 null. */
export function resolveYahooSymbolForCode(code: string): string | null {
  const entry = getStockByCode(code);
  if (!entry) return null;
  if (entry.market === 'KOSPI') return `${code}.KS`;
  if (entry.market === 'KOSDAQ') return `${code}.KQ`;
  return null;
}

/** quote 결과를 issue detail 로 분류. quote=null → FETCH_FAIL. 정상 quote → null 반환. */
export function classifyQuote(
  entry: WatchlistEntry,
  quote: YahooQuoteExtended | null,
): YahooHealthIssueDetail | null {
  const symbol = resolveYahooSymbolForCode(entry.code);
  if (!quote) {
    return { code: entry.code, name: entry.name, symbol, kinds: ['FETCH_FAIL'] };
  }
  if (quote.dataQuality !== 'STALE_BASE') return null;
  const issues = quote.dataQualityIssues ?? [];
  const base = {
    code: entry.code, name: entry.name, symbol,
    changePercent: quote.changePercent,
    return5d: quote.return5d,
    return20d: quote.return20d,
  } as const;
  if (issues.length === 0) return { ...base, kinds: ['UNKNOWN'] };
  return { ...base, kinds: issues.map(classifyIssueKind), issues };
}

/** 워치리스트 → fetchYahooQuote (배치) → 결과 분류. KIS 호출 0 (yahoo SSOT 만). */
export async function runYahooHealthCheck(
  options: {
    limit?: number;
    fetcher?: (symbol: string) => Promise<YahooQuoteExtended | null>;
    now?: Date;
  } = {},
): Promise<YahooHealthSummary> {
  const limit = Math.max(1, options.limit ?? YAHOO_HEALTH_LIMIT);
  const fetcher = options.fetcher ?? fetchYahooQuote;
  const capturedAt = (options.now ?? new Date()).toISOString();
  const watchlist = loadWatchlist().slice(0, limit);
  const details: YahooHealthIssueDetail[] = [];
  let okCount = 0;
  for (let i = 0; i < watchlist.length; i += YAHOO_HEALTH_BATCH_SIZE) {
    const batch = watchlist.slice(i, i + YAHOO_HEALTH_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const symbol = resolveYahooSymbolForCode(entry.code);
        const quote = symbol ? await fetcher(symbol) : null;
        return { entry, quote };
      }),
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const detail = classifyQuote(r.value.entry, r.value.quote);
      if (detail === null) okCount += 1;
      else details.push(detail);
    }
  }
  return {
    capturedAt,
    checkedCount: watchlist.length,
    okCount,
    failCount: details.length,
    details,
  };
}

function formatKstHm(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '?';
  return new Date(ms).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatPct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '?';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function formatDetailLine(d: YahooHealthIssueDetail, idx: number): string {
  const sym = d.symbol ?? `${d.code}(?)`;
  const head = `${idx}. ${sym} ${d.name}`;
  if (d.kinds[0] === 'FETCH_FAIL') {
    return `${head}\n   FETCH_FAIL — Yahoo quote 부재 (캐시/네트워크 실패 또는 KONEX/OTHER)`;
  }
  const parts: string[] = [];
  if (d.kinds.includes('STALE_BASE_CHANGE')) parts.push(`changePercent: ${formatPct(d.changePercent)}`);
  if (d.kinds.includes('STALE_BASE_5D')) parts.push(`return5d: ${formatPct(d.return5d)}`);
  if (d.kinds.includes('STALE_BASE_20D')) parts.push(`return20d: ${formatPct(d.return20d)}`);
  if (d.kinds.includes('UNKNOWN')) parts.push('UNKNOWN — STALE_BASE marker 만, issues 부재');
  const reason = '진단: STALE_BASE — base.asOf 30일 초과 / 분할·병합 미반영 / 가격 inversion 의심';
  return `${head}\n   ${parts.join(' / ') || '?'}\n   ${reason}`;
}

export function formatYahooHealthMessage(s: YahooHealthSummary): string {
  const L: string[] = [
    `🩺 Yahoo Health Check (워치리스트 ${s.checkedCount}개)`,
    '━━━━━━━━━━━━━━━━', '',
    `📅 검증 시각: ${formatKstHm(s.capturedAt)} KST`,
    `🔍 검증 종목 수: ${s.checkedCount}개`, '',
    `✅ 정상: ${s.okCount}건`,
    `⚠️ Sanity 위반: ${s.failCount}건`,
  ];
  if (s.failCount > 0) {
    L.push('', '📍 위반 상세:');
    const visible = s.details.slice(0, YAHOO_HEALTH_DETAIL_LIMIT);
    visible.forEach((d, i) => L.push(formatDetailLine(d, i + 1)));
    if (s.details.length > visible.length) {
      L.push(`   외 ${s.details.length - visible.length}건 절삭됨`);
    }
    L.push('', '🎯 권장 조치:',
      '   - yahoo 캐시 강제 재새로고침 (별도 PR)',
      '   - KIS API 가격으로 cross-check',
      '   - 분할/병합 발생 종목 일시 제외');
  } else if (s.checkedCount === 0) {
    L.push('', 'ℹ️ 워치리스트가 비어있어 검증 대상 0건.');
  } else {
    L.push('', '✨ 모든 종목 sanity 통과 — Yahoo 데이터 정상.');
  }
  return L.join('\n');
}

const yahooHealthCheck: TelegramCommand = {
  name: '/yahoo_health',
  aliases: ['/yh'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '워치리스트 종목의 Yahoo 데이터 sanity 검증 — STALE_BASE / 가격 inversion / 분할/병합 미반영 진단 (read-only).',
  usage: '/yahoo_health   — alias: /yh',
  async execute({ reply }) {
    try {
      await reply('🩺 Yahoo Health Check 시작 — 워치리스트 검증 중...');
      const summary = await runYahooHealthCheck();
      await reply(formatYahooHealthMessage(summary));
    } catch (e) {
      console.error('[TelegramBot] /yahoo_health 실패:', e);
      await reply('❌ Yahoo Health Check 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(yahooHealthCheck);
export default yahooHealthCheck;
