// @responsibility P0-KIS-OFFICIAL-REGISTRY: official KIS endpoint metadata registry only.

export type KisOfficialConfidenceClass =
  | 'VERIFIED_INTRADAY'
  | 'VERIFIED_DAILY'
  | 'VERIFIED_DELAYED'
  | 'ESTIMATED'
  | 'ACCOUNT_VERIFIED'
  | 'ORDER_EXECUTION';

export type KisOfficialUseScope =
  | 'DIAGNOSTIC_ONLY'
  | 'SHADOW_ONLY'
  | 'ADVISORY'
  | 'WEIGHTED'
  | 'LIVE_ORDER';

export type KisOfficialExecutionImpact =
  | 'NONE'
  | 'SCORE_ONLY'
  | 'LIVE_ORDER';

export interface KisOfficialEndpointSpec {
  key: string;
  nameKo: string;
  category: string;
  method: 'GET' | 'POST';
  path: string;
  trId?: string;
  officialExample?: string;
  requiredParams: string[];
  outputBuckets: string[];
  confidenceClass: KisOfficialConfidenceClass;
  defaultUseScope: KisOfficialUseScope;
  executionImpact: KisOfficialExecutionImpact;
  providerIssueMeansMarketSignal: boolean;
  notes?: string;
}

export const KIS_OFFICIAL_ENDPOINTS = {
  inquirePrice: {
    key: 'inquirePrice',
    nameKo: '주식 현재가 조회',
    category: 'quotation',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-price',
    trId: 'FHKST01010100',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  inquireInvestor: {
    key: 'inquireInvestor',
    nameKo: '주식 현재가 투자자 조회',
    category: 'supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-investor',
    trId: 'FHKST01010900',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'SHADOW_ONLY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Known legacy drift: some existing QMP code may use FHKST01010300. Do not replace automatically in P0.',
  },
  investorTradeByStockDaily: {
    key: 'investorTradeByStockDaily',
    nameKo: '종목별 투자자매매동향 일별 조회',
    category: 'supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily',
    trId: 'FHPTJ04160001',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD', 'FID_INPUT_DATE_1', 'FID_ORG_ADJ_PRC', 'FID_ETC_CLS_CODE'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  investorTrendEstimate: {
    key: 'investorTrendEstimate',
    nameKo: '투자자 추정 동향',
    category: 'supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/investor-trend-estimate',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'ESTIMATED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Estimated data must not be treated as confirmed investor flow.',
  },
  inquireInvestorDailyByMarket: {
    key: 'inquireInvestorDailyByMarket',
    nameKo: '시장별 투자자 매매동향 일별 조회',
    category: 'market_supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_DATE_1', 'FID_INPUT_DATE_2'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  inquireInvestorTimeByMarket: {
    key: 'inquireInvestorTimeByMarket',
    nameKo: '시장별 투자자 매매동향 시간대별 조회',
    category: 'market_supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'SHADOW_ONLY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  programTradeByStock: {
    key: 'programTradeByStock',
    nameKo: '종목별 프로그램 매매 조회',
    category: 'program',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/program-trade-by-stock',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  programTradeByStockDaily: {
    key: 'programTradeByStockDaily',
    nameKo: '종목별 프로그램 매매 일별 조회',
    category: 'program',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  compProgramTradeToday: {
    key: 'compProgramTradeToday',
    nameKo: '시장별 프로그램 매매 종합 당일 조회',
    category: 'market_program',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/comp-program-trade-today',
    requiredParams: ['FID_COND_MRKT_DIV_CODE'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'DIAGNOSTIC_ONLY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  compProgramTradeDaily: {
    key: 'compProgramTradeDaily',
    nameKo: '시장별 프로그램 매매 종합 일별 조회',
    category: 'market_program',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/comp-program-trade-daily',
    requiredParams: ['FID_COND_MRKT_DIV_CODE'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'DIAGNOSTIC_ONLY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  investorProgramTradeToday: {
    key: 'investorProgramTradeToday',
    nameKo: '투자자별 프로그램 매매 당일 조회',
    category: 'market_program',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/investor-program-trade-today',
    requiredParams: ['FID_COND_MRKT_DIV_CODE'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'DIAGNOSTIC_ONLY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  dailyShortSale: {
    key: 'dailyShortSale',
    nameKo: '일별 공매도 조회',
    category: 'short_selling',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/daily-short-sale',
    trId: 'FHPST04830000',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DELAYED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  shortSaleRanking: {
    key: 'shortSaleRanking',
    nameKo: '공매도 순위 조회',
    category: 'short_selling',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/short-sale',
    requiredParams: ['FID_COND_MRKT_DIV_CODE'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DELAYED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  dailyLoanTrans: {
    key: 'dailyLoanTrans',
    nameKo: '일별 대차거래 조회',
    category: 'loan',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/daily-loan-trans',
    trId: 'HHPST074500C0',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DELAYED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  dailyCreditBalance: {
    key: 'dailyCreditBalance',
    nameKo: '일별 신용 잔고 조회',
    category: 'credit',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/daily-credit-balance',
    trId: 'FHPST04760000',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DELAYED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  creditBalanceRanking: {
    key: 'creditBalanceRanking',
    nameKo: '신용 잔고 순위 조회',
    category: 'credit',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/credit-balance',
    requiredParams: ['FID_COND_MRKT_DIV_CODE'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DELAYED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  foreignInstitutionTotal: {
    key: 'foreignInstitutionTotal',
    nameKo: '외국인 기관 합계 조회',
    category: 'supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
    requiredParams: ['FID_COND_MRKT_DIV_CODE'],
    outputBuckets: ['output'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  inquireDailyItemChartPrice: {
    key: 'inquireDailyItemChartPrice',
    nameKo: '주식 일봉 차트 조회',
    category: 'chart',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
    trId: 'FHKST03010100',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output1', 'output2'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  inquireDailyIndexChartPrice: {
    key: 'inquireDailyIndexChartPrice',
    nameKo: '국내 지수 일봉 차트 조회',
    category: 'chart',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputBuckets: ['output1', 'output2'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  inquireBalance: {
    key: 'inquireBalance',
    nameKo: '주식 잔고 조회',
    category: 'account',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/trading/inquire-balance',
    requiredParams: ['CANO', 'ACNT_PRDT_CD'],
    outputBuckets: ['output1', 'output2'],
    confidenceClass: 'ACCOUNT_VERIFIED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  inquireDailyCcld: {
    key: 'inquireDailyCcld',
    nameKo: '주식 일별 체결 조회',
    category: 'account',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    requiredParams: ['CANO', 'ACNT_PRDT_CD'],
    outputBuckets: ['output1', 'output2'],
    confidenceClass: 'ACCOUNT_VERIFIED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
  },
  orderCash: {
    key: 'orderCash',
    nameKo: '주식 현금 주문',
    category: 'order',
    method: 'POST',
    path: '/uapi/domestic-stock/v1/trading/order-cash',
    requiredParams: ['CANO', 'ACNT_PRDT_CD', 'PDNO', 'ORD_DVSN', 'ORD_QTY', 'ORD_UNPR'],
    outputBuckets: ['output'],
    confidenceClass: 'ORDER_EXECUTION',
    defaultUseScope: 'LIVE_ORDER',
    executionImpact: 'LIVE_ORDER',
    providerIssueMeansMarketSignal: false,
  },
  orderRvsecncl: {
    key: 'orderRvsecncl',
    nameKo: '주식 정정취소 주문',
    category: 'order',
    method: 'POST',
    path: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
    requiredParams: ['CANO', 'ACNT_PRDT_CD', 'KRX_FWDG_ORD_ORGNO', 'ORGN_ODNO', 'ORD_DVSN', 'RVSE_CNCL_DVSN_CD', 'ORD_QTY', 'ORD_UNPR'],
    outputBuckets: ['output'],
    confidenceClass: 'ORDER_EXECUTION',
    defaultUseScope: 'LIVE_ORDER',
    executionImpact: 'LIVE_ORDER',
    providerIssueMeansMarketSignal: false,
  },
  rankingVolume: {
    key: 'rankingVolume',
    nameKo: '거래량 순위 조회',
    category: 'ranking',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/volume',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Volume ranking endpoint used for candidate discovery. Ranking data must not be treated as direct buy signal.',
  },
  rankingFluctuation: {
    key: 'rankingFluctuation',
    nameKo: '등락률 순위 조회',
    category: 'ranking',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/fluctuation',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Price fluctuation ranking endpoint used for candidate discovery.',
  },
  rankingMarketCap: {
    key: 'rankingMarketCap',
    nameKo: '시가총액 순위 조회',
    category: 'ranking',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/market-cap',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Market cap ranking endpoint used for universe filtering.',
  },
  rankingInvestor: {
    key: 'rankingInvestor',
    nameKo: '투자자 순위 조회',
    category: 'ranking_supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/investor',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Investor ranking endpoint. Must be normalized before use in supply scoring.',
  },
  inquirePsblRvsecncl: {
    key: 'inquirePsblRvsecncl',
    nameKo: '정정취소 가능 주문 조회',
    category: 'account',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'ACCOUNT_VERIFIED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Inquiry endpoint for cancellable/revisable orders. Read-only account/trading state.',
  },
  inquireTimeItemConclusion: {
    key: 'inquireTimeItemConclusion',
    nameKo: '주식 체결 시간대별 조회',
    category: 'quotation',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-time-itemconclusion',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Intraday time-and-sales/conclusion endpoint. High-frequency quotation data should not directly trigger live execution in registry P0.',
  },
  inquirePsblOrder: {
    key: 'inquirePsblOrder',
    nameKo: '매수 가능 주문 조회',
    category: 'account',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/trading/inquire-psbl-order',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'ACCOUNT_VERIFIED',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Inquiry endpoint for orderable quantity/cash. Read-only.',
  },
  orderCredit: {
    key: 'orderCredit',
    nameKo: '주식 신용 주문',
    category: 'order',
    method: 'POST',
    path: '/uapi/domestic-stock/v1/trading/order-credit',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'ORDER_EXECUTION',
    defaultUseScope: 'LIVE_ORDER',
    executionImpact: 'LIVE_ORDER',
    providerIssueMeansMarketSignal: false,
    notes: 'Credit order endpoint. Must never be invoked by registry. Existing execution guards must remain unchanged.',
  },
  quotationInvestorLegacy: {
    key: 'quotationInvestorLegacy',
    nameKo: '투자자 조회 레거시 경로',
    category: 'supply',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/investor',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'SHADOW_ONLY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'Legacy/simple investor quotation path discovered in existing QMP code. Keep separate from inquire-investor until response shape is verified.',
  },
  rankingNewHighLow: {
    key: 'rankingNewHighLow',
    nameKo: '신고가 신저가 순위 조회',
    category: 'ranking',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/new-high-low',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'New-high/new-low ranking endpoint used for momentum discovery. Not a direct buy signal.',
  },
} as const satisfies Record<string, KisOfficialEndpointSpec>;

export const KIS_OFFICIAL_INQUIRE_PRICE_ENDPOINT = {
  key: 'INQUIRE_PRICE',
  name: '주식현재가 시세',
  path: KIS_OFFICIAL_ENDPOINTS.inquirePrice.path,
  trId: KIS_OFFICIAL_ENDPOINTS.inquirePrice.trId ?? 'FHKST01010100',
  method: KIS_OFFICIAL_ENDPOINTS.inquirePrice.method,
  requiredParams: [...KIS_OFFICIAL_ENDPOINTS.inquirePrice.requiredParams],
  dataDomain: 'DOMESTIC_STOCK_QUOTE',
  source: 'KIS_OFFICIAL_OPEN_TRADING_API',
} as const;

export const KIS_OFFICIAL_INQUIRE_INVESTOR_ENDPOINT = {
  key: 'INQUIRE_INVESTOR',
  name: 'stock current price investor',
  path: KIS_OFFICIAL_ENDPOINTS.inquireInvestor.path,
  trId: KIS_OFFICIAL_ENDPOINTS.inquireInvestor.trId ?? 'FHKST01010900',
  method: KIS_OFFICIAL_ENDPOINTS.inquireInvestor.method,
  requiredParams: [...KIS_OFFICIAL_ENDPOINTS.inquireInvestor.requiredParams],
  dataDomain: 'DOMESTIC_STOCK_INVESTOR_FLOW',
  source: 'KIS_OFFICIAL_OPEN_TRADING_API',
} as const;

export const KIS_OFFICIAL_INVESTOR_TRADE_BY_STOCK_DAILY_ENDPOINT = {
  key: 'INVESTOR_TRADE_BY_STOCK_DAILY',
  name: 'investor trade by stock daily',
  path: KIS_OFFICIAL_ENDPOINTS.investorTradeByStockDaily.path,
  trId: KIS_OFFICIAL_ENDPOINTS.investorTradeByStockDaily.trId ?? 'FHPTJ04160001',
  method: KIS_OFFICIAL_ENDPOINTS.investorTradeByStockDaily.method,
  requiredParams: [...KIS_OFFICIAL_ENDPOINTS.investorTradeByStockDaily.requiredParams],
  dataDomain: 'DOMESTIC_STOCK_INVESTOR_FLOW_DAILY',
  source: 'KIS_OFFICIAL_OPEN_TRADING_API',
} as const;

export const KIS_OFFICIAL_INVESTOR_FLOW_ENDPOINTS = {
  INQUIRE_INVESTOR: KIS_OFFICIAL_INQUIRE_INVESTOR_ENDPOINT,
  INVESTOR_TRADE_BY_STOCK_DAILY: KIS_OFFICIAL_INVESTOR_TRADE_BY_STOCK_DAILY_ENDPOINT,
} as const;

function buildKisOfficialEndpointsByPath(): Record<string, KisOfficialEndpointSpec> {
  const byPath: Record<string, KisOfficialEndpointSpec> = {};
  for (const spec of Object.values(KIS_OFFICIAL_ENDPOINTS)) {
    if (byPath[spec.path]) {
      throw new Error(`Duplicate KIS official endpoint path: ${spec.path}`);
    }
    byPath[spec.path] = spec;
  }
  return byPath;
}

export const KIS_OFFICIAL_ENDPOINTS_BY_PATH = buildKisOfficialEndpointsByPath();

export const KIS_OFFICIAL_ENDPOINT_PATH_SET = new Set(
  Object.keys(KIS_OFFICIAL_ENDPOINTS_BY_PATH),
);

export function getKisOfficialEndpoint(key: string): KisOfficialEndpointSpec | undefined {
  return (KIS_OFFICIAL_ENDPOINTS as Record<string, KisOfficialEndpointSpec>)[key];
}

export function findKisOfficialEndpointByPath(path: string): KisOfficialEndpointSpec | undefined {
  return KIS_OFFICIAL_ENDPOINTS_BY_PATH[path];
}

export function listKisOfficialEndpoints(): KisOfficialEndpointSpec[] {
  return Object.values(KIS_OFFICIAL_ENDPOINTS);
}
