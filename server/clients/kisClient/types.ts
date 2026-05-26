/**
 * @responsibility KIS 클라이언트 도메인 타입 SSOT — 옵션·flow·holding·order 결과 인터페이스
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 타입 격리.
 * 모든 도메인 모듈 (auth/http/query/holdings/orders/overrides) 이 본 파일을 참조.
 * 의존 0 — 외부 import 없이 순수 타입만.
 */

/**
 * ADR-0014 — KIS POST 호출의 idempotency 분류.
 *
 * - 'unsafe' (default): 주문/취소 등 mutate 호출. 5xx 재시도 차단 — KIS 매칭엔진이
 *   주문을 받았는지 확인할 방법이 없어 재시도 시 중복 주문 위험.
 * - 'safe': read-only POST (현재 코드베이스에는 해당 없음, 향후 확장용).
 *
 * 401/429/네트워크 에러는 두 분류 모두 안전 재시도 — KIS 매칭엔진 미진입 확정.
 */
export type KisPostIdempotency = 'safe' | 'unsafe';

export interface KisPostOptions {
  /** 기본 'unsafe' (주문 안전 우선). 명시 안 하면 5xx 재시도 차단. */
  idempotency?: KisPostIdempotency;
}

export interface KisInvestorFlow {
  foreignNetBuy:       number;  // 외국인 당일 순매수량 (주)
  institutionalNetBuy: number;  // 기관 당일 순매수량 (주)
  individualNetBuy?:   number;  // 개인 당일 순매수량 (주), missing is not zero-filled
  source: 'KIS_API';
  actualRows?: KisInvestorFlowRawRow[];
}


/**
 * ADR-0137 — 종목별 당일 프로그램 매매 (comp-program-trade-today).
 *
 * KIS Open API 의 `/uapi/domestic-stock/v1/quotations/comp-program-trade-today` 응답.
 * 페르소나 자료 #6 — *외국인 프로그램/비프로그램* 시그널의 데이터 입력.
 *
 * - programNetBuyQty : 프로그램 순매수 수량 (주, 양수=순매수 / 음수=순매도)
 * - programNetBuyAmount : 프로그램 순매수 금액 (원, 단위 KRW)
 * - programBuyRatio : 프로그램 매수 비중 (%) — 응답 부재 시 null
 * - source : 본 PR 인프라는 데이터 페치만, 의사결정 wiring 후속 PR.
 *
 * KIS 응답 필드명 (한글 약어):
 *   - prgm_ntby_qty / prgm_ntby_qty_2 : 프로그램 순매수량
 *   - prgm_ntby_tr_pbmn               : 프로그램 순매수 거래대금
 *   - prgm_byov_rate                  : 프로그램 매수 비중
 *
 * fetchedAt : 응답 수신 시각 (ISO) — 캐시 stale 판정용.
 */
export interface KisStockProgramTrade {
  stockCode: string;
  programNetBuyQty?: number;
  programNetBuyAmount?: number;
  programBuyRatio: number | null;
  fetchedAt: string;
  source: 'KIS_API';
}

/**
 * ADR-0138 — 시장 종합 프로그램 매매 추이 (코스피 시장 단위).
 *
 * KIS Open API 의 시장 단위 프로그램 매매 endpoint 응답.
 * ADR-0137 종목별 데이터와 *별도* — 시장 전체 방향성 신호.
 *
 * - programNetBuyQty       : 시장 전체 프로그램 순매수 수량 (주)
 * - programNetBuyAmount    : 시장 전체 프로그램 순매수 금액 (원, KRW)
 * - programArbitrageNetBuy : 차익거래 순매수 (원). 부재 시 null
 *                           (강제 0 fallback 차단 — ADR-0136 의미 단절 정책 정합)
 *
 * KIS 응답 필드명 (한글 약어):
 *   - prgm_ntby_qty / prgm_ntby_qty_2     : 프로그램 순매수량
 *   - prgm_ntby_tr_pbmn / prgm_ntby_tr_pbmn_2 : 프로그램 거래대금
 *   - arbt_ntby_tr_pbmn                    : 차익 거래대금
 */
