/**
 * @responsibility 수급 데이터 채널의 source/freshness/coverage/zero-filled 의심을 read-only로 진단한다.
 * PR-574~584: fake-zero/accepted-empty/provider-mismatch/unwired-collection 상태를 neutral 로 격리하고 investor-flow policy route 를 표시한다.
 */

import fs from 'fs';
import { fetchKisMarketProgramTrade, fetchKisStockProgramTrade } from '../../../clients/kisClient/index.js';
import { diagnoseKisMarketProgramRaw, diagnoseKisStockProgramRaw, formatKisRawSupplyDiagnostic } from '../../../clients/kisClient/supplyDiagnostics.js';
import { FSS_RECORDS_FILE, MACRO_STATE_FILE } from '../../../persistence/paths.js';
import { loadForeignerRatioSeries } from '../../../persistence/foreignerRatioRepo.js';
import { loadWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { MacroState } from '../../../persistence/macroStateRepo.js';
import { fetchInvestorFlowWithPolicy, summarizeInvestorFlowAttempts } from '../../../supply/investorFlowRouter.js';
import { getSupplyProviderPolicy, type SupplyProvider, type SupplySignalKey } from '../../../supply/supplyProviderPolicy.js';
import { fetchKrxShortSelling } from '../../../trading/marketDataRefresh.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export const SUPPLY_HEALTH_CACHE_TTL_MS = 30_000;
const TOP_N = 10;
const KIS_STALE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;
const TWO_DAYS = 2;
const FSS_STALE_DAYS = 4;
const SHORT_STALE_DAYS = 2;
const ZERO_FILLED_MIN_COUNT = 3;
const ZERO_FILLED_RATIO_WARN = 0.8;

type Marker = 'OK' | 'STALE' | 'DEGRADED' | 'MISSING' | 'NEUTRAL' | 'N/A';
interface ChannelStatus { key: SupplySignalKey; title: string; marker: Marker; lines: string[]; riskReason?: string; zeroSuspect?: { count: number; total: number } }
interface FssRecordRow { date: string; passiveNetBuy: number; activeNetBuy: number }

let cache: { message: string; builtAt: number } | null = null;

function markerIcon(marker: Marker): string {
  if (marker === 'OK') return '🟢';
  if (marker === 'STALE') return '🟡';
  if (marker === 'DEGRADED') return '🟠';
  if (marker === 'MISSING') return '🔴';
  return '⚪';
}
function readJsonFile<T>(file: string): T | null {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) as T : null; } catch { return null; }
}
function loadMacroStateReadOnly(): MacroState | null { return readJsonFile<MacroState>(MACRO_STATE_FILE); }
function loadFssRecordsReadOnly(): FssRecordRow[] { const rows = readJsonFile<FssRecordRow[]>(FSS_RECORDS_FILE); return Array.isArray(rows) ? rows : []; }
function selectTopWatchlist(limit = TOP_N): WatchlistEntry[] {
  return [...loadWatchlist()].sort((a, b) => Number((b as any).stage2Score ?? 0) - Number((a as any).stage2Score ?? 0)).slice(0, limit);
}
function formatTargetLine(totalWatchlist: number, picked: number): string {
  return totalWatchlist >= TOP_N ? `검증 종목: stage2Score 상위 10개 중 ${picked}개` : `검증 종목: stage2Score 상위 ${picked}개`;
}
function elapsedMs(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null; const ts = Date.parse(iso); return Number.isFinite(ts) ? Math.max(0, nowMs - ts) : null;
}
function formatAgo(ms: number | null): string {
  if (ms === null) return 'N/A';
  const sec = Math.floor(ms / 1000); if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60); if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}일 전`;
}
function todayKstDate(nowMs: number): string { return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10); }
function elapsedDays(date: string | null | undefined, nowMs: number): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = Date.parse(`${todayKstDate(nowMs)}T00:00:00Z`);
  const then = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(today) && Number.isFinite(then) ? Math.max(0, Math.round((today - then) / DAY_MS)) : null;
}
function isZeroFilledSuspicious(count: number, total: number): boolean { return total > 0 && count >= ZERO_FILLED_MIN_COUNT && count / total >= ZERO_FILLED_RATIO_WARN; }
function zeroWarn(count: number, total: number): string { return `${count}/${total}${isZeroFilledSuspicious(count, total) ? ' ⚠️' : ''}`; }
function formatEokwon(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) < 0.05) return '0억';
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}억`;
}
function zeroFilledRiskReason(count: number, total: number): string { return `zero-filled 의심 ${count}/${total} — KIS success지만 실데이터 신뢰 불가`; }
function firstTargetCode(targets: WatchlistEntry[]): string | null { return targets[0]?.code ?? null; }
function compactProviderName(provider: SupplyProvider): string {
  const names: Partial<Record<SupplyProvider, string>> = {
    KIS_API: 'KIS', KRX_INVESTOR_FLOW: 'KRX', KRX_MARKET_PROGRAM: 'KRX', KRX_SHORT_SELLING: 'KRX', KRX_MARGIN_BALANCE: 'KRX',
    NAVER_INVESTOR_TREND: 'NAVER', NAVER_FOREIGNER_RATIO: 'NAVER', NAVER_SHORT_SELLING: 'NAVER', FSS_RECORDS: 'FSS',
    ECOS_API: 'ECOS', FINANCIAL_INVESTMENT_ASSOCIATION: '금투협', CACHE: 'CACHE', MANUAL_BACKFILL: 'BACKFILL',
  };
  return names[provider] ?? provider;
}
function compactProviderRoute(key: SupplySignalKey): string {
  const p = getSupplyProviderPolicy(key);
  const primary = p.primary.map(compactProviderName).join('>') || 'NONE';
  const fallback = p.fallback.length > 0 ? p.fallback.map(compactProviderName).join('>') : 'NONE';
  const diagnostic = p.diagnostic.length > 0 ? p.diagnostic.map(compactProviderName).join('>') : 'NONE';
  return `route: ${primary} | fb=${fallback} | diag=${diagnostic} | scoring=${p.scoringMode}`;
}
function renderInvestorFlowDecision(marker: Marker): string {
  return marker === 'OK' ? '판정: OK — policy provider 실데이터 사용 가능' : '판정: KRX/NAVER/CACHE 미연결 — KIS는 진단용, 점수 제외';
}
function isAcceptedEmptyRaw(rawDiagLine: string): boolean { return rawDiagLine.includes('rawDiag=MARKET_PROGRAM') && rawDiagLine.includes('zeroReason=ACCEPTED_EMPTY'); }

