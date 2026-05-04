/**
 * @responsibility 수급 데이터 채널의 source/freshness/coverage/zero-filled 의심을 read-only로 진단한다.
 *
 * PR-574: KIS investor-flow rawDiag 가 `MCA00000 + output array` 이지만 투자자 순매수
 * 필드가 없는 경우는 live 장애가 아니라 endpoint/TR 목적 불일치다. fake-zero 투입을
 * 막고 PROVIDER_MISMATCH neutral 로 분리해 다음 대체 provider 작업을 명확히 한다.
 *
 * PR-575: 시장 프로그램매매 rawDiag 가 ACCEPTED_EMPTY 인데 live fetch null/0 객체가
 * OK로 승격되는 경로를 차단한다. accepted-empty 는 정상 0억이 아니라 데이터 body 부재다.
 *
 * PR-576: macroState 에 공매도 필드가 아직 없을 때 `/sh` 에서 read-only live probe 를
 * 1회 수행해 KRX_DIRECT/KRX_OTP/KIS_ESTIMATE 상태를 분리한다. 저장은 하지 않는다.
 *
 * PR-577: macroState 결손 + live probe 실패는 시스템 장애가 아니라 공매도 provider 미확정
 * 상태로 분리한다. PROVIDER_UNAVAILABLE neutral 로 표기하고 점수 입력/위험 TOP 3에서 제외한다.
 */

import fs from 'fs';
import { fetchKisInvestorFlow, fetchKisMarketProgramTrade, fetchKisStockProgramTrade } from '../../../clients/kisClient/index.js';
import { diagnoseKisInvestorFlowRaw, diagnoseKisMarketProgramRaw, diagnoseKisStockProgramRaw, formatKisRawSupplyDiagnostic } from '../../../clients/kisClient/supplyDiagnostics.js';
import { FSS_RECORDS_FILE, MACRO_STATE_FILE } from '../../../persistence/paths.js';
import { loadForeignerRatioSeries } from '../../../persistence/foreignerRatioRepo.js';
import { loadWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { MacroState } from '../../../persistence/macroStateRepo.js';
import { fetchKrxShortSelling } from '../../../trading/marketDataRefresh.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export const SUPPLY_HEALTH_CACHE_TTL_MS = 30_000;

const TOP_N = 10;
const KIS_STALE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;
const TWO_DAYS = 2;
const FSS_STALE_DAYS = 4;
/** ADR-0145: 공매도 신선도 임계 — KRX 일별 데이터는 영업일 1회 갱신, 2일 초과는 stale. */
const SHORT_STALE_DAYS = 2;
const ZERO_FILLED_MIN_COUNT = 3;
const ZERO_FILLED_RATIO_WARN = 0.8;

type Marker = 'OK' | 'STALE' | 'DEGRADED' | 'MISSING' | 'NEUTRAL' | 'N/A';

interface ChannelStatus {
  title: string;
  marker: Marker;
  lines: string[];
  riskReason?: string;
  zeroSuspect?: { count: number; total: number };
}

let cache: { message: string; builtAt: number } | null = null;

function markerIcon(marker: Marker): string {
  if (marker === 'OK') return '🟢';
  if (marker === 'STALE') return '🟡';
  if (marker === 'DEGRADED') return '🟠';
  if (marker === 'MISSING') return '🔴';
  if (marker === 'NEUTRAL') return '⚪';
  return '⚪';
}

function readJsonFile<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function loadMacroStateReadOnly(): MacroState | null {
  return readJsonFile<MacroState>(MACRO_STATE_FILE);
}

interface FssRecordRow {
  date: string;
  passiveNetBuy: number;
  activeNetBuy: number;
}

function loadFssRecordsReadOnly(): FssRecordRow[] {
  const rows = readJsonFile<FssRecordRow[]>(FSS_RECORDS_FILE);
  return Array.isArray(rows) ? rows : [];
}

function selectTopWatchlist(limit = TOP_N): WatchlistEntry[] {
  return [...loadWatchlist()]
    .sort((a, b) => Number((b as any).stage2Score ?? 0) - Number((a as any).stage2Score ?? 0))
    .slice(0, limit);
}

function formatTargetLine(totalWatchlist: number, picked: number): string {
  if (totalWatchlist >= TOP_N) return `검증 종목: stage2Score 상위 10개 중 ${picked}개`;
  return `검증 종목: stage2Score 상위 ${picked}개`;
}

function elapsedMs(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? Math.max(0, nowMs - ts) : null;
}

function formatAgo(ms: number | null): string {
  if (ms === null) return 'N/A';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}일 전`;
}

function todayKstDate(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}

function elapsedDays(date: string | null | undefined, nowMs: number): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // 영업일 helper가 없으므로 이번 PR에서는 calendar day 기반 최소 진단으로 둔다.
  const today = Date.parse(`${todayKstDate(nowMs)}T00:00:00Z`);
  const then = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(today) || !Number.isFinite(then)) return null;
  return Math.max(0, Math.round((today - then) / DAY_MS));
}

function isZeroFilledSuspicious(count: number, total: number): boolean {
  if (total <= 0) return false;
  return count >= ZERO_FILLED_MIN_COUNT && count / total >= ZERO_FILLED_RATIO_WARN;
}

function zeroWarn(count: number, total: number): string {
  return `${count}/${total}${isZeroFilledSuspicious(count, total) ? ' ⚠️' : ''}`;
}

function formatEokwon(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) < 0.05) return '0억';
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}억`;
}

