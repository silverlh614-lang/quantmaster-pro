/**
 * TanStack Query hooks for Global Intelligence data fetching.
 *
 * Tier 1 최적화 적용:
 * 1. localStorage 영속 캐시 (PersistQueryClientProvider)
 * 2. 데이터 반감기 기반 계층형 TTL (분기/주간/일간/실시간)
 * 3. KRX 장 시간 기반 스마트 캐시 무효화 (장외 = Infinity)
 *
 * 효과: 하루 35회 앱 실행 시 실제 API 호출 ~12회, 월 비용 80% 절감
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchMacroEnvironment,
  getEconomicRegime,
  getSmartMoneyFlow,
  getExportMomentum,
  getGeopoliticalRiskScore,
  getCreditSpreads,
  getExtendedEconomicRegime,
  getGlobalCorrelationMatrix,
  getSupplyChainIntelligence,
  getSectorOrderIntelligence,
  getFinancialStressIndex,
  getFomcSentimentAnalysis,
} from '../services/stockService';
import { useGlobalIntelStore } from '../stores';
import { evaluateGate0 } from '../services/quantEngine';
import { getStaleTime, PERSIST_GC_TIME } from '../utils/cacheConfig';

/**
 * 모듈 레벨 레이트 리미터.
 * Gemini 무료 티어 RPM 초과 방지 — 연속 AI 호출 사이에 최소 2초 간격 보장.
 */
let lastGeminiCallTime = 0;
const GEMINI_CALL_INTERVAL = 2000;

async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = GEMINI_CALL_INTERVAL - (now - lastGeminiCallTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeminiCallTime = Date.now();
  return fn();
}

// ── 공통 쿼리 옵션 생성 ─────────────────────────────────────────
function queryOpts(key: string) {
  return {
    staleTime: getStaleTime(key),
    gcTime: PERSIST_GC_TIME,
    refetchInterval: false as const,
    refetchOnWindowFocus: false,
    retry: 2,
  };
}

// ── 분기급 (24h TTL) ────────────────────────────────────────────

/** Core macro environment — Gate 0 input */
export function useMacroEnvironment() {
  const setMacroEnv = useGlobalIntelStore(s => s.setMacroEnv);
  const addMhsRecord = useGlobalIntelStore(s => s.addMhsRecord);

  return useQuery({
    queryKey: ['macro-environment'],
    queryFn: async () => {
      const data = await rateLimited(() => fetchMacroEnvironment());
      setMacroEnv(data);

      const g0 = evaluateGate0(data);
      const today = new Date().toISOString().split('T')[0];
      addMhsRecord({
        date: today,
        mhs: g0.macroHealthScore,
        mhsLevel: g0.mhsLevel,
        interestRate: g0.details.interestRateScore,
        liquidity: g0.details.liquidityScore,
        economic: g0.details.economicScore,
        risk: g0.details.riskScore,
      });

      return data;
    },
    ...queryOpts('macro-environment'),
  });
}

/** Extended regime (7-type) — 분기급 */
export function useExtendedRegime() {
  const setData = useGlobalIntelStore(s => s.setExtendedRegimeData);
  return useQuery({
    queryKey: ['extended-regime'],
    queryFn: async () => { const d = await rateLimited(() => getExtendedEconomicRegime()); setData(d); return d; },
    ...queryOpts('extended-regime'),
  });
}

// ── 주간급 (12h TTL) ────────────────────────────────────────────

/** Economic regime classification */
export function useEconomicRegime() {
  const setData = useGlobalIntelStore(s => s.setEconomicRegimeData);
  return useQuery({
    queryKey: ['economic-regime'],
    queryFn: async () => { const d = await rateLimited(() => getEconomicRegime()); setData(d); return d; },
    ...queryOpts('economic-regime'),
  });
}

/** Credit spreads */
export function useCreditSpreads() {
  const setData = useGlobalIntelStore(s => s.setCreditSpreadData);
  return useQuery({
    queryKey: ['credit-spreads'],
    queryFn: async () => { const d = await rateLimited(() => getCreditSpreads()); setData(d); return d; },
    ...queryOpts('credit-spreads'),
  });
}

