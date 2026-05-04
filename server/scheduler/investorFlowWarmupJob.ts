/**
 * @responsibility 기관/외인 수급 provider/cache warm-up cron.
 *
 * 장중에 stage2Score 상위 종목을 KRX_INVESTOR_FLOW 라우터로 미리 조회해
 * 성공값을 investor-flow cache 에 저장한다. 장외 /sh 는 이 cache 를 사용한다.
 * fake-zero 는 router 의 semantic field guard 가 차단한다.
 */

import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { fetchInvestorFlowWithPolicy, summarizeInvestorFlowAttempts } from '../supply/investorFlowRouter.js';
import { scheduledJob } from './scheduleGuard.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

function investorFlowWarmupLimit(): number {
  const raw = Number.parseInt(process.env.INVESTOR_FLOW_WARMUP_LIMIT ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, raw));
}

function scoreOf(entry: WatchlistEntry): number {
  const anyEntry = entry as unknown as Record<string, unknown>;
  const stage2 = Number(anyEntry.stage2Score ?? Number.NaN);
  if (Number.isFinite(stage2)) return stage2;
  const gate = Number(anyEntry.gateScore ?? 0);
  return Number.isFinite(gate) ? gate : 0;
}

function selectWarmupCodes(limit: number): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const entry of [...loadWatchlist()].sort((a, b) => scoreOf(b) - scoreOf(a))) {
    const code = String(entry.code ?? '').replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= limit) break;
  }
  return codes;
}

export interface InvestorFlowWarmupSummary {
  total: number;
  krxOk: number;
  cacheOk: number;
  offHours: number;
  missing: number;
  failed: number;
  sample: string[];
}

export async function runInvestorFlowWarmup(limit = investorFlowWarmupLimit()): Promise<InvestorFlowWarmupSummary> {
  const codes = selectWarmupCodes(limit);
  const summary: InvestorFlowWarmupSummary = {
    total: codes.length,
    krxOk: 0,
    cacheOk: 0,
    offHours: 0,
    missing: 0,
    failed: 0,
    sample: [],
  };

  for (const code of codes) {
    try {
      const result = await fetchInvestorFlowWithPolicy(code);
      const attempts = summarizeInvestorFlowAttempts(result.attempts);
      if (result.source === 'KRX_INVESTOR_FLOW') summary.krxOk += 1;
      else if (result.source === 'CACHE') summary.cacheOk += 1;
      else summary.missing += 1;
      if (result.attempts.some((a) => a.status === 'OFF_HOURS')) summary.offHours += 1;
      if (summary.sample.length < 5) summary.sample.push(`${code}:${result.source ?? result.status}:${attempts}`);
    } catch (err) {
      summary.failed += 1;
      if (summary.sample.length < 5) summary.sample.push(`${code}:ERROR:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[InvestorFlowWarmup] total=${summary.total} krxOk=${summary.krxOk} cacheOk=${summary.cacheOk} offHours=${summary.offHours} missing=${summary.missing} failed=${summary.failed}`);
  if (summary.sample.length > 0) console.log(`[InvestorFlowWarmup] sample ${summary.sample.join(' | ')}`);
  return summary;
}

function note(summary: InvestorFlowWarmupSummary): string {
  return `total=${summary.total} krx=${summary.krxOk} cache=${summary.cacheOk} offHours=${summary.offHours} missing=${summary.missing} failed=${summary.failed}`;
}

export function registerInvestorFlowWarmupJobs(): void {
  const register = (cronExpr: string, jobName: string) => {
    scheduledJob(
      cronExpr,
      'TRADING_DAY_ONLY',
      jobName,
      async () => note(await runInvestorFlowWarmup()),
      { timezone: 'Asia/Seoul' },
    );
  };

  register('10 9 * * 1-5', 'investor_flow_warmup_open');
  register('30 12 * * 1-5', 'investor_flow_warmup_lunch');
  register('25 15 * * 1-5', 'investor_flow_warmup_preclose');
}