function zeroFilledRiskReason(count: number, total: number): string {
  return `zero-filled 의심 ${count}/${total} — KIS success지만 실데이터 신뢰 불가`;
}

function firstTargetCode(targets: WatchlistEntry[]): string | null {
  return targets[0]?.code ?? null;
}

function isInvestorFlowProviderMismatchRaw(rawDiagLine: string | null): boolean {
  return Boolean(
    rawDiagLine?.includes('rawDiag=INVESTOR_FLOW')
    && rawDiagLine.includes('ok=true')
    && rawDiagLine.includes('zeroReason=FIELD_MISSING')
  );
}

function investorFlowMissingReason(rawDiagLine: string | null, success: number): string {
  if (success > 0) return '';
  if (isInvestorFlowProviderMismatchRaw(rawDiagLine)) {
    return 'KIS TR 목적 불일치 — 투자자 순매수 필드 없음, 대체 provider 필요';
  }
  if (rawDiagLine?.includes('zeroReason=FETCH_FAIL')) {
    return 'KIS raw diagnostic fetch 실패 — circuit/rate-limit/http 확인 필요';
  }
  return '조회 성공 0건';
}

function renderInvestorFlowDecision(marker: Marker, zeroSuspicious: boolean, success: number, rawDiagLine: string | null): string {
  if (marker === 'NEUTRAL') {
    return '판정: PROVIDER_MISMATCH — KIS 정상 응답이나 투자자 순매수 필드 없음; 수급 점수 입력 제외';
  }
  if (marker === 'MISSING') {
    const reason = investorFlowMissingReason(rawDiagLine, success);
    return `판정: MISSING — ${reason || '실데이터 없음'}; 수급 점수 입력 제외`;
  }
  if (zeroSuspicious) return '판정: DEGRADED — 수급 점수 입력 제외 권장';
  return '판정: OK';
}

function isAcceptedEmptyRaw(rawDiagLine: string): boolean {
  return rawDiagLine.includes('rawDiag=MARKET_PROGRAM') && rawDiagLine.includes('zeroReason=ACCEPTED_EMPTY');
}

