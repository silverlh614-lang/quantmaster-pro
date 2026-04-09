/**
 * TanStack Query hooks for Global Intelligence data fetching.
 *
 * Tier 2 최적화 적용 — 배치 통합 호출 (12개 → 3개):
 * 1. getBatchGlobalIntel()  — macro + regime + extendedRegime + creditSpreads + financialStress + smartMoney
 * 2. getBatchSectorIntel()  — exportMomentum + geoRisk + supplyChain + sectorOrders
 * 3. getBatchMarketIntel()  — globalCorrelation + fomcSentiment
 *
 * Google Search 12회 → 3회로 압축. 공유 컨텍스트로 응답 품질 향상 + 비용 75% 절감.
 * 개별 캐시에도 동시 저장 → 기존 개별 함수 호출 시 캐시 히트 보장.
 */

import { useQuery } from '@tanstack/react-query';
import {
  getBatchGlobalIntel,
  getBatchSectorIntel,
  getBatchMarketIntel,
} from '../services/stockService';
import { useGlobalIntelStore } from '../stores';
import { evaluateGate0, evaluateBearRegime, evaluateVkospiTrigger } from '../services/quantEngine';
import { getStaleTime, PERSIST_GC_TIME } from '../utils/cacheConfig';

/**
 * 모듈 레벨 레이트 리미터.
 * Gemini 무료 티어 RPM 초과 방지 — 배치 3개 호출 사이 최소 2초 간격 보장.
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

// ── Batch 1: 글로벌 거시경제 인텔리전스 ────────────────────────────

/**
 * macro + regime + extendedRegime + creditSpreads + financialStress + smartMoney
 * 6개 AI 호출 → 1회 Google Search로 통합
 */
export function useBatchGlobalIntel() {
  const setMacroEnv = useGlobalIntelStore(s => s.setMacroEnv);
  const addMhsRecord = useGlobalIntelStore(s => s.addMhsRecord);
  const setEconomicRegimeData = useGlobalIntelStore(s => s.setEconomicRegimeData);
  const setExtendedRegimeData = useGlobalIntelStore(s => s.setExtendedRegimeData);
  const setCreditSpreadData = useGlobalIntelStore(s => s.setCreditSpreadData);
  const setFinancialStressData = useGlobalIntelStore(s => s.setFinancialStressData);
  const setSmartMoneyData = useGlobalIntelStore(s => s.setSmartMoneyData);
  const setBearRegimeResult = useGlobalIntelStore(s => s.setBearRegimeResult);
  const setVkospiTriggerResult = useGlobalIntelStore(s => s.setVkospiTriggerResult);

  return useQuery({
    queryKey: ['batch-global-intel'],
    queryFn: async () => {
      const data = await rateLimited(() => getBatchGlobalIntel());

      // macro → Gate 0 평가
      if (data.macro) {
        setMacroEnv(data.macro);
        const g0 = evaluateGate0(data.macro);
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

        // Gate -1: Bear Regime Detector (아이디어 1)
        setBearRegimeResult(evaluateBearRegime(data.macro, g0));

        // VKOSPI 트리거 시스템 (아이디어 4)
        setVkospiTriggerResult(evaluateVkospiTrigger(data.macro.vkospi));
      }

      if (data.regime) setEconomicRegimeData(data.regime);
      if (data.extendedRegime) setExtendedRegimeData(data.extendedRegime);
      if (data.creditSpreads) setCreditSpreadData(data.creditSpreads);
      if (data.financialStress) setFinancialStressData(data.financialStress);
      if (data.smartMoney) setSmartMoneyData(data.smartMoney);

      return data;
    },
    ...queryOpts('macro-environment'), // 분기급 TTL 적용
  });
}

// ── Batch 2: 섹터/무역 인텔리전스 ──────────────────────────────────

/**
 * exportMomentum + geoRisk + supplyChain + sectorOrders
 * 4개 AI 호출 → 1회 Google Search로 통합
 */
export function useBatchSectorIntel() {
  const setExportMomentumData = useGlobalIntelStore(s => s.setExportMomentumData);
  const setGeoRiskData = useGlobalIntelStore(s => s.setGeoRiskData);
  const setSupplyChainData = useGlobalIntelStore(s => s.setSupplyChainData);
  const setSectorOrderData = useGlobalIntelStore(s => s.setSectorOrderData);

  return useQuery({
    queryKey: ['batch-sector-intel'],
    queryFn: async () => {
      const data = await rateLimited(() => getBatchSectorIntel());

      if (data.exportMomentum) setExportMomentumData(data.exportMomentum);
      if (data.geoRisk) setGeoRiskData(data.geoRisk);
      if (data.supplyChain) setSupplyChainData(data.supplyChain);
      if (data.sectorOrders) setSectorOrderData(data.sectorOrders);

      return data;
    },
    ...queryOpts('supply-chain'), // 주간급 TTL 적용
  });
}