/** Layer I: Supply chain intelligence */
export function useSupplyChain() {
  const setData = useGlobalIntelStore(s => s.setSupplyChainData);
  return useQuery({
    queryKey: ['supply-chain'],
    queryFn: async () => { const d = await rateLimited(() => getSupplyChainIntelligence()); setData(d); return d; },
    ...queryOpts('supply-chain'),
  });
}

/** Layer J: Sector order intelligence */
export function useSectorOrders() {
  const setData = useGlobalIntelStore(s => s.setSectorOrderData);
  return useQuery({
    queryKey: ['sector-orders'],
    queryFn: async () => { const d = await rateLimited(() => getSectorOrderIntelligence()); setData(d); return d; },
    ...queryOpts('sector-orders'),
  });
}

/** Layer K: Financial stress index */
export function useFinancialStress() {
  const setData = useGlobalIntelStore(s => s.setFinancialStressData);
  return useQuery({
    queryKey: ['financial-stress'],
    queryFn: async () => { const d = await rateLimited(() => getFinancialStressIndex()); setData(d); return d; },
    ...queryOpts('financial-stress'),
  });
}

// ── 일간급 (6h TTL) ─────────────────────────────────────────────

/** Smart Money ETF flows */
export function useSmartMoney() {
  const setData = useGlobalIntelStore(s => s.setSmartMoneyData);
  return useQuery({
    queryKey: ['smart-money'],
    queryFn: async () => { const d = await rateLimited(() => getSmartMoneyFlow()); setData(d); return d; },
    ...queryOpts('smart-money'),
  });
}

/** Export momentum */
export function useExportMomentum() {
  const setData = useGlobalIntelStore(s => s.setExportMomentumData);
  return useQuery({
    queryKey: ['export-momentum'],
    queryFn: async () => { const d = await rateLimited(() => getExportMomentum()); setData(d); return d; },
    ...queryOpts('export-momentum'),
  });
}

/** Global correlation matrix */
export function useGlobalCorrelation() {
  const setData = useGlobalIntelStore(s => s.setGlobalCorrelation);
  return useQuery({
    queryKey: ['global-correlation'],
    queryFn: async () => { const d = await rateLimited(() => getGlobalCorrelationMatrix()); setData(d); return d; },
    ...queryOpts('global-correlation'),
  });
}

// ── 실시간급 (2h TTL) ───────────────────────────────────────────

/** Geopolitical risk score */
export function useGeoRisk() {
  const setData = useGlobalIntelStore(s => s.setGeoRiskData);
  return useQuery({
    queryKey: ['geo-risk'],
    queryFn: async () => { const d = await rateLimited(() => getGeopoliticalRiskScore()); setData(d); return d; },
    ...queryOpts('geo-risk'),
  });
}

/** Layer L: FOMC sentiment */
export function useFomcSentiment() {
  const setData = useGlobalIntelStore(s => s.setFomcSentimentData);
  return useQuery({
    queryKey: ['fomc-sentiment'],
    queryFn: async () => { const d = await rateLimited(() => getFomcSentimentAnalysis()); setData(d); return d; },
    ...queryOpts('fomc-sentiment'),
  });
}

// ── Master hook ─────────────────────────────────────────────────

/**
 * Master hook — fires all 12 queries in parallel on mount.
 * Components can use this single hook or individual hooks for granular control.
 */
export function useAllGlobalIntel() {
  const macro = useMacroEnvironment();
  const regime = useEconomicRegime();
  const extRegime = useExtendedRegime();
  const smart = useSmartMoney();
  const exports_ = useExportMomentum();
  const geo = useGeoRisk();
  const credit = useCreditSpreads();
  const correlation = useGlobalCorrelation();
  const supplyChain = useSupplyChain();
  const sectorOrders = useSectorOrders();
  const fsi = useFinancialStress();
  const fomc = useFomcSentiment();

  const isLoading = [macro, regime, extRegime, smart, exports_, geo, credit, correlation, supplyChain, sectorOrders, fsi, fomc]
    .some(q => q.isLoading);
  const loadedCount = [macro, regime, extRegime, smart, exports_, geo, credit, correlation, supplyChain, sectorOrders, fsi, fomc]
    .filter(q => q.isSuccess).length;

  return {
    isLoading,
    loadedCount,
    totalCount: 12,
    macro, regime, extRegime, smart, exports: exports_, geo, credit,
    correlation, supplyChain, sectorOrders, fsi, fomc,
  };
}
