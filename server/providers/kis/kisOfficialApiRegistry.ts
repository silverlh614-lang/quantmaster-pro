export type KisOfficialDomain = 'QUOTE' | 'OHLCV' | 'SUPPLY' | 'PROGRAM_TRADE' | 'BALANCE' | 'ORDER';
export type KisOutputShape = 'output' | 'output1_output2';

export interface KisOfficialApiSpec {
  domain: KisOfficialDomain;
  name: string;
  apiPath: string;
  trIdReal: string;
  trIdDemo?: string;
  requiredParams: string[];
  outputShape: KisOutputShape;
  primaryUse: string;
  allowedUseForLive: boolean;
  allowedUseForShadow: boolean;
  marketSignalConvertible: boolean;
}

export const KIS_OFFICIAL_API_REGISTRY: Record<string, KisOfficialApiSpec> = {
  inquirePrice: {
    domain: 'QUOTE',
    name: 'inquire-price',
    apiPath: '/uapi/domestic-stock/v1/quotations/inquire-price',
    trIdReal: 'FHKST01010100',
    trIdDemo: 'FHKST01010100',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD'],
    outputShape: 'output',
    primaryUse: 'currentPrice/open/high/low/volume/changeRate/tradeValue/quoteTimestamp',
    allowedUseForLive: true,
    allowedUseForShadow: true,
    marketSignalConvertible: false,
  },
  inquireDailyItemchartPrice: {
    domain: 'OHLCV',
    name: 'inquire-daily-itemchartprice',
    apiPath: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
    trIdReal: 'FHKST03010100',
    trIdDemo: 'FHKST03010100',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_ISCD', 'FID_INPUT_DATE_1', 'FID_INPUT_DATE_2', 'FID_PERIOD_DIV_CODE', 'FID_ORG_ADJ_PRC'],
    outputShape: 'output1_output2',
    primaryUse: 'technicalIndicators and OHLCV history',
    allowedUseForLive: true,
    allowedUseForShadow: true,
    marketSignalConvertible: false,
  },
  foreignInstitutionTotal: {
    domain: 'SUPPLY',
    name: 'foreign-institution-total',
    apiPath: '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
    trIdReal: 'FHPTJ04400000',
    trIdDemo: 'FHPTJ04400000',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_COND_SCR_DIV_CODE', 'FID_INPUT_ISCD', 'FID_DIV_CLS_CODE', 'FID_RANK_SORT_CLS_CODE', 'FID_ETC_CLS_CODE'],
    outputShape: 'output',
    primaryUse: 'foreign/institution supply context',
    allowedUseForLive: false,
    allowedUseForShadow: true,
    marketSignalConvertible: false,
  },
  compProgramTradeToday: {
    domain: 'PROGRAM_TRADE',
    name: 'comp-program-trade-today',
    apiPath: '/uapi/domestic-stock/v1/quotations/comp-program-trade-today',
    trIdReal: 'FHPPG04600101',
    trIdDemo: 'FHPPG04600101',
    requiredParams: ['FID_COND_MRKT_DIV_CODE', 'FID_MRKT_CLS_CODE'],
    outputShape: 'output',
    primaryUse: 'program-trade daily snapshot',
    allowedUseForLive: false,
    allowedUseForShadow: true,
    marketSignalConvertible: false,
  },
  inquireBalance: {
    domain: 'BALANCE',
    name: 'inquire-balance',
    apiPath: '/uapi/domestic-stock/v1/trading/inquire-balance',
    trIdReal: 'TTTC8434R',
    trIdDemo: 'VTTC8434R',
    requiredParams: [],
    outputShape: 'output1_output2',
    primaryUse: 'live portfolio source',
    allowedUseForLive: true,
    allowedUseForShadow: true,
    marketSignalConvertible: false,
  },
  orderCash: {
    domain: 'ORDER',
    name: 'order-cash',
    apiPath: '/uapi/domestic-stock/v1/trading/order-cash',
    trIdReal: 'TTTC0012U/TTTC0011U',
    trIdDemo: 'VTTC0012U/VTTC0011U',
    requiredParams: [],
    outputShape: 'output',
    primaryUse: 'live order execution only',
    allowedUseForLive: true,
    allowedUseForShadow: false,
    marketSignalConvertible: false,
  },
};