// ── Batch 3: 시장 상관관계 & 센티먼트 ──────────────────────────────

/**
 * globalCorrelation + fomcSentiment
 * 2개 AI 호출 → 1회로 통합
 */
export function useBatchMarketIntel() {
  const setGlobalCorrelation = useGlobalIntelStore(s => s.setGlobalCorrelation);
  const setFomcSentimentData = useGlobalIntelStore(s => s.setFomcSentimentData);

  return useQuery({
    queryKey: ['batch-market-intel'],
    queryFn: async () => {
      const data = await rateLimited(() => getBatchMarketIntel());

      if (data.globalCorrelation) setGlobalCorrelation(data.globalCorrelation);
      if (data.fomcSentiment) setFomcSentimentData(data.fomcSentiment);

      return data;
    },
    ...queryOpts('fomc-sentiment'), // 실시간급 TTL 적용
  });
}

// ── Legacy individual hooks (backward compatibility) ───────────────
// 기존 개별 hooks는 배치 호출이 먼저 캐시를 채우므로
// 직접 호출 시에도 캐시 히트로 즉각 응답.

export { useBatchGlobalIntel as useMacroEnvironment };
export { useBatchGlobalIntel as useEconomicRegime };
export { useBatchGlobalIntel as useExtendedRegime };
export { useBatchGlobalIntel as useCreditSpreads };
export { useBatchGlobalIntel as useFinancialStress };
export { useBatchGlobalIntel as useSmartMoney };
export { useBatchSectorIntel as useExportMomentum };
export { useBatchSectorIntel as useGeoRisk };
export { useBatchSectorIntel as useSupplyChain };
export { useBatchSectorIntel as useSectorOrders };
export { useBatchMarketIntel as useGlobalCorrelation };
export { useBatchMarketIntel as useFomcSentiment };

// ── Master hook ─────────────────────────────────────────────────

/**
 * Master hook — fires 3 batch queries (was 12 individual) on mount.
 * 12개 AI 호출 → 3개 배치 호출로 압축.
 * Google Search 12회 → 3회. 소요 시간 24s → ~6s.
 */
export function useAllGlobalIntel() {
  const batch1 = useBatchGlobalIntel();
  const batch2 = useBatchSectorIntel();
  const batch3 = useBatchMarketIntel();

  const allQueries = [batch1, batch2, batch3];
  const isLoading = allQueries.some(q => q.isLoading);

  // 개별 데이터 접근 (기존 인터페이스 호환)
  const loadedCount = allQueries.filter(q => q.isSuccess).length;
  // 3개 배치 중 성공 수를 12개 기준으로 환산 (UI 호환)
  const loadedCountNormalized = allQueries.reduce((acc, q, i) => {
    if (!q.isSuccess) return acc;
    if (i === 0) return acc + 6; // batch1: 6 items
    if (i === 1) return acc + 4; // batch2: 4 items
    return acc + 2;              // batch3: 2 items
  }, 0);

  return {
    isLoading,
    loadedCount: loadedCountNormalized,
    totalCount: 12,
    // Batch 1 데이터
    macro: { ...batch1, data: batch1.data?.macro },
    regime: { ...batch1, data: batch1.data?.regime },
    extRegime: { ...batch1, data: batch1.data?.extendedRegime },
    credit: { ...batch1, data: batch1.data?.creditSpreads },
    fsi: { ...batch1, data: batch1.data?.financialStress },
    smart: { ...batch1, data: batch1.data?.smartMoney },
    // Batch 2 데이터
    exports: { ...batch2, data: batch2.data?.exportMomentum },
    geo: { ...batch2, data: batch2.data?.geoRisk },
    supplyChain: { ...batch2, data: batch2.data?.supplyChain },
    sectorOrders: { ...batch2, data: batch2.data?.sectorOrders },
    // Batch 3 데이터
    correlation: { ...batch3, data: batch3.data?.globalCorrelation },
    fomc: { ...batch3, data: batch3.data?.fomcSentiment },
  };
}