async function diagnoseInvestorFlow(targets: WatchlistEntry[]): Promise<ChannelStatus> {
  let success = 0, zero = 0;
  const attemptSummaries: string[] = [];
  let source: SupplyProvider | null = null;
  for (const stock of targets) {
    const routed = await fetchInvestorFlowWithPolicy(stock.code);
    if (attemptSummaries.length < 3) attemptSummaries.push(`${stock.code}:${summarizeInvestorFlowAttempts(routed.attempts)}`);
    if (!routed.data) continue;
    success++;
    source = routed.source;
    if (routed.data.foreignNetBuy + routed.data.institutionalNetBuy === 0) zero++;
  }
  const total = targets.length;
  const zeroSuspicious = isZeroFilledSuspicious(zero, total);
  const marker: Marker = total === 0 ? 'MISSING' : success === 0 ? 'NEUTRAL' : zeroSuspicious ? 'DEGRADED' : 'OK';
  return {
    key: 'investorFlow', title: '기관/외인 수급', marker,
    riskReason: zeroSuspicious ? zeroFilledRiskReason(zero, total) : undefined,
    zeroSuspect: { count: zero, total },
    lines: [
      `source: ${source ?? 'POLICY_ROUTER'}`,
      `status: ${marker === 'OK' ? 'OK' : 'PROVIDER_MISMATCH'}`,
      `success: ${success}/${total}`,
      'stale: 0',
      `zero-filled 의심: ${zeroWarn(zero, total)}`,
      `providerTried: ${attemptSummaries[0] ?? 'N/A'}`,
      ...(attemptSummaries.length > 1 ? [`providerTried2: ${attemptSummaries[1]}`] : []),
      renderInvestorFlowDecision(marker),
      '대체: KRX / NAVER / CACHE',
      '상세: /investor_flow 예정',
    ],
  };
}