async function diagnoseInvestorFlow(targets: WatchlistEntry[]): Promise<ChannelStatus> {
  // PR-558: raw diagnostic first. Bulk scan can consume rate-limit tokens and leave
  // the diagnostic call as null/rootKeys=NONE, which hides the real KIS response branch.
  const rawDiagLine = firstTargetCode(targets)
    ? formatKisRawSupplyDiagnostic(await diagnoseKisInvestorFlowRaw(firstTargetCode(targets) as string, 'HIGH'))
    : null;
  let success = 0;
  let zero = 0;
  for (const stock of targets) {
    try {
      const data = await fetchKisInvestorFlow(stock.code, 'MEDIUM');
      if (!data) continue;
      success++;
      if (data.foreignNetBuy + data.institutionalNetBuy === 0) zero++;
    } catch {
      // Per-symbol failure must not fail the whole diagnostic card.
    }
  }
  const total = targets.length;
  const zeroSuspicious = isZeroFilledSuspicious(zero, total);
  const providerMismatch = success === 0 && isInvestorFlowProviderMismatchRaw(rawDiagLine);
  const marker: Marker = providerMismatch
    ? 'NEUTRAL'
    : total === 0 || success === 0
      ? 'MISSING'
      : zeroSuspicious
        ? 'DEGRADED'
        : 'OK';
  const missingReason = investorFlowMissingReason(rawDiagLine, success);
  return {
    title: '기관/외인 수급',
    marker,
    riskReason: marker === 'MISSING'
      ? missingReason
      : zeroSuspicious
        ? zeroFilledRiskReason(zero, total)
        : undefined,
    zeroSuspect: { count: zero, total },
    lines: [
      'source: KIS_API',
      ...(providerMismatch ? ['status: PROVIDER_MISMATCH'] : []),
      `success: ${success}/${total}`,
      'stale: 0',
      `zero-filled 의심: ${zeroWarn(zero, total)}`,
      renderInvestorFlowDecision(marker, zeroSuspicious, success, rawDiagLine),
      ...(providerMismatch ? ['대체 후보: KRX 투자자별 매매 / Naver 투자자동향 / 저장 cache'] : []),
      ...(rawDiagLine ? [rawDiagLine] : []),
      '상세: /investor_flow 예정',
    ],
  };
}

async function diagnoseStockProgram(targets: WatchlistEntry[]): Promise<ChannelStatus> {
  let success = 0;
  let zero = 0;
  for (const stock of targets) {
    try {
      const data = await fetchKisStockProgramTrade(stock.code, 'MEDIUM');
      if (!data) continue;
      success++;
      if (data.programNetBuyAmount === 0) zero++;
    } catch {
      // Per-symbol failure must not fail the whole diagnostic card.
    }
  }
  const total = targets.length;
  const missing = Math.max(0, total - success);
  const zeroSuspicious = isZeroFilledSuspicious(zero, total);
  const marker: Marker = total === 0 || success === 0 ? 'MISSING' : zeroSuspicious ? 'DEGRADED' : 'OK';
  const rawDiagLine = zeroSuspicious && firstTargetCode(targets)
    ? formatKisRawSupplyDiagnostic(await diagnoseKisStockProgramRaw(firstTargetCode(targets) as string, 'MEDIUM'))
    : null;
  return {
    title: '종목 프로그램매매',
    marker,
    riskReason: marker === 'MISSING'
      ? '조회 성공 0건'
      : zeroSuspicious
        ? zeroFilledRiskReason(zero, total)
        : missing > 0
          ? `missing ${missing}`
          : undefined,
    zeroSuspect: { count: zero, total },
    lines: [
      'source: KIS_API',
      `success: ${success}/${total}`,
      `missing: ${missing}`,
      `zero-filled 의심: ${zeroWarn(zero, total)}`,
      zeroSuspicious ? '판정: DEGRADED — 프로그램 수급 점수 입력 제외 권장' : '판정: OK',
      ...(rawDiagLine ? [rawDiagLine] : []),
      '상세: /program_today',
    ],
  };
}

function renderAcceptedEmptyMarketProgram(rawDiagLine: string): ChannelStatus {
  return {
    title: '시장 프로그램매매',
    marker: 'NEUTRAL',
    lines: [
      'source: KIS_API',
      'status: ACCEPTED_EMPTY',
      'latest: N/A',
      'updated: N/A',
      '판정: KIS 정상 수락, output 없음 — 점수 입력 제외',
      rawDiagLine,
      '상세: /program_market',
    ],
  };
}

