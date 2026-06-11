// @responsibility ADR-0601 Gate2 Supply 축 KIS 네이티브 hydration — 후보별 투자자 순매수를 단일통로 evidence 로 보충 (일중 캐시·스캔당 상한·실패 격리).

import { fetchKisInvestorFlowEvidence } from '../../../supply/kisInvestorFlowEvidence.js';

export interface Gate2InvestorFlowHydrationReportAdr0601 {
  enabled: boolean;
  candidates: number;
  alreadyCovered: number;
  attempted: number;
  hydrated: number;
  cacheHits: number;
  failures: number;
  capped: number;
  maxPerScan: number;
  executionImpact: 'NONE';
}

/** ADR-0601 — KIS 네이티브 hydration 스위치 (default ON, `!== 'false'`). false 1줄 롤백. */
export function isGate2InvestorFlowHydrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GATE2_INVESTOR_FLOW_NATIVE_HYDRATION_ENABLED !== 'false';
}

/** 스캔당 신규 KIS 조회 상한 (0~50 정수, 무효/미설정 → 16). 일중 캐시 적중은 상한 미소모. */
export function resolveGate2InvestorFlowHydrationMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GATE2_INVESTOR_FLOW_HYDRATION_MAX;
  if (raw === undefined || raw.trim() === '') return 16;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 50 ? parsed : 16;
}

interface HydratableSnapshot {
  symbol?: string;
  gate1Passed?: boolean;
  gate2ExternalDataCoverage?: Record<string, unknown>;
}

interface CachedInvestorFlow {
  dateKey: string;
  payload: Record<string, unknown>;
}

const flowCache = new Map<string, CachedInvestorFlow>();
const failureSuppressed = new Map<string, string>();

/** 테스트 격리용 — 운영 경로 미사용. */
export function __resetGate2InvestorFlowHydrationStateForTest(): void {
  flowCache.clear();
  failureSuppressed.clear();
}

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasInvestorFlowCoverage(snapshot: HydratableSnapshot): boolean {
  const flow = snapshot.gate2ExternalDataCoverage?.kisInvestorFlow as Record<string, unknown> | undefined;
  if (!flow) return false;
  return finite(flow.foreignNetBuy) || finite(flow.institutionalNetBuy);
}

function applyPayload(snapshot: HydratableSnapshot, payload: Record<string, unknown>): void {
  snapshot.gate2ExternalDataCoverage = {
    ...(snapshot.gate2ExternalDataCoverage ?? {}),
    kisInvestorFlow: payload,
  };
}

/**
 * Gate2 Supply 축 입력(kisInvestorFlow)이 비어 있는 후보에 한해 KIS 단일통로 evidence
 * (`fetchKisInvestorFlowEvidence` → kisClient.fetchKisInvestorTradeByStockDaily, 'LOW' 우선순위)로
 * 보충한다. 일중 캐시(symbol×KST일자)·당일 실패 재시도 1회 억제·스캔당 신규 조회 상한으로
 * quota 를 관리하고, 모든 실패는 격리한다 (불변식 #1/#2 — 진단 보충이 엔진을 멈추지 않음).
 */
export async function hydrateGate2InvestorFlowAdr0601(input: {
  candidateSnapshots: readonly HydratableSnapshot[];
  now?: Date;
  fetcher?: typeof fetchKisInvestorFlowEvidence;
  env?: NodeJS.ProcessEnv;
}): Promise<Gate2InvestorFlowHydrationReportAdr0601> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const maxPerScan = resolveGate2InvestorFlowHydrationMax(env);
  const report: Gate2InvestorFlowHydrationReportAdr0601 = {
    enabled: isGate2InvestorFlowHydrationEnabled(env),
    candidates: input.candidateSnapshots.length,
    alreadyCovered: 0,
    attempted: 0,
    hydrated: 0,
    cacheHits: 0,
    failures: 0,
    capped: 0,
    maxPerScan,
    executionImpact: 'NONE',
  };
  if (!report.enabled || maxPerScan === 0) return report;
  const fetcher = input.fetcher ?? fetchKisInvestorFlowEvidence;
  const dateKey = kstDateKey(now);

  // Gate1 통과 후보 우선 (Gate2 평가 모집단), 이후 등록순 — 상한 내 가장 가치 있는 보충부터.
  const missing = input.candidateSnapshots
    .filter((snapshot) => {
      if (!snapshot.symbol) return false;
      if (hasInvestorFlowCoverage(snapshot)) {
        report.alreadyCovered += 1;
        return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.gate1Passed === true) - Number(a.gate1Passed === true));

  for (const snapshot of missing) {
    const symbol = snapshot.symbol as string;
    const cached = flowCache.get(symbol);
    if (cached && cached.dateKey === dateKey) {
      applyPayload(snapshot, cached.payload);
      report.cacheHits += 1;
      report.hydrated += 1;
      continue;
    }
    if (failureSuppressed.get(symbol) === dateKey) continue;
    if (report.attempted >= maxPerScan) {
      report.capped += 1;
      continue;
    }
    report.attempted += 1;
    try {
      const evidence = await fetcher(symbol, now);
      const sample = evidence.sample;
      if (!sample || (!finite(sample.foreignNetBuy) && !finite(sample.institutionalNetBuy))) {
        failureSuppressed.set(symbol, dateKey);
        report.failures += 1;
        continue;
      }
      const payload: Record<string, unknown> = {
        status: sample.confidence === 'VERIFIED' ? 'VERIFIED' : 'PARTIAL',
        ...(finite(sample.foreignNetBuy) ? { foreignNetBuy: sample.foreignNetBuy } : {}),
        ...(finite(sample.institutionalNetBuy) ? { institutionalNetBuy: sample.institutionalNetBuy } : {}),
        sourceDate: sample.sourceDate,
        hydratedBy: 'ADR_0601_KIS_NATIVE_HYDRATION',
      };
      flowCache.set(symbol, { dateKey, payload });
      applyPayload(snapshot, payload);
      report.hydrated += 1;
    } catch {
      // silent 금지 — 집계로 가시화하고 당일 재시도 억제 (per-symbol warn 폭주 방지).
      failureSuppressed.set(symbol, dateKey);
      report.failures += 1;
    }
  }
  if (report.attempted > 0 || report.cacheHits > 0) {
    console.info(
      `[ADR-0601] Gate2 investor-flow native hydration — hydrated=${report.hydrated} ` +
        `(fetch=${report.attempted} cache=${report.cacheHits} fail=${report.failures} capped=${report.capped} ` +
        `max=${maxPerScan}) executionImpact=NONE`,
    );
  }
  return report;
}