export interface KisMarketProgramTrade {
  programNetBuyQty: number | null;
  programNetBuyAmount: number | null;
  programArbitrageNetBuy: number | null;
  programNonArbitrageNetBuy?: number | null;
  programSellAmount?: number | null;
  programBuyAmount?: number | null;
  programArbitrageSellAmount?: number | null;
  programNonArbitrageSellAmount?: number | null;
  programArbitrageBuyAmount?: number | null;
  programNonArbitrageBuyAmount?: number | null;
  fetchedAt: string;
  source: 'KIS_API';
  marketProgramStatus?: 'OK_NONZERO' | 'OK_RAW_ZERO' | 'OK_EMPTY_OUTPUT' | 'OK_PARSE_PARTIAL' | 'PROVIDER_ERROR' | 'STALE_CACHE' | 'MISSING';
  selectedPath?: string;
  selectedBsopHour?: string;
  selectedReason?: 'LATEST_BY_BSOP_HOUR' | 'LATEST_NON_ZERO_ROW' | 'LATEST_ROW_ALL_ZERO' | 'NO_VALID_ROW' | 'EMPTY_OUTPUT';
  rowCount?: number;
  nonZeroRowCount?: number;
  latest?: string;
  updated?: string;
  zeroReason?: string;
  parseQuality?: string;
  providerIssue?: boolean;
  marketSignal?: boolean;
  scoring?: 'enabled' | 'excluded' | 'limited' | 'neutral';
  executionImpact?: 'NONE';
  rawFieldKeys?: string[];
  parsedFieldName?: string;
  kospiDiagnostics?: { rowCount?: number; [key: string]: unknown };
  kosdaqDiagnostics?: { rowCount?: number; [key: string]: unknown };
  aggregateDiagnostic?: Record<string, unknown>;
}

export interface KisDailyShortSale {
  stockCode: string;
  tradingDate?: string;
  shortSaleQty?: number;
  shortSaleAmount?: number;
  shortSaleRatio?: number;
  shortSaleIncreaseRate?: number;
  trend?: 'INCREASING' | 'DECREASING' | 'FLAT' | 'UNKNOWN';
  source: 'KIS_API';
  fetchedAt: string;
}

export interface KisShortSaleRankingRow {
  stockCode?: string;
  stockName?: string;
  shortSaleQty?: number;
  shortSaleAmount?: number;
  shortSaleRatio?: number;
  rank?: number;
  source: 'KIS_API';
}

export interface KisDailyLoanTransaction {
  stockCode: string;
  tradingDate?: string;
  loanBalanceQty?: number;
  loanBalanceAmount?: number;
  loanIncreaseRate?: number;
  trend?: 'INCREASING' | 'DECREASING' | 'FLAT' | 'UNKNOWN';
  source: 'KIS_API';
  fetchedAt: string;
}

export interface KisDailyCreditBalance {
  stockCode: string;
  tradingDate?: string;
  creditBalanceQty?: number;
  creditBalanceAmount?: number;
  creditIncreaseRate?: number;
  creditBalanceRatio?: number;
  trend?: 'INCREASING' | 'DECREASING' | 'FLAT' | 'UNKNOWN';
  source: 'KIS_API';
  fetchedAt: string;
}

export interface KisCreditBalanceRankingRow {
  stockCode?: string;
  stockName?: string;
  creditBalanceQty?: number;
  creditBalanceAmount?: number;
  creditIncreaseRate?: number;
  rank?: number;
  source: 'KIS_API';
}

export interface KisInvestorFlowRawRow {
  // Gate1 semantic validator 기대 필드 (정규화 — number)
  foreignNetBuy?: number;
  institutionNetBuy?: number;
  institutionalNetBuy?: number;
  individualNetBuy?: number;

  // KIS 원시 필드 — forensic 추적용
  stck_bsop_date?: string;
  frgn_ntby_qty?: string;
  orgn_ntby_qty?: string;
  prsn_ntby_qty?: string;
  frgn_ntby_tr_pbmn?: string;
  orgn_ntby_tr_pbmn?: string;

  [key: string]: unknown;
}