async function diagnoseMarketProgram(macro: MacroState | null, nowMs: number): Promise<ChannelStatus> {
  const rawDiagLine = formatKisRawSupplyDiagnostic(await diagnoseKisMarketProgramRaw('HIGH'));
  if (isAcceptedEmptyRaw(rawDiagLine)) return renderAcceptedEmptyMarketProgram(rawDiagLine);

  const macroAge = elapsedMs(macro?.programFetchedAt, nowMs);
  if (macro?.programSource === 'KIS_API' && macro.programNetBuyAmount !== undefined && macroAge !== null && macroAge <= KIS_STALE_MS) {
    return {
      title: '시장 프로그램매매',
      marker: 'OK',
      lines: [
        'source: KIS_API',
        `latest: ${formatEokwon(macro.programNetBuyAmount)}`,
        `updated: ${formatAgo(macroAge)}`,
        rawDiagLine,
        '상세: /program_market',
      ],
    };
  }

  try {
    const live = await fetchKisMarketProgramTrade('MEDIUM');
    if (live) {
      return {
        title: '시장 프로그램매매',
        marker: 'OK',
        lines: [
          'source: KIS_API',
          `latest: ${formatEokwon(live.programNetBuyAmount / 100_000_000)}`,
          'updated: 0s ago',
          rawDiagLine,
          '상세: /program_market',
        ],
      };
    }
  } catch {
    // Fall back to persisted state below.
  }

  if (macro?.programSource === 'KIS_API' && macro.programNetBuyAmount !== undefined) {
    const stale = macroAge !== null && macroAge > KIS_STALE_MS;
    return {
      title: '시장 프로그램매매',
      marker: stale ? 'STALE' : 'MISSING',
      riskReason: stale ? `updated ${formatAgo(macroAge)}` : 'updatedAt 없음',
      lines: [
        'source: KIS_API',
        `latest: ${formatEokwon(macro.programNetBuyAmount)}`,
        `updated: ${formatAgo(macroAge)}`,
        rawDiagLine,
        '상세: /program_market',
      ],
    };
  }

  return {
    title: '시장 프로그램매매',
    marker: 'MISSING',
    riskReason: 'KIS/macroState 결손',
    lines: ['source: KIS_API', 'latest: N/A', 'updated: N/A', rawDiagLine, '상세: /program_market'],
  };
}

function diagnoseFss(macro: MacroState | null, nowMs: number): ChannelStatus {
  const rows = loadFssRecordsReadOnly().sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows.length > 0 ? rows[rows.length - 1].date : null;
  const days = elapsedDays(latest, nowMs);
  const marker: Marker = rows.length === 0 ? 'MISSING' : days !== null && days > FSS_STALE_DAYS ? 'STALE' : 'OK';
  return {
    title: 'FSS Passive/Active',
    marker,
    riskReason: marker === 'STALE' ? `${days}영업일 stale` : marker === 'MISSING' ? '레코드 없음' : undefined,
    lines: [
      `status: ${marker}`,
      `passiveActiveBoth: ${macro?.passiveActiveBoth === undefined ? 'N/A' : String(macro.passiveActiveBoth)}`,
      `updated: ${days === null ? 'N/A' : `${days}영업일 전`}`,
      '상세: /fss_status',
    ],
  };
}