async function diagnoseStockProgram(targets: WatchlistEntry[]): Promise<ChannelStatus> {
  let success = 0, zero = 0;
  for (const stock of targets) {
    try { const data = await fetchKisStockProgramTrade(stock.code, 'MEDIUM'); if (!data) continue; success++; if (data.programNetBuyAmount === 0) zero++; } catch {}
  }
  const total = targets.length, missing = Math.max(0, total - success);
  const zeroSuspicious = isZeroFilledSuspicious(zero, total);
  const marker: Marker = total === 0 || success === 0 ? 'MISSING' : zeroSuspicious ? 'DEGRADED' : 'OK';
  const rawDiagLine = zeroSuspicious && firstTargetCode(targets) ? formatKisRawSupplyDiagnostic(await diagnoseKisStockProgramRaw(firstTargetCode(targets) as string, 'MEDIUM')) : null;
  return {
    key: 'stockProgram', title: '종목 프로그램매매', marker,
    riskReason: marker === 'MISSING' ? '조회 성공 0건' : zeroSuspicious ? zeroFilledRiskReason(zero, total) : missing > 0 ? `missing ${missing}` : undefined,
    zeroSuspect: { count: zero, total },
    lines: ['source: KIS_API', `success: ${success}/${total}`, `missing: ${missing}`, `zero-filled 의심: ${zeroWarn(zero, total)}`, zeroSuspicious ? '판정: DEGRADED — 프로그램 수급 점수 입력 제외 권장' : '판정: OK', ...(rawDiagLine ? [rawDiagLine] : []), '상세: /program_today'],
  };
}

function renderAcceptedEmptyMarketProgram(): ChannelStatus {
  return { key: 'marketProgram', title: '시장 프로그램매매', marker: 'NEUTRAL', lines: ['source: KIS_API', 'status: ACCEPTED_EMPTY', 'latest: N/A', 'updated: N/A', '판정: KIS 정상 수락, output 없음 — 점수 제외', 'rawDiag: hidden (/program_market raw 예정)', '상세: /program_market'] };
}
async function diagnoseMarketProgram(macro: MacroState | null, nowMs: number): Promise<ChannelStatus> {
  const rawDiagLine = formatKisRawSupplyDiagnostic(await diagnoseKisMarketProgramRaw('HIGH'));
  if (isAcceptedEmptyRaw(rawDiagLine)) return renderAcceptedEmptyMarketProgram();
  const macroAge = elapsedMs(macro?.programFetchedAt, nowMs);
  if (macro?.programSource === 'KIS_API' && macro.programNetBuyAmount !== undefined && macroAge !== null && macroAge <= KIS_STALE_MS) {
    return { key: 'marketProgram', title: '시장 프로그램매매', marker: 'OK', lines: ['source: KIS_API', `latest: ${formatEokwon(macro.programNetBuyAmount)}`, `updated: ${formatAgo(macroAge)}`, rawDiagLine, '상세: /program_market'] };
  }
  try {
    const live = await fetchKisMarketProgramTrade('MEDIUM');
    if (live) return { key: 'marketProgram', title: '시장 프로그램매매', marker: 'OK', lines: ['source: KIS_API', `latest: ${formatEokwon(live.programNetBuyAmount / 100_000_000)}`, 'updated: 0s ago', rawDiagLine, '상세: /program_market'] };
  } catch {}
  if (macro?.programSource === 'KIS_API' && macro.programNetBuyAmount !== undefined) {
    const stale = macroAge !== null && macroAge > KIS_STALE_MS;
    return { key: 'marketProgram', title: '시장 프로그램매매', marker: stale ? 'STALE' : 'MISSING', riskReason: stale ? `updated ${formatAgo(macroAge)}` : 'updatedAt 없음', lines: ['source: KIS_API', `latest: ${formatEokwon(macro.programNetBuyAmount)}`, `updated: ${formatAgo(macroAge)}`, rawDiagLine, '상세: /program_market'] };
  }
  return { key: 'marketProgram', title: '시장 프로그램매매', marker: 'MISSING', riskReason: 'KIS/macroState 결손', lines: ['source: KIS_API', 'latest: N/A', 'updated: N/A', rawDiagLine, '상세: /program_market'] };
}

function diagnoseFss(macro: MacroState | null, nowMs: number): ChannelStatus {
  const rows = loadFssRecordsReadOnly().sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) {
    return { key: 'fssPassiveActive', title: 'FSS Passive/Active', marker: 'NEUTRAL', lines: ['source: FSS_RECORDS', 'status: COLLECTION_EMPTY', `passiveActiveBoth: ${macro?.passiveActiveBoth === undefined ? 'N/A' : String(macro.passiveActiveBoth)}`, 'updated: N/A', '판정: FSS 레코드 미누적 — 점수 제외', '수집: fssRecords / macroState wiring / backfill', '상세: /fss_status'] };
  }
  const latest = rows[rows.length - 1].date;
  const days = elapsedDays(latest, nowMs);
  const marker: Marker = days !== null && days > FSS_STALE_DAYS ? 'STALE' : 'OK';
  return { key: 'fssPassiveActive', title: 'FSS Passive/Active', marker, riskReason: marker === 'STALE' ? `${days}영업일 stale` : undefined, lines: [`status: ${marker}`, `passiveActiveBoth: ${macro?.passiveActiveBoth === undefined ? 'N/A' : String(macro.passiveActiveBoth)}`, `updated: ${days === null ? 'N/A' : `${days}영업일 전`}`, '상세: /fss_status'] };
}