export interface KisInvestorFlowActualRowCarrier {
  provider: 'KIS_API';
  requestSymbol: string | null;
  normalizedSymbol: string | null;
  providerScope: 'SYMBOL_LEVEL';
  actualRows: KisInvestorFlowRawRow[];
  rowSourcePath: string;
  rawFieldKeys: string[];
  numericStringFieldKeys: string[];
  numberFieldKeys: string[];
  placeholderFieldKeys: string[];
  carriedAt: string;
}

export interface KisInvestorTradeByStockDaily {
  stockCode: string;
  tradingDate?: string;
  foreignNetBuy: number;
  institutionalNetBuy: number;
  individualNetBuy?: number;
  source: 'KIS_API';
  fetchedAt: string;
  actualInvestorFlowRowCarrier?: KisInvestorFlowActualRowCarrier;
  actualRows?: KisInvestorFlowRawRow[];
}

export interface KisForeignInstitutionTotal {
  foreignNetBuy?: number;
  institutionalNetBuy?: number;
  source: 'KIS_API';
  fetchedAt: string;
}

export interface KisInvestorTrendEstimate {
  stockCode: string;
  foreignNetBuyEstimate?: number;
  institutionalNetBuyEstimate?: number;
  individualNetBuyEstimate?: number;
  source: 'KIS_API';
  fetchedAt: string;
}

export interface KisInvestorDailyByMarket {
  tradingDate?: string;
  foreignNetBuy?: number;
  institutionNetBuy?: number;
  individualNetBuy?: number;
  source: 'KIS_API';
  fetchedAt: string;
}

export interface KisInvestorTimeByMarket {
  foreignNetBuy?: number;
  institutionNetBuy?: number;
  individualNetBuy?: number;
  source: 'KIS_API';
  fetchedAt: string;
}

/**
 * KIS 국내업종 기간별 지수 시세 (inquire-daily-indexchartprice / FHKUP03500100).
 *
 * KIS 공식 오픈소스 (open-trading-api) 검증 — `[국내주식] 업종/기타 > 국내주식업종기간별시세
 * (일/주/월/년) [v1_국내주식-021]`. `FID_COND_MRKT_DIV_CODE='U'` (업종),
 * `FID_INPUT_ISCD` = 업종 상세코드 (idxcode.mst 마스터 — 0001:종합, 0002:대형주 …).
 *
 * SectorEnergy 정책: KRX OpenAPI (`idx/kospi_dd_trd` 등) 가 *공식 원천* 이고 본 KIS
 * 경유 지수 시세는 *임시 proxy / 보조 fallback*. ENV `KIS_SECTOR_INDEX_DAILY_ENABLED`
 * default OFF — 명시 활성화 전까지 호출 0건.
 */
export interface KisSectorIndexDailyRow {
  /** 영업 일자 (YYYYMMDD) — stck_bsop_date */
  baseDate: string;
  /** 업종 지수 종가 — bstp_nmix_prpr */
  close: number;
  /** 업종 지수 시가 — bstp_nmix_oprc */
  open: number;
  /** 업종 지수 최고가 — bstp_nmix_hgpr */
  high: number;
  /** 업종 지수 최저가 — bstp_nmix_lwpr */
  low: number;
  /** 누적 거래량 — acml_vol */
  volume: number;
  /** 누적 거래 대금 — acml_tr_pbmn */
  value: number;
}

export interface KisSectorIndexDaily {
  /** 조회한 업종 상세코드 (FID_INPUT_ISCD) */
  sectorIscd: string;
  /** HTS 한글 업종명 — hts_kor_isnm (부재 시 빈 문자열) */
  sectorName: string;
  /** 업종 지수 현재가 — output1 bstp_nmix_prpr */
  currentIndex: number | null;
  /** 업종 지수 전일 대비율 — output1 bstp_nmix_prdy_ctrt (부재 시 null) */
  changePct: number | null;
  /** output2 일자별 지수 시계열 (최신순). 부재 시 빈 배열. */
  series: KisSectorIndexDailyRow[];
  fetchedAt: string;
  source: 'KIS_API';
}

export interface KisSectorIndexCurrentPrice {
  sectorIscd: string;
  sectorName: string;
  currentIndex: number | null;
  changePct: number | null;
  fetchedAt: string;
  source: 'KIS_API';
  rawFieldKeys: string[];
}