function renderShortStatus(
  source: MacroState['shortSellingSource'],
  ratio: number,
  fetchedAt: string | undefined,
  nowMs: number,
  via: 'macroState' | 'liveProbe',
): ChannelStatus {
  const age = elapsedMs(fetchedAt, nowMs);
  const ageStale = age !== null && age > SHORT_STALE_DAYS * DAY_MS;
  // KIS_ESTIMATE 는 KRX 두 경로 모두 실패한 fallback — 정확도 낮음, STALE 격상.
  const sourceStale = source === 'KIS_ESTIMATE';
  const stale = ageStale || sourceStale;

  return {
    title: '공매도/대차잔고',
    marker: stale ? 'STALE' : 'OK',
    riskReason: sourceStale
      ? 'KIS_ESTIMATE — KRX 폴백 실패, 정확도 ↓'
      : ageStale
        ? `updated ${formatAgo(age)}`
        : undefined,
    lines: [
      `source: ${source}`,
      `ratio: ${ratio.toFixed(2)}%`,
      `updated: ${formatAgo(age)}`,
      `via: ${via}`,
      '상세: /short_status 예정',
    ],
  };
}

/**
 * ADR-0145 + PR-576 + PR-577 — macroState 직접 읽기 우선, 결손 시 read-only live probe.
 *
 * macroState 에 shortSelling* 필드가 있으면 기존 영속값을 그대로 진단한다.
 * 없으면 `/sh` 에서 `fetchKrxShortSelling()` 을 1회 호출해 KRX_DIRECT/KRX_OTP/KIS_ESTIMATE
 * 중 실제 가능한 경로를 확인한다. 이 live probe 는 저장하지 않으므로 cron/refresh wiring
 * 결손과 provider 가용성을 분리해서 보여준다.
 *
 * live probe 까지 실패하면 현재는 자동매매 필수 장애가 아니라 provider 미확정 상태다.
 * 따라서 PROVIDER_UNAVAILABLE neutral 로 격리하고 점수 입력/위험 TOP 3에서 제외한다.
 */
async function diagnoseShort(macro: MacroState | null, nowMs: number): Promise<ChannelStatus> {
  if (macro?.shortSellingSource && macro.shortSellingRatio !== undefined) {
    return renderShortStatus(
      macro.shortSellingSource,
      macro.shortSellingRatio,
      macro.shortSellingFetchedAt,
      nowMs,
      'macroState',
    );
  }

  try {
    const live = await fetchKrxShortSelling();
    if (live) {
      const status = renderShortStatus(live.source, live.ratio, live.fetchedAt, nowMs, 'liveProbe');
      status.lines.push('판정: macroState 결손이나 live probe 성공 — refresh wiring 필요');
      return status;
    }
  } catch {
    // fall through to provider-unavailable neutral card
  }

  return {
    title: '공매도/대차잔고',
    marker: 'NEUTRAL',
    lines: [
      'source: N/A',
      'status: PROVIDER_UNAVAILABLE',
      'ratio: N/A',
      'updated: N/A',
      '판정: 현재 사용 가능한 provider 없음 — 점수 입력 제외',
      '대체 후보: KRX 공매도 통계 / KIND·KRX CSV·OTP / Naver 공매도 / 공공데이터포털',
      '상세: /short_status 예정',
    ],
  };
}

function diagnoseForeignerRatio(targets: WatchlistEntry[], nowMs: number): ChannelStatus {
  let seriesCount = 0;
  let stale = 0;
  for (const stock of targets) {
    const series = loadForeignerRatioSeries(stock.code);
    if (series.length === 0) continue;
    seriesCount++;
    const days = elapsedDays(series[series.length - 1]?.date, nowMs);
    if (days !== null && days > TWO_DAYS) stale++;
  }
  const total = targets.length;
  const marker: Marker = total === 0 || seriesCount === 0 ? 'MISSING' : stale > 0 ? 'STALE' : 'OK';
  return {
    title: '외인 보유율 추세',
    marker,
    riskReason: marker === 'STALE' ? `stale ${stale}/${seriesCount}` : marker === 'MISSING' ? 'series 없음' : undefined,
    lines: [
      'source: NAVER',
      `series: ${seriesCount}/${total}`,
      `stale: ${stale}`,
      '상세: /foreigner_trend',
    ],
  };
}

