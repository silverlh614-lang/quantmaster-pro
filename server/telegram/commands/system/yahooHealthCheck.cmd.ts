// @responsibility Yahoo 데이터 무결성 진단 — 워치리스트 종목 fetchYahooQuote sanity 위반 검증 + KIS changePercent 복구 + historical refresh
//
// ADR-0091 PR-Z4 후속. PR-549: KIS intraday 로 changePercent 단일 위반 복구.
// PR-550: return5d/return20d stale 은 cache-busting Yahoo historical refresh 로 재검증한다.
// 그래도 stale이면 0% fallback 금지 — momentum/RS 입력에서 제외한다.

import { fetchYahooQuote, type YahooQuoteExtended } from '../../../screener/adapters/yahooQuoteAdapter.js';
import {
  recoverYahooStaleQuoteWithKis,
  type YahooStaleRecoveryStatus,
} from '../../../screener/adapters/yahooStaleRecovery.js';
import {
  refreshYahooHistoricalReturns,
  formatYahooHistoricalRefresh,
} from '../../../screener/adapters/yahooHistoricalRefresh.js';
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
  recoveryStatus?: YahooStaleRecoveryStatus | 'HISTORICAL_REFRESH_RECOVERED' | 'HISTORICAL_REFRESH_FAILED';
  recoveryNote?: string;
}

export interface YahooHealthSummary {
  capturedAt: string;
  checkedCount: number;
  okCount: number;
  failCount: number;
  recoveredCount: number;
  historicalRefreshRecoveredCount: number;
  historicalRefreshFailedCount: number;
  staleUnrecoveredCount: number;
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

async function tryHistoricalRefresh(detail: YahooHealthIssueDetail): Promise<YahooHealthIssueDetail> {
  if (!detail.symbol) return detail;
  const hasHistoricalIssue = detail.kinds.includes('STALE_BASE_5D') || detail.kinds.includes('STALE_BASE_20D');
  if (!hasHistoricalIssue) return detail;
  const refresh = await refreshYahooHistoricalReturns(detail.symbol);
  if (refresh.ok && refresh.return20d !== null) {
    return {
      ...detail,
      kinds: [],
      recoveryStatus: 'HISTORICAL_REFRESH_RECOVERED',
      recoveryNote: formatYahooHistoricalRefresh(refresh),
      changePercent: refresh.changePercent ?? detail.changePercent,
      return5d: refresh.return5d ?? detail.return5d,
      return20d: refresh.return20d,
    };
  }
  return {
    ...detail,
    recoveryStatus: 'HISTORICAL_REFRESH_FAILED',
    recoveryNote: formatYahooHistoricalRefresh(refresh),
  };
}

/** 워치리스트 → fetchYahooQuote (배치) → 결과 분류 + KIS/historical 복구. */
export async function runYahooHealthCheck(
  options: {
    limit?: number;
    fetcher?: (symbol: string) => Promise<YahooQuoteExtended | null>;
    now?: Date;
    recover?: boolean;
    historicalRefresh?: boolean;
  } = {},
): Promise<YahooHealthSummary> {
  const limit = Math.max(1, options.limit ?? YAHOO_HEALTH_LIMIT);
  const fetcher = options.fetcher ?? fetchYahooQuote;
  const capturedAt = (options.now ?? new Date()).toISOString();
  const watchlist = loadWatchlist().slice(0, limit);
  const details: YahooHealthIssueDetail[] = [];
  let okCount = 0;
  let recoveredCount = 0;
  let historicalRefreshRecoveredCount = 0;
  let historicalRefreshFailedCount = 0;
  let staleUnrecoveredCount = 0;

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
      const { entry, quote } = r.value;
      if (options.recover && quote?.dataQuality === 'STALE_BASE') {
        const recovery = await recoverYahooStaleQuoteWithKis(entry.code, quote);
        if (recovery.status === 'KIS_CHANGE_PERCENT_RECOVERED') {
          okCount += 1;
          recoveredCount += 1;
          details.push({
            code: entry.code,
            name: entry.name,
            symbol: resolveYahooSymbolForCode(entry.code),
            kinds: [],
            recoveryStatus: recovery.status,
            recoveryNote: recovery.note,
            changePercent: recovery.quote?.changePercent,
            return5d: recovery.quote?.return5d,
            return20d: recovery.quote?.return20d,
          });
          continue;
        }

        let detail = classifyQuote(entry, quote);
        if (detail && options.historicalRefresh) {
          detail = await tryHistoricalRefresh(detail);
          if (detail.recoveryStatus === 'HISTORICAL_REFRESH_RECOVERED') {
            okCount += 1;
            historicalRefreshRecoveredCount += 1;
            details.push(detail);
            continue;
          }
          if (detail.recoveryStatus === 'HISTORICAL_REFRESH_FAILED') historicalRefreshFailedCount += 1;
        }
        if (recovery.status === 'STALE_UNRECOVERED') staleUnrecoveredCount += 1;
        if (detail) details.push({ ...detail, recoveryStatus: detail.recoveryStatus ?? recovery.status, recoveryNote: detail.recoveryNote ?? recovery.note });
        continue;
      }

      const detail = classifyQuote(entry, quote);
      if (detail === null) okCount += 1;
      else {
        if (detail.kinds.some((k) => k !== 'FETCH_FAIL')) staleUnrecoveredCount += 1;
        details.push(detail);
      }
    }
  }
  return {
    capturedAt,
    checkedCount: watchlist.length,
    okCount,
    failCount: details.filter((d) => d.kinds.length > 0).length,
    recoveredCount,
    historicalRefreshRecoveredCount,
    historicalRefreshFailedCount,
    staleUnrecoveredCount,
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
  if (d.recoveryStatus === 'KIS_CHANGE_PERCENT_RECOVERED') {
    return `${head}\n   ✅ KIS_FALLBACK_RECOVERED — changePercent ${formatPct(d.changePercent)}\n   ${d.recoveryNote ?? ''}`;
  }
  if (d.recoveryStatus === 'HISTORICAL_REFRESH_RECOVERED') {
    return `${head}\n   ✅ HISTORICAL_REFRESH_RECOVERED — return20d ${formatPct(d.return20d)}\n   ${d.recoveryNote ?? ''}`;
  }
  if (d.kinds[0] === 'FETCH_FAIL') {
    return `${head}\n   FETCH_FAIL — Yahoo quote 부재 (캐시/네트워크 실패 또는 KONEX/OTHER)`;
  }
  const parts: string[] = [];
  if (d.kinds.includes('STALE_BASE_CHANGE')) parts.push(`changePercent: ${formatPct(d.changePercent)}`);
  if (d.kinds.includes('STALE_BASE_5D')) parts.push(`return5d: ${formatPct(d.return5d)}`);
  if (d.kinds.includes('STALE_BASE_20D')) parts.push(`return20d: ${formatPct(d.return20d)}`);
  if (d.kinds.includes('UNKNOWN')) parts.push('UNKNOWN — STALE_BASE marker 만, issues 부재');
  const reason = '진단: DATA_STALE_PRICE — Yahoo base.asOf 만료 / 분할·병합 미반영 / 가격 inversion 의심';
  return `${head}\n   ${parts.join(' / ') || '?'}\n   ${reason}${d.recoveryNote ? `\n   refresh: ${d.recoveryNote}` : ''}`;
}

