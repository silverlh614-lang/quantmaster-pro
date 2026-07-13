/**
 * @responsibility 기관/외인 수급 provider/cache warm-up cron.
 *
 * 장중에 stage2Score 상위 종목을 KRX_INVESTOR_FLOW 라우터로 미리 조회해
 * 성공값을 investor-flow cache 에 저장한다. 장외 /sh 는 이 cache 를 사용한다.
 * fake-zero 는 router 의 semantic field guard 가 차단한다.
 */

import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { fetchInvestorFlowWithPolicy, summarizeInvestorFlowAttempts } from '../supply/investorFlowRouter.js';
import { computeFocusCodes, assignSection } from '../screener/watchlistManager.js';
import { scheduledJob } from './scheduleGuard.js';
// ADR-0516 — Watchlist Tier 정책: MOMENTUM_PASSIVE 는 warmup 후순위 (KIS 부하 완화).
//   warmup 은 SWING/CATALYST/MOMENTUM_ACTIVE 에 집중하고 MOMENTUM_PASSIVE 는 잔여 capacity 만 사용.
import { assignMomentumRanks, resolveWatchlistKisPolicy } from '../trading/watchlistKisTierPolicy.js';

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

/**
 * ADR-0516 — Watchlist Tier 정책 기반 warmup 후보 선정.
 *
 * MOMENTUM_PASSIVE tier (REST 차단 대상) 는 후순위로 밀어 warmup capacity 를
 * SWING / CATALYST / MOMENTUM_ACTIVE 에 집중시킨다. MOMENTUM_PASSIVE 도 잔여
 * limit capacity 가 있으면 warmup — 하드 exclude 가 아닌 lower-priority.
 *
 * KIS_LOAD_STATE / momentumRank 는 resolveWatchlistKisPolicy 가 ENV/필드에서
 * 자동 도출. 영속 schema 변경 없음 — section/momentumRank 는 runtime-only.
 */
function selectWarmupCodes(limit: number): string[] {
  const watchlist = loadWatchlist();
  // section 할당 — warmup 은 자체 watchlist 사본을 쓰므로 직접 분류한다.
  const focusCodes = computeFocusCodes(watchlist);
  for (const w of watchlist) {
    w.section = assignSection(w, focusCodes);
  }
  assignMomentumRanks(watchlist.filter((w) => w.section === 'MOMENTUM'));

  // tier 정책으로 active / passive 2-bucket 분리. 각 bucket 내부는 scoreOf 내림차순.
  const active: WatchlistEntry[] = [];
  const passive: WatchlistEntry[] = [];
  for (const entry of watchlist) {
    const policy = resolveWatchlistKisPolicy({
      section: entry.section,
      gateScore: (entry as { gateScore?: number }).gateScore,
      stage2Score: (entry as { stage2Score?: number }).stage2Score,
      momentumRank: (entry as { momentumRank?: number }).momentumRank,
    });
    (policy.tier === 'MOMENTUM_PASSIVE' ? passive : active).push(entry);
  }
  const sortByScore = (a: WatchlistEntry, b: WatchlistEntry) => scoreOf(b) - scoreOf(a);
  active.sort(sortByScore);
  passive.sort(sortByScore);

  const seen = new Set<string>();
  const codes: string[] = [];
  for (const entry of [...active, ...passive]) {
    const code = String(entry.code ?? '').replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= limit) break;
  }
  return codes;
}

interface InvestorFlowWarmupSummary {
  total: number;
  krxOk: number;
  cacheOk: number;
  offHours: number;
  missing: number;
  failed: number;
  sample: string[];
}

async function runInvestorFlowWarmup(limit = investorFlowWarmupLimit()): Promise<InvestorFlowWarmupSummary> {
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
      /* SDS-ignore: warmup item failures are counted in summary.failed and sampled for operator diagnostics. */
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
  // KST 12:35 — 12:30 lunch_briefing(Telegram+데이터) 동시각 경합 회피 (cron stagger 감사 2026-06-10).
  register('35 12 * * 1-5', 'investor_flow_warmup_lunch');
  register('25 15 * * 1-5', 'investor_flow_warmup_preclose');
}