export type KisSectorIndexVerifyTransportStage =
  | 'NOT_ATTEMPTED'
  | 'CLIENT_DISABLED'
  | 'AUTH_NOT_READY'
  | 'REQUEST_BUILT'
  | 'REQUEST_SENT'
  | 'HTTP_RESPONSE_RECEIVED'
  | 'HTTP_EXCEPTION'
  | 'TIMEOUT'
  | 'PARSE_FAILED'
  | 'VERIFY_SUCCESS'
  | 'VERIFY_FAILED';

export type KisIndexQuoteBaseUrlKind = 'REAL' | 'VIRTUAL' | 'UNKNOWN';
export type KisSectorIndexVerifyMode = 'OBSERVE' | 'OFF';
export type KisSectorIndexValueQualityStatus =
  | 'USABLE'
  | 'VALUE_QUALITY_ZERO'
  | 'VALUE_PARSE_FAILED'
  | 'API_TRANSPORT_FAILED'
  | 'NOT_ATTEMPTED';

export interface KisSectorIndexVerifyVariantPolicy {
  enabled: boolean;
  triedVariants: string[];
  debugOnlyVariants: string[];
  colonHyphenSent: boolean;
}

export interface KisIndexQuoteClientStatus {
  enabled: boolean;
  verifyMode: KisSectorIndexVerifyMode;
  livePromotionFromVerify: false;
  authReady: boolean;
  tokenPresent: boolean;
  tokenExpiresInSec: number | null;
  tokenProvider: 'KIS_SHARED_TOKEN_PROVIDER';
  baseUrlKind: KisIndexQuoteBaseUrlKind;
  apiPath: string;
  method: 'GET';
  trId: string;
  canCall: boolean;
  disabledReason?: string;
  lastExceptionClass?: string;
  lastExceptionMessageSanitized?: string;
  executionImpact: 'NONE';
}

export interface KisSectorIndexCurrentPriceProbeAttempt {
  fidCondMrktDivCode: string;
  fidInputIscd: string;
  apiPath: string;
  method?: 'GET';
  trId: string;
  baseUrlKind?: KisIndexQuoteBaseUrlKind;
  requestBuilt?: boolean;
  requestSent?: boolean;
  httpStatus?: number | null;
  rtCd?: string | null;
  msgCd?: string | null;
  msg1?: string | null;
  outputShape?: string | null;
  indexValueFieldName?: string | null;
  outputPresent: boolean;
  indexValueFieldPresent: boolean;
  rawTopLevelKeys: string[];
  outputKeys: string[];
  currentIndex?: number | null;
  apiTransportSuccess?: boolean;
  indexValueUsable?: boolean;
  valueQualityStatus?: KisSectorIndexValueQualityStatus;
  exceptionClass?: string | null;
  exceptionMessageSanitized?: string | null;
  timeoutMs?: number | null;
  retryCount?: number;
  transportStage?: KisSectorIndexVerifyTransportStage;
  verified: boolean;
  reasonCode: string;
}

export interface KisSectorIndexCurrentPriceProbeResult {
  sectorIscd: string;
  selectedInputIscd: string | null;
  verified: boolean;
  currentIndex: number | null;
  changePct: number | null;
  sectorName: string;
  fetchedAt?: string;
  source: 'KIS_API';
  reasonCode: string;
  selectedFailureReason?: string;
  clientStatus?: KisIndexQuoteClientStatus;
  verifyVariantPolicy?: KisSectorIndexVerifyVariantPolicy;
  attempts: KisSectorIndexCurrentPriceProbeAttempt[];
  triedCandidates: string[];
}

/**
 * KIS 전일종가 응답 — ADR-0004 대체 경로에서 장전 갭 계산의 기준가로 사용.
 */
export interface PrevClose {
  stockCode:   string;
  prevClose:   number;
  /** KRX 영업일 (YYYY-MM-DD) — probe 가 staleness 판정에 사용. */
  tradingDate: string;
  /** 응답 수신 시각 (ISO). */
  fetchedAt:   string;
}