export function formatYahooHealthMessage(s: YahooHealthSummary): string {
  const L: string[] = [
    `🩺 Yahoo Health Check (워치리스트 ${s.checkedCount}개)`,
    '━━━━━━━━━━━━━━━━', '',
    `📅 검증 시각: ${formatKstHm(s.capturedAt)} KST`,
    `🔍 검증 종목 수: ${s.checkedCount}개`, '',
    `✅ 정상: ${s.okCount}건`,
    `🟢 KIS 복구: ${s.recoveredCount}건`,
    `🔄 History refresh 복구: ${s.historicalRefreshRecoveredCount}건`,
    `❌ History refresh 실패: ${s.historicalRefreshFailedCount}건`,
    `⚠️ Sanity 위반: ${s.failCount}건`,
    `🧊 DATA_STALE_PRICE: ${s.staleUnrecoveredCount}건`,
  ];
  if (s.details.length > 0) {
    L.push('', '📍 상세:');
    const visible = s.details.slice(0, YAHOO_HEALTH_DETAIL_LIMIT);
    visible.forEach((d, i) => L.push(formatDetailLine(d, i + 1)));
    if (s.details.length > visible.length) {
      L.push(`   외 ${s.details.length - visible.length}건 절삭됨`);
    }
    L.push('', '🎯 권장 조치:',
      '   - changePercent 단일 stale: KIS fallback 회복 가능',
      '   - return5d/return20d stale: Yahoo history refresh 후에도 실패하면 momentum/RS 제외',
      '   - 반복 종목은 Yahoo symbol / corporate action / 캐시 경로 점검');
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
    '워치리스트 종목의 Yahoo 데이터 sanity 검증 — STALE_BASE / KIS fallback / historical refresh / DATA_STALE_PRICE 진단.',
  usage: '/yahoo_health   — alias: /yh',
  async execute({ reply }) {
    try {
      await reply('🩺 Yahoo Health Check 시작 — 워치리스트 검증 + KIS fallback + history refresh 진단 중...');
      const summary = await runYahooHealthCheck({ recover: true, historicalRefresh: true });
      await reply(formatYahooHealthMessage(summary));
    } catch (e) {
      console.error('[TelegramBot] /yahoo_health 실패:', e);
      await reply('❌ Yahoo Health Check 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(yahooHealthCheck);
export default yahooHealthCheck;
