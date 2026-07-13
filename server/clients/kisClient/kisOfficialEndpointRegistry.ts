// @responsibility P0-KIS-OFFICIAL-REGISTRY: official KIS endpoint metadata registry only.

type KisOfficialConfidenceClass =
  | 'VERIFIED_INTRADAY'
  | 'VERIFIED_DAILY'
  | 'VERIFIED_DELAYED'
  | 'ESTIMATED'
  | 'ACCOUNT_VERIFIED'
  | 'ORDER_EXECUTION';

type KisOfficialUseScope =
  | 'DIAGNOSTIC_ONLY'
  | 'SHADOW_ONLY'
  | 'ADVISORY'
  | 'WEIGHTED'
  | 'LIVE_ORDER';

type KisOfficialExecutionImpact =
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

interface KisOfficialApiInventoryEntry {
  apiPath: string;
  method: 'GET' | 'POST';
  trId: string | null;
  requiredParams: string[];
  outputFields: string[];
  normalizedModel: string;
}

export interface KisOfficialApiInventory {
  quote: KisOfficialApiInventoryEntry;
  ohlcvDaily: KisOfficialApiInventoryEntry;
  investorFlow: KisOfficialApiInventoryEntry;
  balance: KisOfficialApiInventoryEntry;
  order: KisOfficialApiInventoryEntry;
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
    // ADR-0542: 공식 spec(investor_trade_by_stock_daily.py)은 output1(요약 row)+output2(일자별 시계열)
    // 둘 다 반환한다. 직전 registry는 ['output'] 만 선언해 impl(query.ts)의 output1/output2 합성과
    // 드리프트가 있었다. SSOT 정합 — outputBuckets 메타 정정(런타임은 impl 상수 사용).
    outputBuckets: ['output1', 'output2', 'output'],
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
    // ADR-0543(분리 예정): 실제 spec/impl(query.ts fetchKisInvestorTrendEstimate)은 단일 param
    // MKSC_SHRN_ISCD 를 사용하나 본 registry는 [FID_COND_MRKT_DIV_CODE, FID_INPUT_ISCD] 로 드리프트.
    // L4(ESTIMATED) 격리 정책과 함께 ADR-0543 에서 정정 — 본 PR(ADR-0542)에서는 손대지 않음.
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
    // ADR-0653 metadata sync: 공식 SDK inquire_investor_daily_by_market.py tr_id=FHPTJ04040000.
    trId: 'FHPTJ04040000',
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
    // ADR-0653 metadata sync: 공식 SDK inquire_investor_time_by_market.py tr_id=FHPTJ04030000.
    trId: 'FHPTJ04030000',
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
    // ADR-0653 metadata sync: 공식 SDK program_trade_by_stock.py tr_id=FHPPG04650101
    // (일별 변형 programTradeByStockDaily=FHPPG04650201 과 구분).
    trId: 'FHPPG04650101',
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
    trId: 'FHPPG04650201',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD', 'FID_INPUT_DATE_1'],
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
    trId: 'FHPPG04600101',
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
    // ADR-0653 metadata sync: 공식 SDK comp_program_trade_daily.py tr_id=FHPPG04600001
    // (당일 변형 compProgramTradeToday=FHPPG04600101 과 구분).
    trId: 'FHPPG04600001',
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
    // ADR-0653 metadata sync: 공식 SDK investor_program_trade_today.py tr_id=HHPPG046600C1.
    trId: 'HHPPG046600C1',
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
    // ADR-0653 metadata sync: 공식 SDK short_sale.py tr_id=FHPST04820000.
    trId: 'FHPST04820000',
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
    trId: 'FHKST17010000',
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
    // ADR-0653 metadata sync: 공식 SDK foreign_institution_total.py tr_id=FHPTJ04400000
    // (rankingInvestor 권위 경로와 동일 trId — 아래 rankingInvestor 노트 참조).
    trId: 'FHPTJ04400000',
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
    // ADR-0653 metadata sync: 공식 SDK inquire_daily_indexchartprice.py tr_id=FHKUP03500100.
    trId: 'FHKUP03500100',
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
    // ADR-0652: KIS 공식 거래량 순위 path 는 /quotations/volume-rank (tr_id FHPST01710000).
    //   구 /ranking/volume 은 KIS 미존재 → bare 404. 검증 출처: koreainvestment/open-trading-api.
    path: '/uapi/domestic-stock/v1/quotations/volume-rank',
    trId: 'FHPST01710000',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'ADR-0652: corrected path /quotations/volume-rank (was /ranking/volume → 404). Ranking data must not be treated as direct buy signal.',
  },
  rankingFluctuation: {
    key: 'rankingFluctuation',
    nameKo: '등락률 순위 조회',
    category: 'ranking',
    method: 'GET',
    path: '/uapi/domestic-stock/v1/ranking/fluctuation',
    // ADR-0653 metadata sync: 공식 SDK fluctuation.py tr_id=FHPST01700000.
    trId: 'FHPST01700000',
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
    // ADR-0652: KIS 공식 시총 순위 tr_id 는 FHPST01740000 (scr_div_code 20174).
    //   구 FHPST01720000/20172 는 KIS 미존재 → bare 404. path 는 정상.
    trId: 'FHPST01740000',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_DAILY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'ADR-0652: corrected tr_id FHPST01740000 + scr_div_code 20174 (was FHPST01720000/20172 → 404). Used for universe filtering.',
  },
  rankingInvestor: {
    key: 'rankingInvestor',
    nameKo: '투자자 순위 조회',
    category: 'ranking_supply',
    method: 'GET',
    // ADR-0652: KIS 에 /ranking/investor 는 존재하지 않음 → bare 404. 권위 경로는
    //   /quotations/foreign-institution-total (tr_id FHPTJ04400000, foreignInstitutionTotal 엔트리).
    //   본 path 는 by-path 충돌 회피 위해 레거시값 유지(런타임은 resolveRankingEndpoint 가 정정).
    path: '/uapi/domestic-stock/v1/ranking/investor',
    trId: 'FHPTJ04400000',
    requiredParams: [],
    outputBuckets: ['output', 'output1', 'output2'],
    confidenceClass: 'VERIFIED_INTRADAY',
    defaultUseScope: 'ADVISORY',
    executionImpact: 'NONE',
    providerIssueMeansMarketSignal: false,
    notes: 'ADR-0652: legacy /ranking/investor → 404. Authoritative endpoint = /quotations/foreign-institution-total (FHPTJ04400000). Migration gated by isLeaderRankingEndpointFixEnabled.',
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
    // ADR-0653 metadata sync: 공식 SDK inquire_time_itemconclusion.py tr_id=FHPST01060000.
    trId: 'FHPST01060000',
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

const KIS_OFFICIAL_INQUIRE_INVESTOR_ENDPOINT = {
  key: 'INQUIRE_INVESTOR',
  name: 'stock current price investor',
  path: KIS_OFFICIAL_ENDPOINTS.inquireInvestor.path,
  trId: KIS_OFFICIAL_ENDPOINTS.inquireInvestor.trId ?? 'FHKST01010900',
  method: KIS_OFFICIAL_ENDPOINTS.inquireInvestor.method,
  requiredParams: [...KIS_OFFICIAL_ENDPOINTS.inquireInvestor.requiredParams],
  dataDomain: 'DOMESTIC_STOCK_INVESTOR_FLOW',
  source: 'KIS_OFFICIAL_OPEN_TRADING_API',
} as const;

const KIS_OFFICIAL_INVESTOR_TRADE_BY_STOCK_DAILY_ENDPOINT = {
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

const KIS_OFFICIAL_COMP_PROGRAM_TRADE_TODAY_ENDPOINT = {
  key: 'COMP_PROGRAM_TRADE_TODAY',
  name: 'market program trade aggregate today',
  path: KIS_OFFICIAL_ENDPOINTS.compProgramTradeToday.path,
  trId: KIS_OFFICIAL_ENDPOINTS.compProgramTradeToday.trId ?? 'FHPPG04600101',
  method: KIS_OFFICIAL_ENDPOINTS.compProgramTradeToday.method,
  requiredParams: [...KIS_OFFICIAL_ENDPOINTS.compProgramTradeToday.requiredParams],
  dataDomain: 'MARKET_PROGRAM_TRADE',
  scope: 'MARKET',
  source: 'KIS_OFFICIAL_OPEN_TRADING_API',
} as const;

const KIS_OFFICIAL_PROGRAM_TRADE_BY_STOCK_DAILY_ENDPOINT = {
  key: 'PROGRAM_TRADE_BY_STOCK_DAILY',
  name: 'program trade by stock daily',
  path: KIS_OFFICIAL_ENDPOINTS.programTradeByStockDaily.path,
  trId: KIS_OFFICIAL_ENDPOINTS.programTradeByStockDaily.trId ?? 'FHPPG04650201',
  method: KIS_OFFICIAL_ENDPOINTS.programTradeByStockDaily.method,
  requiredParams: [...KIS_OFFICIAL_ENDPOINTS.programTradeByStockDaily.requiredParams],
  dataDomain: 'STOCK_PROGRAM_TRADE',
  scope: 'STOCK',
  source: 'KIS_OFFICIAL_OPEN_TRADING_API',
} as const;

export const KIS_OFFICIAL_PROGRAM_TRADE_ENDPOINTS = {
  COMP_PROGRAM_TRADE_TODAY: KIS_OFFICIAL_COMP_PROGRAM_TRADE_TODAY_ENDPOINT,
  PROGRAM_TRADE_BY_STOCK_DAILY: KIS_OFFICIAL_PROGRAM_TRADE_BY_STOCK_DAILY_ENDPOINT,
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

const KIS_OFFICIAL_ENDPOINTS_BY_PATH = buildKisOfficialEndpointsByPath();

export function findKisOfficialEndpointByPath(path: string): KisOfficialEndpointSpec | undefined {
  return KIS_OFFICIAL_ENDPOINTS_BY_PATH[path];
}

export function getKisOfficialApiInventory(): KisOfficialApiInventory {
  const quote = KIS_OFFICIAL_ENDPOINTS.inquirePrice;
  const ohlcvDaily = KIS_OFFICIAL_ENDPOINTS.inquireDailyItemChartPrice;
  const investorFlow = KIS_OFFICIAL_ENDPOINTS.inquireInvestor;
  const balance = KIS_OFFICIAL_ENDPOINTS.inquireBalance;
  const order = KIS_OFFICIAL_ENDPOINTS.orderCash;
  const optionalTrId = (endpoint: unknown): string | null => {
    const trId = (endpoint as { trId?: unknown }).trId;
    return typeof trId === 'string' ? trId : null;
  };
  return {
    quote: {
      apiPath: quote.path,
      method: quote.method,
      trId: quote.trId ?? null,
      requiredParams: [...quote.requiredParams],
      outputFields: [...quote.outputBuckets],
      normalizedModel: 'KisNormalizedQuote',
    },
    ohlcvDaily: {
      apiPath: ohlcvDaily.path,
      method: ohlcvDaily.method,
      trId: ohlcvDaily.trId ?? null,
      requiredParams: [...ohlcvDaily.requiredParams],
      outputFields: [...ohlcvDaily.outputBuckets],
      normalizedModel: 'KisDailyCandle[]',
    },
    investorFlow: {
      apiPath: investorFlow.path,
      method: investorFlow.method,
      trId: investorFlow.trId ?? null,
      requiredParams: [...investorFlow.requiredParams],
      outputFields: [...investorFlow.outputBuckets],
      normalizedModel: 'KisInvestorFlow',
    },
    balance: {
      apiPath: balance.path,
      method: balance.method,
      trId: optionalTrId(balance),
      requiredParams: [...balance.requiredParams],
      outputFields: [...balance.outputBuckets],
      normalizedModel: 'KisBalance',
    },
    order: {
      apiPath: order.path,
      method: order.method,
      trId: optionalTrId(order),
      requiredParams: [...order.requiredParams],
      outputFields: [...order.outputBuckets],
      normalizedModel: 'KisOrderResult',
    },
  };
}
