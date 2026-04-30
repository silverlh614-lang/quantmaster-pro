// @responsibility 직전 7일 buy/sell 추이 + PR #467 머지 후 신규 trade entryConditionScores 검증
import {
  loadShadowTrades,
  type ServerShadowTrade,
} from '../../../persistence/shadowTradeRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/** PR #467 (PR-1+2+3+4) main 머지 시각 — git log 3f0636b 확인. */
export const ATTRIBUTION_WIRING_MERGED_AT_ISO = '2026-04-30T17:58:38.000Z';

/** KST(UTC+9) 일자 'YYYY-MM-DD' 추출. 잘못된 ISO → null. */
export function isoToKstDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

export interface DailyCount { date: string; buy: number; sell: number; }

/** signalTime → buy / SELL CONFIRMED fill.timestamp → sell 일별 집계 (KST). */
export function summarizeDailyCounts(
  trades: ServerShadowTrade[],
  windowDays: number,
  now: Date,
): DailyCount[] {
  const todayKst = isoToKstDate(now.toISOString())!;
  const todayMs = new Date(`${todayKst}T00:00:00+09:00`).getTime();
  const dates: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = isoToKstDate(new Date(todayMs - i * 86_400_000).toISOString());
    if (d) dates.push(d);
  }
  const map = new Map<string, DailyCount>();
  for (const d of dates) map.set(d, { date: d, buy: 0, sell: 0 });
  for (const t of trades) {
    const buyDay = isoToKstDate(t.signalTime);
    if (buyDay && map.has(buyDay)) map.get(buyDay)!.buy += 1;
    for (const f of t.fills ?? []) {
      if (f.type !== 'SELL' || (f.status && f.status !== 'CONFIRMED')) continue;
      const day = isoToKstDate(f.timestamp);
      if (day && map.has(day)) map.get(day)!.sell += 1;
    }
  }
  return dates.map((d) => map.get(d)!);
}

export interface PostMergeStats {
  newBuyCount: number;
  newSellCount: number;
  withFullBaseline: ServerShadowTrade[];
  withZeroBaseline: ServerShadowTrade[];
}

/** PR #467 머지 시각 이후 신규 trade 분류 — 27/27 vs 0/27. */
export function classifyPostMergeTrades(
  trades: ServerShadowTrade[],
  mergedAtIso: string,
): PostMergeStats {
  const mergedMs = new Date(mergedAtIso).getTime();
  const stats: PostMergeStats = {
    newBuyCount: 0, newSellCount: 0,
    withFullBaseline: [], withZeroBaseline: [],
  };
  for (const t of trades) {
    const signalMs = new Date(t.signalTime).getTime();
    if (!Number.isFinite(signalMs) || signalMs < mergedMs) continue;
    stats.newBuyCount += 1;
    const count = t.entryConditionScores ? Object.keys(t.entryConditionScores).length : 0;
    if (count === 27) stats.withFullBaseline.push(t);
    else if (count === 0) stats.withZeroBaseline.push(t);
    for (const f of t.fills ?? []) {
      if (f.type !== 'SELL' || (f.status && f.status !== 'CONFIRMED')) continue;
      const sellMs = new Date(f.timestamp).getTime();
      if (Number.isFinite(sellMs) && sellMs >= mergedMs) stats.newSellCount += 1;
    }
  }
  return stats;
}

function tradeLine(t: ServerShadowTrade): string {
  return `   ${isoToKstDate(t.signalTime) ?? '?'} ${t.stockCode} ${t.stockName ?? ''}`.trimEnd();
}

export function formatRecentTradesAuditMessage(
  daily: DailyCount[],
  pm: PostMergeStats,
  mergedAtIso: string,
): string {
  const L: string[] = [];
  L.push(`📊 Recent Trades Audit (last ${daily.length} days)`);
  L.push('━━━━━━━━━━━━━━━━', '', '📅 일별 buy/sell 카운트:');
  for (const d of daily) L.push(`   ${d.date}: buy=${d.buy}  sell=${d.sell}`);
  L.push('', '📋 PR #467 (PR-1/2/3/4) 머지 후 신규 trade:');
  L.push(`   머지 시점: ${mergedAtIso} (= 2026-05-01 02:58 KST)`);
  L.push(`   이후 신규 buy: ${pm.newBuyCount}건`);
  L.push(`   이후 신규 sell: ${pm.newSellCount}건`);
  L.push('', '🎯 진단:');
  if (pm.newBuyCount === 0) {
    L.push('   📌 신규 매수 0건 — 다음 거래일 09:00 KST 이후 자연 발생 대기.');
    L.push('   원인: SHADOW 게이트 / 27조건 / FOMC / VIX / R6_DEFENSE 차단 의심.');
  } else if (pm.withZeroBaseline.length === 0) {
    L.push('   ✅ wiring 정상 — 신규 trade 모두 entryConditionScores 27/27.');
    L.push('   PR-1/2/3/4 정상 작동 확정. attribution baseline 영속 활성.');
  } else {
    L.push('   🚨 wiring 누수 — 신규 trade 중 0/27 baseline 발견.');
    L.push('   누락된 buy 호출자 추적 필요 (perSymbolEvaluation 외 경로 의심).');
  }
  if (pm.withFullBaseline.length > 0) {
    L.push('', `📍 27/27 영속된 신규 trade (${pm.withFullBaseline.length}건):`);
    for (const t of pm.withFullBaseline.slice(0, 10)) L.push(tradeLine(t));
  }
  if (pm.withZeroBaseline.length > 0) {
    L.push('', `📍 0/27 baseline 신규 trade (${pm.withZeroBaseline.length}건 — 누락):`);
    for (const t of pm.withZeroBaseline.slice(0, 10)) L.push(tradeLine(t));
  }
  return L.join('\n');
}

const recentTradesAudit: TelegramCommand = {
  name: '/recent_trades_audit',
  aliases: ['/rta'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '직전 7일 buy/sell 추이 + PR #467 머지 후 신규 trade entryConditionScores 검증 (read-only).',
  usage: '/recent_trades_audit   — alias: /rta',
  async execute({ reply }) {
    try {
      const trades = loadShadowTrades();
      const now = new Date();
      const daily = summarizeDailyCounts(trades, 7, now);
      const pm = classifyPostMergeTrades(trades, ATTRIBUTION_WIRING_MERGED_AT_ISO);
      await reply(formatRecentTradesAuditMessage(daily, pm, ATTRIBUTION_WIRING_MERGED_AT_ISO));
    } catch (e) {
      console.error('[TelegramBot] /recent_trades_audit 실패:', e);
      await reply('❌ Recent trades audit 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(recentTradesAudit);
export default recentTradesAudit;