export interface KisHolding {
  /** 종목코드 (6자리 zero-padded) */
  pdno: string;
  /** 종목명 (KIS 응답의 prdt_name) */
  prdtName: string;
  /** 보유 수량 — KIS 가 정답 (SSOT) */
  hldgQty: number;
  /** 매입 평단가 — KIS 가 사사오입 후 보관 (SSOT) */
  pchsAvgPric: number;
  /** 현재가 (KIS 응답의 prpr) — null 이면 장외/조회 실패 */
  prpr: number | null;
  /** 평가손익 (KIS 응답의 evlu_pfls_amt) */
  evluPflsAmt: number | null;
}

/**
 * 매도 주문 결과 분류 — placed=true 의 모호함 해소.
 *
 * - `SHADOW_ONLY`  : Shadow 모드 — 실주문 없이 가상 체결로 기록해도 안전.
 * - `LIVE_ORDERED` : LIVE 실주문 접수 성공, ODNO 발급됨 (체결은 CCLD 폴링 필요).
 * - `LIVE_FAILED`  : LIVE 모드였으나 접수 실패 (KIS 미설정 · API 예외 · ODNO null).
 *                    호출측은 Fill 선반영을 건너뛰고 중복 방지 플래그도 롤백해야 한다.
 */
export type SellOrderOutcome = 'SHADOW_ONLY' | 'LIVE_ORDERED' | 'LIVE_FAILED';

export interface SellOrderResult {
  ordNo: string | null;
  /** KIS 실주문이 성사됐는지 (LIVE 성공 시 true, SHADOW/실패 시 false) */
  placed: boolean;
  /** 호출측 분기의 진실 원천 — placed 보다 우선 사용 권장. */
  outcome: SellOrderOutcome;
  /** LIVE_FAILED 경우 사람이 읽을 수 있는 사유 */
  failureReason?: string;
}

/**
 * VTS 모드에서 실 API 호출 없이 전체 파이프라인을 테스트할 수 있도록
 * 데이터 조회 함수들을 오버라이드 가능하게 한다.
 * 주문 함수 (placeKisSellOrder 등) 는 이미 Shadow 모드에서 실주문을 건너뛰므로 제외.
 */
export interface KisClientOverrides {
  fetchCurrentPrice?: (code: string) => Promise<number | null>;
  fetchStockName?: (code: string) => Promise<string | null>;
  fetchAccountBalance?: () => Promise<number | null>;
  fetchKisHoldings?: () => Promise<KisHolding[] | null>;
  fetchKisStockProgramTrade?: (code: string) => Promise<KisStockProgramTrade | null>;
  fetchKisMarketProgramTrade?: () => Promise<KisMarketProgramTrade | null>;
  fetchKisDailyShortSale?: (code: string) => Promise<KisDailyShortSale | null>;
  fetchKisShortSaleRanking?: () => Promise<KisShortSaleRankingRow[] | null>;
  fetchKisDailyLoanTransaction?: (code: string) => Promise<KisDailyLoanTransaction | null>;
  fetchKisDailyCreditBalance?: (code: string) => Promise<KisDailyCreditBalance | null>;
  fetchKisCreditBalanceRanking?: () => Promise<KisCreditBalanceRankingRow[] | null>;
  fetchKisInvestorTradeByStockDaily?: (code: string) => Promise<KisInvestorTradeByStockDaily | null>;
  fetchKisForeignInstitutionTotal?: () => Promise<KisForeignInstitutionTotal | null>;
  fetchKisInvestorTrendEstimate?: (code: string) => Promise<KisInvestorTrendEstimate | null>;
  fetchKisInvestorDailyByMarket?: () => Promise<KisInvestorDailyByMarket | null>;
  fetchKisInvestorTimeByMarket?: () => Promise<KisInvestorTimeByMarket | null>;
  fetchKisSectorIndexDaily?: (sectorIscd: string) => Promise<KisSectorIndexDaily | null>;
  fetchKisSectorIndexCurrentPrice?: (sectorIscd: string) => Promise<KisSectorIndexCurrentPrice | null>;
  fetchKisSectorIndexCurrentPriceProbe?: (sectorIscdCandidates: readonly string[]) => Promise<KisSectorIndexCurrentPriceProbeResult | null>;
  realDataKisGet?: (trId: string, apiPath: string, params: Record<string, string>) => Promise<unknown>;
}