function renderShortStatus(source: MacroState['shortSellingSource'], ratio: number, fetchedAt: string | undefined, nowMs: number, via: 'macroState' | 'liveProbe'): ChannelStatus {
  const age = elapsedMs(fetchedAt, nowMs);
  const ageStale = age !== null && age > SHORT_STALE_DAYS * DAY_MS;
  const sourceStale = source === 'KIS_ESTIMATE';
  const stale = ageStale || sourceStale;
  return { key: 'shortSelling', title: '공매도/대차잔고', marker: stale ? 'STALE' : 'OK', riskReason: sourceStale ? 'KIS_ESTIMATE — KRX 폴백 실패, 정확도 ↓' : ageStale ? `updated ${formatAgo(age)}` : undefined, lines: [`source: ${source}`, `ratio: ${ratio.toFixed(2)}%`, `updated: ${formatAgo(age)}`, `via: ${via}`, '상세: /short_status 예정'] };
}
async function diagnoseShort(macro: MacroState | null, nowMs: number): Promise<ChannelStatus> {
  if (macro?.shortSellingSource && macro.shortSellingRatio !== undefined) return renderShortStatus(macro.shortSellingSource, macro.shortSellingRatio, macro.shortSellingFetchedAt, nowMs, 'macroState');
  try { const live = await fetchKrxShortSelling(); if (live) { const status = renderShortStatus(live.source, live.ratio, live.fetchedAt, nowMs, 'liveProbe'); status.lines.push('판정: macroState 결손이나 live probe 성공 — refresh wiring 필요'); return status; } } catch {}
  return { key: 'shortSelling', title: '공매도/대차잔고', marker: 'NEUTRAL', lines: ['source: N/A', 'status: PROVIDER_UNAVAILABLE', 'ratio: N/A', 'updated: N/A', '판정: 사용 가능한 provider 없음 — 점수 제외', '대체: KRX / KIND CSV·OTP / NAVER / 공공데이터', '상세: /short_status 예정'] };
}

function diagnoseForeignerRatio(targets: WatchlistEntry[], nowMs: number): ChannelStatus {
  let seriesCount = 0, stale = 0;
  for (const stock of targets) {
    const series = loadForeignerRatioSeries(stock.code); if (series.length === 0) continue;
    seriesCount++; const days = elapsedDays(series[series.length - 1]?.date, nowMs); if (days !== null && days > TWO_DAYS) stale++;
  }
  const total = targets.length;
  if (total > 0 && seriesCount === 0) return { key: 'foreignerRatioTrend', title: '외인 보유율 추세', marker: 'NEUTRAL', lines: ['source: NAVER', 'status: COLLECTION_EMPTY', `series: ${seriesCount}/${total}`, `stale: ${stale}`, '판정: 시계열 미누적 — 점수 제외', '수집: aiUniverseService / negative cache 해제 / warm-up', '상세: /foreigner_trend'] };
  const marker: Marker = total === 0 ? 'MISSING' : stale > 0 ? 'STALE' : 'OK';
  return { key: 'foreignerRatioTrend', title: '외인 보유율 추세', marker, riskReason: marker === 'STALE' ? `stale ${stale}/${seriesCount}` : marker === 'MISSING' ? 'watchlist 없음' : undefined, lines: ['source: NAVER', `series: ${seriesCount}/${total}`, `stale: ${stale}`, '상세: /foreigner_trend'] };
}

function diagnoseMargin(macro: MacroState | null, nowMs: number): ChannelStatus {
  if (macro?.marginBalanceSource !== 'ECOS_API' || macro.marginBalance5dChange === undefined) {
    return { key: 'marginBalance', title: '신용잔고', marker: 'NEUTRAL', lines: ['source: ECOS', 'status: PROVIDER_UNAVAILABLE', 'updated: N/A', `reason: ${macro?.marginBalanceSource === 'NONE' ? '최근 ECOS 조회 실패' : 'macroState 결손'}`, '판정: provider/wiring 미확정 — 점수 제외', '대체: KRX / 금투협 / ECOS 재시도 / CACHE', '상세: /margin_balance'] };
  }
  const age = elapsedMs(macro.marginBalanceFetchedAt, nowMs);
  const stale = age !== null && age > TWO_DAYS * DAY_MS;
  return { key: 'marginBalance', title: '신용잔고', marker: stale ? 'STALE' : 'OK', riskReason: stale ? `updated ${formatAgo(age)}` : undefined, lines: ['source: ECOS', `updated: ${formatAgo(age)}`, '상세: /margin_balance'] };
}