function diagnoseMargin(macro: MacroState | null, nowMs: number): ChannelStatus {
  if (macro?.marginBalanceSource !== 'ECOS_API' || macro.marginBalance5dChange === undefined) {
    return {
      title: '신용잔고',
      marker: 'MISSING',
      riskReason: macro?.marginBalanceSource === 'NONE' ? '최근 ECOS 조회 실패' : 'macroState 결손',
      lines: ['source: ECOS', 'updated: N/A', '상세: /margin_balance'],
    };
  }
  const age = elapsedMs(macro.marginBalanceFetchedAt, nowMs);
  const stale = age !== null && age > TWO_DAYS * DAY_MS;
  return {
    title: '신용잔고',
    marker: stale ? 'STALE' : 'OK',
    riskReason: stale ? `updated ${formatAgo(age)}` : undefined,
    lines: ['source: ECOS', `updated: ${formatAgo(age)}`, '상세: /margin_balance'],
  };
}

function buildRiskTop3(channels: ChannelStatus[]): string[] {
  const risks: string[] = [];
  for (const channel of channels) {
    if (channel.zeroSuspect && isZeroFilledSuspicious(channel.zeroSuspect.count, channel.zeroSuspect.total)) {
      risks.push(`- 🟠 ${channel.title}: ${zeroFilledRiskReason(channel.zeroSuspect.count, channel.zeroSuspect.total)}`);
    }
  }
  for (const channel of channels) {
    if (channel.marker !== 'OK' && channel.marker !== 'N/A' && channel.marker !== 'NEUTRAL') {
      risks.push(`- ${markerIcon(channel.marker)} ${channel.title}: ${channel.riskReason ?? channel.marker}`);
    }
  }
  for (const channel of channels) {
    if (channel.marker === 'N/A') {
      risks.push(`- ${markerIcon(channel.marker)} ${channel.title}: ${channel.riskReason ?? channel.marker}`);
    }
  }
  return risks.slice(0, 3);
}

function renderMessage(channels: ChannelStatus[], targetLine: string, cacheLine: string): string {
  const ok = channels.filter((c) => c.marker === 'OK').length;
  const neutral = channels.filter((c) => c.marker === 'NEUTRAL').length;
  const stale = channels.filter((c) => c.marker === 'STALE').length;
  const degraded = channels.filter((c) => c.marker === 'DEGRADED').length;
  const missing = channels.filter((c) => c.marker === 'MISSING').length;
  const risks = buildRiskTop3(channels);
  const lines: string[] = [
    `📊 Supply Health: ${ok}/${channels.length} OK | ${neutral} NEUTRAL | ${degraded} DEGRADED | ${stale} STALE | ${missing} MISSING`,
    targetLine,
    cacheLine,
    '',
    '⚠️ 위험 TOP 3',
    ...(risks.length > 0 ? risks : ['- 🟢 주요 위험 없음']),
    '',
  ];

  channels.forEach((channel, index) => {
    lines.push(`${index + 1}. ${markerIcon(channel.marker)} ${channel.title}`);
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
  const channels = [
    await diagnoseInvestorFlow(targets),
    await diagnoseStockProgram(targets),
    await diagnoseMarketProgram(macro, nowMs),
    diagnoseFss(macro, nowMs),
    await diagnoseShort(macro, nowMs),
    diagnoseForeignerRatio(targets, nowMs),
    diagnoseMargin(macro, nowMs),
  ];

  const message = renderMessage(channels, formatTargetLine(watchlist.length, targets.length), '캐시: fresh');
  cache = { message, builtAt: nowMs };
  return message;
}

export function __resetSupplyHealthCacheForTests(): void {
  cache = null;
}

const supplyHealth: TelegramCommand = {
  name: '/supply_health',
  aliases: ['/sh'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '수급 데이터 source/freshness/coverage/zero-filled 의심 read-only 진단',
  usage: '/supply_health',
  async execute({ reply }) {
    try {
      await reply(await buildSupplyHealthMessage());
    } catch (err) {
      console.error('[supplyHealth.cmd] failed', err);
      await reply('🔴 Supply Health 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(supplyHealth);

export default supplyHealth;
