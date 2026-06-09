// @responsibility macroStateRepo 영속화 저장소 모듈
import fs from 'fs';
import { MACRO_STATE_FILE, ensureDataDir } from './paths.js';
import type { SectorEnergyInput, SectorEnergyResult } from '../../src/types/sectorEnergy.js';
import type { FssRecordsAgeInfo } from './fssRepo.js';
import type { GroupedSectorEnergySnapshot } from '../clients/groupedSectorEnergyProvider.js';

export interface MacroState {
  mhs: number;        // Macro Health Score (0~100)
  regime: string;     // 'GREEN' | 'YELLOW' | 'RED'
  updatedAt: string;  // ISO
  /** Runtime market session associated with the latest successful macro snapshot. */
  marketSessionState?: string;
  // 아이디어 10: Bear Regime 보조 지표 (optional — 클라이언트에서 전달 시 저장)
  vkospi?: number;                  // 한국 변동성 지수
  foreignFuturesSellDays?: number;  // 외국인 선물 연속 순매도 일수
  iri?: number;                     // IRI 위험 지표 델타 (pt) — bearRegimeAlert IRI 라인 표시용 (cron writer 부재 시 'N/A')
  // 아이디어 11: IPS 변곡점 엔진 보조 지표 (optional)
  vix?: number;                     // VIX 공포지수
  mhsTrend?: 'IMPROVING' | 'STABLE' | 'DETERIORATING'; // MHS 추세
  vkospiRising?: boolean;           // VKOSPI 상승 추세
  bearRegimeTriggeredCount?: number; // Bear Regime 발동 조건 수 — ipsAlert FSS 음수 +20% 가산점 (cron writer 부재 시 0 fallback)
  bearDefenseMode?: boolean;        // Bear 방어 모드 여부
  oeciCliKorea?: number;            // OECD 경기선행지수 한국 — ipsAlert TMA 감속 신호 (cron writer 부재 시 100 fallback)
  exportGrowth3mAvg?: number;       // 수출 증가율 3개월 이동평균 (%)
  dxyBullish?: boolean;             // DXY 달러 강세 여부
  kospiBelow120ma?: boolean;        // KOSPI 120일선 하회 여부
  ips?: number;                     // 마지막 IPS 점수 (캐시)
  fss?: number;                     // 마지막 FSS 누적 점수 (캐시)
  fssAlertLevel?: 'NORMAL' | 'CAUTION' | 'HIGH_ALERT'; // FSS 경보 단계
  // ─── RegimeVariables 7축 매핑용 (optional — 클라이언트 전달 시 저장) ──────
  vkospiDayChange?: number;         // VKOSPI 당일 변화율
  vkospiPrevClose?: number;         // VKOSPI 전일 종가 (서버 계산 SSOT)
  vkospiDayChangeComputed?: number; // 서버 직접 계산 당일 변화율
  vkospiDayChangeSource?: string;   // VKOSPI 당일 변화율 계산 소스 (진단용)
  vkospi5dTrend?: number;           // VKOSPI 5일 추세 (양수=상승)
  /**
   * ADR-0584: VKOSPI 신선도 추적 — silent stale 차단(다른 지표엔 *FetchedAt 있으나 VKOSPI만 부재였음).
   * vkospiBaseDate  = KRX 일별 행의 거래일(BAS_DD, YYYYMMDD) — 기존엔 버려지던 값 영속.
   * vkospiFetchedAt = 마지막 VKOSPI fetch 성공 시각(ISO). carry-forward(fetch 실패) 시 갱신 안 됨.
   */
  vkospiBaseDate?: string;
  vkospiFetchedAt?: string;
  usdKrw?: number;                  // 원달러 환율
  usdKrw20dChange?: number;         // 원달러 20일 변화율
  usdKrwDayChange?: number;         // 원달러 당일 변화율
  /** ADR-0071: usdKrw 가 어느 소스에서 왔는지 (Yahoo 'PRIMARY' / ECOS 'SECONDARY'). */
  usdKrwSource?: 'PRIMARY' | 'SECONDARY' | null;
  /** ADR-0071: Yahoo vs ECOS 격차 % (한쪽 미수집 시 null). */
  usdKrwDivergencePct?: number | null;
  /** ADR-0071: 분기 결과 tier — AGREED/WARN/CRITICAL/PRIMARY_ONLY/SECONDARY_ONLY/NO_DATA. */
  usdKrwDivergenceTier?: string;
  foreignNetBuy5d?: number;         // 외국인 순매수 5일 누적 (억원)
  /**
   * ADR-0136: 격상 *boolean → boolean | null*. null = STALE/MISSING 으로 평가
   * 자체 불가 (페르소나 의사결정에서 *데이터 결손* 과 *시그널 부재* 구분).
   * `regimeBridge.buildRegimeVars` 에서 `?? false` fallback 으로 RegimeVariables
   * 시그니처 (boolean) 후방호환 유지.
   */
  passiveActiveBoth?: boolean | null;
  /**
   * ADR-0136: FSS 레코드 신선도 진단 — `/fss_status` 텔레그램 명령 + 후속
   * 의사결정 wiring 의 데이터 입력. `marketDataRefresh.refreshMarketRegimeVars`
   * 가 매 사이클 갱신.
   */
  fssRecordsAge?: FssRecordsAgeInfo;
  /**
   * ADR-0141 Stage 1: KRX 11분류 raw fetcher 마지막 갱신 시각 (ISO).
   */
  fssDetailFetchedAt?: string;
  /**
   * ADR-0141 Stage 1: 마지막 갱신 출처 — silent degradation 차단 마커.
   *   - 'KRX_BLD' : 정상 갱신
   *   - 'NONE'    : 마지막 cron 사이클 KRX 호출 실패 (기존 영속 보존)
   */
  fssDetailSource?: 'KRX_BLD' | 'NONE';
  /**
   * ADR-0138: KIS 시장 종합 프로그램 매매 추이 — 코스피 시장 단위 프로그램 자금 흐름.
   * `marketDataRefresh.refreshMarketRegimeVars` 가 매 사이클 갱신, 실패 시 기존 값 보존.
   *
   * 단위 환산: KIS 응답은 원 단위 → macroState 는 *억원* 환산 (다른 macroState
   * 자금 흐름 필드 (foreignNetBuy5d) 와 단위 정합).
   *
   * - programNetBuyAmount      : 시장 전체 프로그램 순매수 금액 (억원, 양수=순매수)
   * - programArbitrageNetBuy   : 차익거래 순매수 (억원). 부재 시 null
   *                             (강제 0 fallback 차단 — ADR-0136 의미 단절 정책 정합)
   * - programFetchedAt         : KIS 응답 시각 (ISO) — `/program_market` 신선도
   * - programSource            : 'KIS_API' (정상) / 'NONE' (마지막 갱신 실패)
   */
  programNetBuyAmount?: number;
  programArbitrageNetBuy?: number | null;
  programFetchedAt?: string;
  programSource?: 'KIS_API' | 'NONE';
  programMarket?: {
    status: 'OK_NONZERO' | 'OK_RAW_ZERO' | 'OK_EMPTY_OUTPUT' | 'PROVIDER_ERROR' | 'UNSUPPORTED_INTRADAY' | string;
    rawStatus?: string;
    snapshotId?: string;
    finalStatus: string;
    source: 'KIS_API' | 'KRX_API' | 'CACHE' | 'NONE' | string;
    paramMode: 'OFFICIAL' | 'LEGACY' | string;
    asOfKst: string;
    selectedBsopHour: string;
    selectedReason: 'LATEST_BY_BSOP_HOUR' | 'LATEST_ROW_ALL_ZERO' | 'EMPTY_OUTPUT' | 'NO_VALID_ROW' | string;
    raw: {
      wholeNetBuyTradeAmount: number | null;
      arbitrageNetBuyTradeAmount: number | null;
      nonArbitrageNetBuyTradeAmount: number | null;
      arbitrageSellAmount: number | null;
      nonArbitrageSellAmount: number | null;
      arbitrageBuyAmount: number | null;
      nonArbitrageBuyAmount: number | null;
    };
    display: {
      wholeNetBuy: string;
      arbitrageNetBuy: string;
      nonArbitrageNetBuy: string;
    };
    unit: {
      rawUnitAssumption: 'UNVERIFIED' | 'KRW' | 'KRW_1K' | 'KRW_1M';
      displayUnit: 'EOK_KRW';
      mappingConfidence: 'UNIT_UNVERIFIED' | 'MAPPING_VERIFIED';
    };
    unitCandidates?: {
      KRW: string;
      KRW_1K: string;
      KRW_1M: string;
    };
    combinedSource?: 'KOSPI_PLUS_KOSDAQ' | 'SINGLE_RESPONSE' | 'CACHE' | 'UNKNOWN' | string;
    snapshotSource?: 'KOSPI_PLUS_KOSDAQ' | 'SINGLE_RESPONSE' | 'CACHE' | 'UNKNOWN' | string;
    splitAvailable?: boolean;
    combinedOnly?: boolean;
    snapshotMismatch?: boolean;
    inconsistencyReason?: string | null;
    aggregateDiagnostic?: Record<string, unknown>;
    rowBreakdown?: {
      kospi: {
        outputLength: number; nonZeroRows: number; selectedBsopHour: string;
        rawWholeNetBuy: number | null; rawArbitrageNetBuy: number | null; rawNonArbitrageNetBuy: number | null;
        displayWholeNetBuy: string; unitCandidates: { KRW: string; KRW_1K: string; KRW_1M: string } | null;
      };
      kosdaq: {
        outputLength: number; nonZeroRows: number; selectedBsopHour: string;
        rawWholeNetBuy: number | null; rawArbitrageNetBuy: number | null; rawNonArbitrageNetBuy: number | null;
        displayWholeNetBuy: string; unitCandidates: { KRW: string; KRW_1K: string; KRW_1M: string } | null;
      };
      combined: {
        outputLength: number; nonZeroRows: number; selectedBsopHour: string;
        rawWholeNetBuy: number | null; rawArbitrageNetBuy: number | null; rawNonArbitrageNetBuy: number | null;
        displayWholeNetBuy: string; unitCandidates: { KRW: string; KRW_1K: string; KRW_1M: string };
      };
    };
    policy: {
      scoring: 'excluded' | 'shadow_only' | 'advisory' | 'weighted';
      useForExecution: false;
      useForShadow: true;
      executionImpact: 'NONE';
      providerIssue: false;
      marketSignal: false;
      blockGateUsage?: true;
      blockRegimeUsage?: true;
    };
    rawNonZero?: boolean;
  };
  kospiAbove20MA?: boolean;         // KOSPI 20일선 위
  kospiAbove60MA?: boolean;         // KOSPI 60일선 위
  kospi20dReturn?: number;          // KOSPI 20일 수익률
  kospiDayReturn?: number;          // KOSPI 당일 수익률
  /** R6 forensic: KOSPI close-to-prev-close return (%). Defaults to kospiDayReturn if absent. */
  kospiCloseReturn?: number;
  /** R6 forensic: KOSPI intraday low return vs previous close (%). */
  kospiIntradayLowReturn?: number;
  /** R6 forensic: KOSPI intraday high return vs previous close (%). */
  kospiIntradayHighReturn?: number;
  /** R6 forensic: KOSPI trigger source freshness timestamp (ISO). */
  kospiTriggerSourceUpdatedAt?: string;
  /** ADR-0592: R6 trigger 봉의 KRX 거래일(YYYY-MM-DD KST). age-only freshness 오판 차단용. */
  kospiTriggerSourceTradeDate?: string;
  /** ADR-0592: 오늘 KOSPI 현재가 vs 전일종가 수익률(%). KIS 종합지수(L1) intraday. flag OFF 시 미설정. */
  kospiIntradayReturn?: number;
  /** ADR-0592: kospiIntradayReturn 소스 거래일(YYYY-MM-DD KST) — 오늘 아니면 recovery 미사용. */
  kospiIntradaySourceTradeDate?: string;
  /** ADR-0592: kospiIntradayReturn 마지막 KIS fetch 성공 시각(ISO). carry-forward 시 갱신 안 됨. */
  kospiIntradayFetchedAt?: string;
  /** ADR-0593: KOSPI 종합지수(0001) 응답 상승종목수(ascn_issu_cnt) — risk-on fast-upgrade breadth. 부재 시 미설정(보수). */
  kospiAdvanceCount?: number;
  /** ADR-0593: KOSPI 종합지수(0001) 응답 하락종목수(down_issu_cnt) — risk-on fast-upgrade breadth. 부재 시 미설정(보수). */
  kospiDeclineCount?: number;
  /** ADR-0593: breadth(등락종목수) 마지막 KIS fetch 성공 시각(ISO). intraday quote 와 동일 D2 경로. */
  kospiBreadthFetchedAt?: string;
  leadingSectorRS?: number;         // 선행 섹터 상대강도 (0~100)
  sectorCycleStage?: 'EARLY' | 'MID' | 'LATE' | 'TURNING'; // 섹터 사이클
  marginBalance5dChange?: number;   // 신용잔고 5일 변화율 (ADR-0139)
  /**
   * ADR-0139: marginBalance5dChange 갱신 시각 (ISO) — `/margin_balance` 신선도.
   */
  marginBalanceFetchedAt?: string;
  /**
   * ADR-0139: 마지막 갱신 출처 — silent degradation 차단 마커 (ADR-0136 정합).
   *   - 'ECOS_API' : ECOS 공식 데이터로 정상 갱신
   *   - 'NONE'     : 마지막 cron 사이클 ECOS 호출 실패 (기존 값 보존)
   */
  marginBalanceSource?: 'ECOS_API' | 'NONE';
  shortSellingRatio?: number;       // 공매도 비율 (%)
  /**
   * Phase 1 — 어느 fallback 단계에서 데이터를 얻었는지.
   *   - KRX_DIRECT / KRX_OTP : KRX 공식 (L1)
   *   - KIS_PROXY            : KIS daily-short-sale 시장-프록시 ETF 비중 (L1, ADR-0543)
   *   - KIS_ESTIMATE         : KIS 잔고 상위 가중 평균 추정 (L4 휴리스틱 — live 임계 평가 제외)
   *   - CACHE                : /ssb 수동 백필 (L4 — live 임계 평가 제외, ADR-0543 타입 정식화)
   */
  shortSellingSource?: 'KRX_DIRECT' | 'KRX_OTP' | 'KIS_PROXY' | 'KIS_ESTIMATE' | 'CACHE';
  /** Phase 1 — 마지막 조회 성공 시각 (ISO) — /health 신선도 표시용. */
  shortSellingFetchedAt?: string;
  spxDayReturn?: number;            // S&P500 당일 수익률 (미국 장 마감 기준)
  nasdaqDayReturn?: number;         // 나스닥 당일 수익률 (미국 장 마감 기준)
  spx20dReturn?: number;            // S&P500 20일 수익률
  dxy5dChange?: number;             // 달러인덱스 5일 변화율
  // ─── 글로벌 스캔 에이전트 선행 레이어 필드 ──────────────────────────────────
  vixHistory?: number[];            // VIX 일별 종가 이력 (최신 → 인덱스 마지막, 최대 5개)
  ewyDayChange?: number;            // EWY 전일 대비 변화율 (%) — Layer 13 외국인 수급 선행
  // ─── FRED 거시 지표 (marketDataRefresh.ts 자동 갱신) ────────────────────────
  yieldCurve10y2y?: number;         // T10Y2Y: 장단기 금리차 (%) — 음수 시 침체 6~18개월 선행
  hySpread?: number;                // BAMLH0A0HYM2: US HY 스프레드 (%) — 신용 위험 프록시
  sofr?: number;                    // SOFR: 달러 단기 기준금리 프록시 (%)
  financialStress?: number;         // STLFSI4: 세인트루이스 금융스트레스 지수 (0 기준, 양수 = 스트레스)
  wtiCrude?: number;                // DCOILWTICO: WTI 유가 (USD/배럴) — 수출주/정유 영향
  // ─── 레짐 승급 보조 필드 (marketDataRefresh 자동 갱신) ──────────────────────
  kospiAboveMA20Pct?: number;       // KOSPI가 MA20 대비 몇 % 위에 있는지
  foreignContinuousBuyDays?: number; // 외국인 연속 순매수 일수
  // ─── ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점 SSOT ─────────────────
  /**
   * marketDataRefresh 가 evaluateSectorEnergy() 결과를 영속화한 스냅샷.
   * entryEngine 의 Gate Score 산출 시점에 read 만 — applySectorScoreBoost() 입력.
   * 갱신 실패/입력 부재 시 undefined → 보너스 0 (안전 fallback).
   *
   * sectorEnergyEngine 결과는 캘린더일 1회 단위 변동 — 1분 cron 매번 갱신 부담은
   * 회피하고, marketDataRefresh 의 일일 사이클 (장 마감 후)에서만 갱신한다.
   */
  sectorEnergyResult?: SectorEnergyResult;
  /** sectorEnergyResult 마지막 갱신 시각 (ISO) — /regime 메시지 신선도 표시용. */
  sectorEnergyUpdatedAt?: string;
  /**
   * ADR-0125 (PR-1 후속): sectorEnergy 데이터 품질 — buildSectorEnergyInputsWithMeta
   * 결과의 dataQuality 영속. applySectorScoreBoost 가 read 후 OK/PARTIAL/STALE/FAILED
   * 분기로 boost 강도 분기.
   *   - OK     → boost full (기본)
   *   - PARTIAL→ boost × 0.5 → Math.round
   *   - STALE  → boost 0 (단, sectorEnergyResult 는 이전 캐시 보존됨 — reference 표시)
   *   - FAILED → boost 0
   */
  sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';
  /** ADR-0125: 12 섹터 중 유효 (returns.length>0) 섹터 수 — /scan_blockers 진단용. */
  sectorEnergyValidSectorCount?: number;
  /** ADR-0125: dataQuality 분류 사유 (debug용). 빈 배열 가능. */
  sectorEnergyReasons?: string[];
  /**
   * ADR-0396 (= 사용자 명시 ADR-0371): 4-axis 분리 영속 — sourceTier / freshness / coverage / confidence.
   * 기존 영속 데이터 (sectorEnergyDataQuality 단일 라벨) 그대로 보존 — 사용자 4/30 정책
   * "강제 마이그레이션 금지" 정합. 신규 영속 시점부터 본 4 필드 동시 영속 + 호출자 read SSOT.
   *
   * - sourceTier: 'KRX_CODE' | 'STOCK_DAILY' | 'CACHE' | 'YAHOO_ETF' | 'FAILED'
   * - freshness: 'FRESH' | 'DEGRADED' | 'EXPIRED' (cache age 30분/4h 임계)
   * - coverage: validSectorCount / totalSectorCount, 0~1
   * - confidence: sourceWeight × freshnessWeight × coverage, 0~1 (clamp)
   */
  sectorEnergySourceTier?:
    | 'KIS_OFFICIAL_INDEX'
    | 'KIS_OFFICIAL_DAILY'
    | 'KIS_STOCK_BASKET_DERIVED'
    | 'KIS_SECTOR_INDEX_DAILY_DRYRUN'
    | 'KRX_OFFICIAL_INDEX'
    | 'KRX_CODE'
    | 'STOCK_DAILY'
    | 'CACHE'
    | 'YAHOO_GLOBAL_PROXY'
    | 'YAHOO_ETF'
    | 'INTERNAL_PROXY'
    | 'MISSING'
    | 'FAILED';
  /** ADR-0396: cache age 기반 freshness 분기. */
  sectorEnergyFreshness?: 'FRESH' | 'DEGRADED' | 'EXPIRED';
  /** ADR-0396: 12 섹터 중 유효 비율 (0~1, clamp). */
  sectorEnergyCoverage?: number;
  /** ADR-0396: 합성 confidence (sourceWeight × freshnessWeight × coverage, 0~1 clamp). */
  sectorEnergyConfidence?: number;
  /**
   * ADR-0399 (= 사용자 명시 ADR-0374): KRX 원천 복구 진단 메타.
   *
   * 운영자 `/sector_energy_diag` 명령에서 *어느 layer 가 작동했는지* 추적용:
   *   - candidateDates: T → T-1 → T-2 → T-3 → T-5 시도한 날짜 후보
   *   - sourceTierAttempts: 4-tier (KRX_CODE/STOCK_DAILY/CACHE/YAHOO_ETF) 별 시도 결과
   *   - finalSourceTier: 최종 채택 tier
   *   - confidence: ADR-0396 합성 confidence
   *   - fallbackReason: L4 도달 사유 (KRX 실패 + cache 부재/EXPIRED 등)
   *
   * 사용자 명시 9 핵심 원칙 #9 — fallback 작동 시 UI 와 diagnostics 에 반드시 표시.
   * 옵셔널 필드 — 후방호환 (ADR-0399 이전 영속 데이터 그대로 보존).
   */
  sectorEnergyDiagnostics?: {
    candidateDates: string[];
    sourceTierAttempts: Array<{
      tier:
        | 'KIS_OFFICIAL_INDEX'
        | 'KIS_OFFICIAL_DAILY'
        | 'KIS_STOCK_BASKET_DERIVED'
    | 'KIS_SECTOR_INDEX_DAILY_DRYRUN'
        | 'KIS_SECTOR_INDEX_DAILY_DRYRUN'
        | 'KRX_OFFICIAL_INDEX'
        | 'KRX_CODE'
        | 'STOCK_DAILY'
        | 'CACHE'
        | 'YAHOO_GLOBAL_PROXY'
        | 'YAHOO_ETF'
        | 'INTERNAL_PROXY'
        | 'MISSING'
        | 'FAILED';
      validCount: number;
      reason?: string;
    }>;
    finalSourceTier:
      | 'KIS_OFFICIAL_INDEX'
      | 'KIS_OFFICIAL_DAILY'
      | 'KIS_STOCK_BASKET_DERIVED'
    | 'KIS_SECTOR_INDEX_DAILY_DRYRUN'
      | 'KRX_OFFICIAL_INDEX'
      | 'KRX_CODE'
      | 'STOCK_DAILY'
      | 'CACHE'
      | 'YAHOO_GLOBAL_PROXY'
      | 'YAHOO_ETF'
      | 'INTERNAL_PROXY'
      | 'MISSING'
      | 'FAILED';
    confidence: number;
    fallbackReason?: string;
    coverageBreakdown?: {
      totalSectors: number;
      verifiedIndexCodeCount: number;
      verifiedIndexCodeCoverage: number;
      kisOfficialCount: number;
      kisOfficialCoverage: number;
      kisBasketCount: number;
      kisBasketCoverage: number;
      internalProxyCount: number;
      internalProxyCoverage: number;
      stockDailyFallbackCount: number;
      stockDailyFallbackCoverage: number;
      yahooGlobalProxyCount: number;
      yahooGlobalProxyCoverage: number;
    };
    leadershipConfidence?: 'WEIGHTED' | 'READY_FOR_SHADOW' | 'PARTIAL' | 'GLOBAL_DIAGNOSTIC_ONLY' | 'DIAGNOSTIC_ONLY' | 'BLOCKED';
    selectedSectors?: string[];
    providerIssue?: boolean;
    marketSignal?: false;
    liveExecutionAllowed?: false;
    executionImpact?: 'NONE';
  };
  /**
   * ADR-0423: SectorEnergy 데이터 진실성 진단 (옵셔널, 후방호환).
   *
   * 기존 sectorEnergyDataQuality / sectorEnergyValidSectorCount / sectorEnergyReasons 의
   * *구조화* 격상 — indexCodeCoverage / missingIndexCodeCount / symmetryValidationPassed /
   * fallbackUsed / 12-value reasons union / shouldBlockLeadershipConfidence /
   * operatorMessage 추가. /sector_energy_diag + /scan_blockers 가 read.
   *
   * 영속 schema 는 sectorEnergyQualityDiagnostic.ts SSOT 와 정합 — 변경 시 동시 갱신.
   */
  sectorEnergyQualityDiagnostic?: {
    dataQuality: 'OK' | 'PARTIAL' | 'PARTIAL_VOLUME' | 'STALE' | 'DEGRADED' | 'FAILED';
    reasons: string[];
    validSectorCount: number;
    expectedSectorCount: number;
    indexCodeCoverage: number;
    missingIndexCodeCount: number;
    totalSectorRows: number;
    sourceTier?: string;
    fallbackUsed: 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE';
    symmetryValidationPassed: boolean;
    shouldBlockLeadershipConfidence: boolean;
    operatorMessage: string;
    /** SECTOR-CLASSIFICATION-SNAPSHOT — internal grouped energy, shadow/advisory only. */
    groupedSectorEnergy?: GroupedSectorEnergySnapshot;
    /** ADR-0424: indexCode 백필로 회복된 row 수 (옵셔널, 후방호환). */
    indexCodeBackfilledCount?: number;
    /** ADR-0424: 수리 상태 분류 (옵셔널, 후방호환). */
    repairStatus?: 'RECOVERED' | 'PARTIAL' | 'STILL_STALE' | 'NOT_NEEDED';
    /**
     * ADR-0446 Phase 2: indexCode recovery 분해 (옵셔널, 후방호환).
     *
     * SECTOR_INDEX_MASTER alias 매칭 위에서 *missing row 의 진짜 원인* 을 row 단위로
     * 분해. 11-value missingReasonBreakdown + topMissingIndexNames + ambiguousAliases
     * + sourceTierBreakdown + recoveryStatus + leadershipConfidence.
     */
    sectorIndexRecovery?: {
      totalRows: number;
      rowsWithIndexCode: number;
      rowsMissingIndexCode: number;
      beforeIndexCodeCoverage: number;
      afterIndexCodeCoverage: number;
      backfilledByNameLookup: number;
      backfilledByAliasExpansion: number;
      stillMissing: number;
      missingReasonBreakdown: Record<string, number>;
      topMissingIndexNames: Array<{ rawName: string; normalizedName: string; count: number; reason: string }>;
      ambiguousAliases: Array<{ normalizedName: string; candidates: string[] }>;
      sourceTierBreakdown: Record<string, number>;
      recoveryStatus: 'RECOVERED' | 'PARTIAL' | 'STILL_STALE' | 'NOT_NEEDED';
      leadershipConfidence: 'OK' | 'DEGRADED' | 'BLOCKED';
      fallbackUsed: 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE';
      symmetryValidationPassed: boolean;
      sanityViolationCount: number;
      /**
       * ADR-0447: alias 확장으로 backfill 된 row 수 (옵셔널 후방호환).
       * Provider 가 normalize 후 alias 매칭으로 indexCode 회복 시 카운트.
       */
      aliasExpansionRecovered?: number;
      /**
       * ADR-0447: aggregate row 자동 분리 카운트 (옵셔널 후방호환).
       * `missingReasonBreakdown.NON_SECTOR_AGGREGATE_ROW` 와 동일 — 운영자 즉시 확인용.
       */
      nonSectorAggregateIgnored?: number;
      /**
       * ADR-0447: alias 확장으로 새로 매칭된 alias Top N (옵셔널 후방호환).
       * raw 값 / token / private metadata 영속 절대 금지 — schema 5 필드만.
       */
      topRecoveredAliases?: Array<{
        indexName: string;
        normalizedName: string;
        sectorKey: string;
        displayName: string;
        count: number;
      }>;
    };
    /**
     * ADR-0447: top-level 격상 (옵셔널, 후방호환).
     *
     * sectorIndexRecovery 안에 동일 필드 영속됨 — top-level 은 빠른 운영자 진단용.
     */
    aliasExpansionRecovered?: number;
    nonSectorAggregateIgnored?: number;
    topRecoveredAliases?: Array<{
      indexName: string;
      normalizedName: string;
      sectorKey: string;
      displayName: string;
      count: number;
    }>;
    /**
     * KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: KRX 섹터 indexCode raw 입력 부검 (옵셔널, 후방호환).
     *
     * `verifiedIndexCodeCoverage=0%` 의 정확한 break point — KRX raw row 가 IDX_IND_CD /
     * indexName 을 갖는지, alias lookup 실패 원인, backfill 호출 여부, sourceTier 가 왜
     * KIS_STOCK_BASKET_DERIVED 로 떨어지는지를 row 단위로 분해. 진단 전용 — 매매 영향 0.
     *
     * raw 값 / token / private metadata 영속 절대 금지 — sample 배열은 진단 한도
     * (sampleIndexNames ≤20, sampleIndexCodes ≤20, sampleUnresolvedNames ≤20,
     * sampleRawKeysTop ≤30) 안에서 indexName / indexCode / key 명만 복사.
     */
    krxSectorIndexRaw?: {
      breakPoint: string;
      totalRawRows: number;
      rowsWithIndexCode: number;
      rowsWithIndexName: number;
      rowsMissingCodeButHaveName: number;
      rowsMissingCodeAndName: number;
      indexCodeInMasterCount: number;
      aliasResolvableCount: number;
      unresolvedIndexNameCount: number;
      backfillInvoked: boolean;
      backfilledCount: number;
      finalSourceTier: string;
      sampleIndexNames: string[];
      sampleIndexCodes: string[];
      sampleUnresolvedNames: string[];
      sampleRawKeysTop: Array<{ key: string; count: number }>;
      operatorHint: string;
      executionImpact: 'NONE';
      liveExecutionAllowed: false;
    };
    /**
     * ADR-0446: sanity violation 진단 (옵셔널, 후방호환).
     *
     * 단순 console.warn 로그였던 sanity violation (sector pct > 30% / stockVolume >
     * 1000% / stockReturn > 90% / base 0/tiny) 을 *구조화된 진단* 으로 집계.
     * 7-value union + sector vs stock 분리 + topViolating + confidenceImpact.
     */
    sanityViolation?: {
      totalViolations: number;
      sectorPctViolations: number;
      stockVolumeViolations: number;
      stockReturnViolations: number;
      topViolatingSectors: Array<{ sector: string; pct: number; bound: number; count: number }>;
      topViolatingStocks: Array<{ code: string; metric: 'stockVolume' | 'stockReturn'; pct: number; current?: number; base?: number; reason: string }>;
      baseZeroOrTinyCount: number;
      staleBaselineCount: number;
      sourceTierBreakdown: Record<string, number>;
      confidenceImpact: 'NONE' | 'DEGRADED' | 'BLOCKED';
      stockDailyTaintedMarker: boolean;
    };
  };
  /**
   * ADR-0343 — sectorEnergy build 입력 (SectorEnergyInput[]) 영속.
   *
   * `buildSectorEnergyInputsWithMeta` 가 OK/PARTIAL 시 inputs 배열 영속 → FAILED 진입 시
   * `buildSectorEnergyInputsWithMetaWithFallback` wrapper 가 직전 캐시 read 후 STALE 마커
   * 부여 반환. KRX OpenAPI 일시 장애 / 휴장일 클러스터 진입 시 sectorScoreBoost 영구
   * 비활성 결함 차단.
   *
   * 본 PR Phase 1 — 영속 schema 만 추가. saver wiring (`buildSectorEnergyInputsWithMeta`
   * 성공 분기에서 영속) 은 후속 PR (회귀 위험 격리).
   */
  sectorEnergyInputs?: SectorEnergyInput[];
  /** ADR-0343 — sectorEnergyInputs 마지막 갱신 시각 (ISO). */
  sectorEnergyInputsUpdatedAt?: string;
  /**
   * MHS 4-axis 분해 (interestRate / liquidity / economy / risk).
   * macroIndexEngine.computeMacroIndex 의 idx.axis 결과 — 사용자 진단 (4/29):
   * "MHS 70 을 벗어난 적이 없다" — axis 분해 노출로 변동성 가시화.
   * 각 axis 는 0~25 범위, 합산 = mhs.
   */
  mhsAxis?: {
    interestRate: number;
    liquidity: number;
    economy: number;
    risk: number;
  };
  /** mhsAxis 마지막 갱신 시각 — `marketDataRefresh` 사이클 종료 시점. */
  mhsAxisUpdatedAt?: string;
  /**
   * ADR-0583: MHS 소스 저하(degrade) 가시화 — computeMacroIndex().sourcesOk 영속.
   * FRED 미연결 등 L2 소스 결손 시에도 MHS 가 정상처럼(예: 75 GREEN) 표시되던 silent
   * degradation 차단. `marketDataRefresh` 가 매 사이클 deriveMhsDegrade(idx.sourcesOk) 로
   * 도출 후 영속, `/regime` 표시 + confluence MHS 가드(flag-gated)가 read.
   *   - mhsSourcesOk : { ecos, fred } 각 소스 응답 여부
   *   - mhsConfidence: 'FULL'(양쪽) | 'PARTIAL'(한쪽 결손) | 'FALLBACK'(전면 결손→MHS 50)
   *   - mhsDegraded  : confidence !== 'FULL'
   */
  mhsSourcesOk?: { ecos: boolean; fred: boolean };
  mhsConfidence?: 'FULL' | 'PARTIAL' | 'FALLBACK';
  mhsDegraded?: boolean;
  /** macroState refresh diagnostics — scheduler/manual refresh observability. */
  lastRefreshAttemptAt?: string;
  lastRefreshSuccessAt?: string;
  lastRefreshError?: string;
  refreshJobEnabled?: boolean;
  refreshJobLastRunAt?: string;
  refreshBlockedReason?: string;
  providerUsed?: string;
  fallbackUsed?: boolean | string;
  writeSucceeded?: boolean;
  updatedAtChanged?: boolean;
}



export function loadMacroState(): MacroState | null {
  ensureDataDir();
  if (!fs.existsSync(MACRO_STATE_FILE)) {
    const defaultState: MacroState = {
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(defaultState, null, 2));
    return defaultState;
  }
  try { return JSON.parse(fs.readFileSync(MACRO_STATE_FILE, 'utf-8')); } catch { return null; }
}

export function saveMacroState(state: MacroState): void {
  ensureDataDir();
  fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(state, null, 2));
}
