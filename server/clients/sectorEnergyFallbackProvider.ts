// @responsibility Yahoo 섹터 ETF 기반 sectorEnergy 대체 데이터 소스 (ADR-0364 Phase 1 — pure)
/**
 * sectorEnergyFallbackProvider.ts (ADR-0364 Phase 1) — KRX 미사용 sectorEnergy fallback.
 *
 * 사용자 5/6 명시 — KRX OpenAPI 외부 결함 시 다른 소스로 sectorEnergy 산출.
 * Yahoo Finance 의 KRX 섹터 ETF 일봉 시계열 → 섹터별 4주 수익률 산출.
 *
 * 본 PR scope (Phase 1, dead code):
 *   - KOREAN_SECTOR_ETFS 매핑 SSOT (12 섹터 → KRX 섹터 ETF 심볼)
 *   - buildSectorEnergyFromYahooETF 순수 함수 (호출자 0건 dead code)
 *   - ENV `SECTOR_ENERGY_ETF_FALLBACK_DISABLED=true` 우회
 *
 * 후속 PR (호출자 마이그레이션):
 *   - ADR-0343 의 buildSectorEnergyInputsWithMetaWithFallback 가 macroState 캐시
 *     fallback 실패 시 본 모듈 호출 → 3중 안전망 (KRX → macroState 48h → Yahoo ETF)
 *   - ADR-0125 dataQuality='STALE' 대비 더 신선한 데이터 (Yahoo intraday 가능)
 *
 * 한계:
 *   - volumeChangePct = 0 (ETF 거래량은 섹터 거래량과 다름 — 산출 불가)
 *   - foreignConcentration = 0 (외국인 매매 데이터 ETF 미제공)
 *   - 결과적으로 sectorEnergyEngine 점수가 return4w 단일 축에만 의존
 *   - Phase 1 = Yahoo 일봉 4주 수익률만, 거래량/외국인 보강은 후속 PR
 */

import { fetchDailyBars } from '../trading/marketDataRefresh.js';
import { safePctChange } from '../utils/safePctChange.js';
import type { SectorEnergyInput } from '../../src/types/sectorEnergy.js';
import type { SectorEnergyBuildResult, StrategicSector } from './sectorEnergyProvider.js';

/**
 * 12 섹터 → KRX 섹터 ETF 심볼 SSOT.
 *
 * 사용자 5/6 spec 직접 등재. Yahoo Finance .KS suffix 형식.
 * 향후 ETF 심볼 변경/상장폐지 시 본 매핑만 수정 (호출자 무수정).
 */
export const KOREAN_SECTOR_ETFS: Record<StrategicSector, string> = {
  '반도체':           '091160.KS',  // KODEX 반도체
  '이차전지':         '305720.KS',  // KODEX 이차전지
  '바이오/헬스케어':   '244580.KS',  // KODEX 바이오
  '인터넷/플랫폼':     '364990.KS',  // 메타버스
  '자동차':           '091180.KS',  // KODEX 자동차
  '조선':             '139260.KS',  // TIGER 조선
  '방산':             '449450.KS',  // PLUS K방산
  '금융':             '091170.KS',  // KODEX 은행
  '유통/소비재':       '266390.KS',  // KODEX 유통
  '건설/부동산':       '117700.KS',  // KODEX 건설
  '에너지/화학':       '139250.KS',  // TIGER 에너지화학
  '통신/유틸리티':     '098560.KS',  // TIGER 방송통신
};

/** Yahoo 일봉 range — 1개월 (≈ 21 거래일) 으로 4주 수익률 산출 충분. */
export const ETF_FALLBACK_RANGE = '1mo';
/** 최소 거래일 표본 — 20일 미만 시 산출 보류. */
export const ETF_FALLBACK_MIN_BARS = 20;
/** dataQuality='PARTIAL' 임계 — 8 섹터 이상 산출 시 PARTIAL (그 외 STALE). */
export const ETF_FALLBACK_PARTIAL_THRESHOLD = 8;

/** ENV `SECTOR_ENERGY_ETF_FALLBACK_DISABLED=true` → 우회 (ADR-0157 정확 비교). */
export function isSectorEnergyEtfFallbackDisabled(): boolean {
  return process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED === 'true';
}

/**
 * Yahoo 섹터 ETF 일봉으로 sectorEnergy 입력 산출.
 *
 * 분기 우선순위 SSOT:
 *   1. ENV DISABLED → FAILED + 빈 inputs (호출자 측 분기 보존)
 *   2. 섹터별 fetchDailyBars 호출 — 실패/표본 부족 → 해당 섹터 skip
 *   3. safePctChange 로 4주 수익률 산출 (sanity 위반 시 skip)
 *   4. PARTIAL_THRESHOLD (8) 이상 → PARTIAL / 그 외 STALE / 0 → FAILED
 *
 * 안전 invariant:
 *   - return4w sanity 위반 (>90% 또는 stale base) 자동 skip — ADR-0117 정합
 *   - volumeChangePct + foreignConcentration = 0 fallback (ETF 한계)
 *   - 호출자 0건 dead code — ADR-0343 Phase 2 wiring PR 에서 활성화
 */
export async function buildSectorEnergyFromYahooETF(): Promise<SectorEnergyBuildResult> {
  if (isSectorEnergyEtfFallbackDisabled()) {
    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: 0,
      totalSectorCount: 12,
      reasons: ['ENV SECTOR_ENERGY_ETF_FALLBACK_DISABLED=true'],
    };
  }
  const inputs: SectorEnergyInput[] = [];
  const skippedReasons: string[] = [];
  for (const sector of Object.keys(KOREAN_SECTOR_ETFS) as StrategicSector[]) {
    const etfSymbol = KOREAN_SECTOR_ETFS[sector];
    try {
      const bars = await fetchDailyBars(etfSymbol, ETF_FALLBACK_RANGE);
      if (!bars || bars.length < ETF_FALLBACK_MIN_BARS) {
        skippedReasons.push(`${sector}(${etfSymbol}): bars=${bars?.length ?? 0} < ${ETF_FALLBACK_MIN_BARS}`);
        continue;
      }
      const oldestClose = bars[0].close;
      const newestClose = bars[bars.length - 1].close;
      const ret = safePctChange(newestClose, oldestClose, {
        label: `sectorEnergyEtfFallback.${sector}`,
        sanityBoundPct: 90,
      });
      if (ret === null || !Number.isFinite(ret)) {
        skippedReasons.push(`${sector}(${etfSymbol}): safePctChange null/NaN (sanity 위반 또는 stale base)`);
        continue;
      }
      inputs.push({
        name: sector,
        return4w: ret,
        volumeChangePct: 0,        // ETF 한계 — 후속 PR
        foreignConcentration: 0,   // ETF 한계 — 후속 PR
      });
    } catch (err) {
      skippedReasons.push(`${sector}(${etfSymbol}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const validCount = inputs.length;
  const dataQuality
    = validCount >= ETF_FALLBACK_PARTIAL_THRESHOLD
      ? 'PARTIAL'
      : validCount > 0
        ? 'STALE'
        : 'FAILED';
  return {
    inputs,
    dataQuality,
    validSectorCount: validCount,
    totalSectorCount: 12,
    reasons: [
      'KRX OpenAPI 부재 — Yahoo 섹터 ETF fallback (ADR-0364)',
      ...skippedReasons,
    ],
  };
}