function buildRiskTop3(channels: ChannelStatus[]): string[] {
  const risks: string[] = [];
  for (const channel of channels) if (channel.zeroSuspect && isZeroFilledSuspicious(channel.zeroSuspect.count, channel.zeroSuspect.total)) risks.push(`- 🟠 ${channel.title}: ${zeroFilledRiskReason(channel.zeroSuspect.count, channel.zeroSuspect.total)}`);
  for (const channel of channels) if (channel.marker !== 'OK' && channel.marker !== 'N/A' && channel.marker !== 'NEUTRAL') risks.push(`- ${markerIcon(channel.marker)} ${channel.title}: ${channel.riskReason ?? channel.marker}`);
  for (const channel of channels) if (channel.marker === 'N/A') risks.push(`- ${markerIcon(channel.marker)} ${channel.title}: ${channel.riskReason ?? channel.marker}`);
  return risks.slice(0, 3);
}
function renderMessage(channels: ChannelStatus[], targetLine: string, cacheLine: string): string {
  const ok = channels.filter((c) => c.marker === 'OK').length;
  const neutral = channels.filter((c) => c.marker === 'NEUTRAL').length;
  const stale = channels.filter((c) => c.marker === 'STALE').length;
  const degraded = channels.filter((c) => c.marker === 'DEGRADED').length;
  const missing = channels.filter((c) => c.marker === 'MISSING').length;
  const risks = buildRiskTop3(channels);
  const lines = [`📊 Supply Health: ${ok}/${channels.length} OK | ${neutral} NEUTRAL | ${degraded} DEGRADED | ${stale} STALE | ${missing} MISSING`, targetLine, cacheLine, '', '⚠️ 위험 TOP 3', ...(risks.length > 0 ? risks : ['- 🟢 주요 위험 없음']), ''];
  channels.forEach((channel, index) => {
    lines.push(`${index + 1}. ${markerIcon(channel.marker)} ${channel.title}`);
    if (channel.marker === 'NEUTRAL') lines.push(`  ${compactProviderRoute(channel.key)}`);
    for (const line of channel.lines) lines.push(`  ${line}`);
    if (index !== channels.length - 1) lines.push('');
  });
  const message = lines.join('\n');
  return message.length < 4096 ? message : `${message.slice(0, 4050)}\n...`;
}

export async function buildSupplyHealthMessage(now: Date = new Date()): Promise<string> {
  const nowMs = now.getTime();
  if (cache && nowMs - cache.builtAt < SUPPLY_HEALTH_CACHE_TTL_MS) {
    const ageSec = Math.max(0, Math.floor((nowMs - cache.builtAt) / 1000));
    return cache.message.replace('캐시: fresh', `캐시: ${ageSec}s`);
  }
  const watchlist = loadWatchlist();
  const targets = selectTopWatchlist(TOP_N);
  const macro = loadMacroStateReadOnly();
  const channels = [await diagnoseInvestorFlow(targets), await diagnoseStockProgram(targets), await diagnoseMarketProgram(macro, nowMs), diagnoseFss(macro, nowMs), await diagnoseShort(macro, nowMs), diagnoseForeignerRatio(targets, nowMs), diagnoseMargin(macro, nowMs)];
  const message = renderMessage(channels, formatTargetLine(watchlist.length, targets.length), '캐시: fresh');
  cache = { message, builtAt: nowMs };
  return message;
}
export function __resetSupplyHealthCacheForTests(): void { cache = null; }

const supplyHealth: TelegramCommand = {
  name: '/supply_health', aliases: ['/sh'], category: 'SYS', visibility: 'ADMIN', riskLevel: 0,
  description: '수급 데이터 source/freshness/coverage/zero-filled 의심 read-only 진단', usage: '/supply_health',
  async execute({ reply }) {
    try { await reply(await buildSupplyHealthMessage()); } catch (err) { console.error('[supplyHealth.cmd] failed', err); await reply('🔴 Supply Health 진단 실패 — 서버 로그 확인 필요'); }
  },
};

commandRegistry.register(supplyHealth);
export default supplyHealth;
