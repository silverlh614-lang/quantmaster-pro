/**
 * @responsibility KIS 응답 필드 매핑 상수 — 도메인별 내부 속성명을 KIS 원시 필드명에 대응시킨다.
 */

export const KIS_FIELD_MAP = {
  quote: {
    currentPrice: 'stck_prpr',
    openPrice: 'stck_oprc',
    highPrice: 'stck_hgpr',
    lowPrice: 'stck_lwpr',
    accumulatedVolume: 'acml_vol',
    accumulatedTradeAmount: 'acml_tr_pbmn',
    changeRate: 'prdy_ctrt',
  },
  ohlcv: {
    date: 'stck_bsop_date',
    open: 'stck_oprc',
    high: 'stck_hgpr',
    low: 'stck_lwpr',
    close: 'stck_clpr',
    volume: 'acml_vol',
    tradeAmount: 'acml_tr_pbmn',
  },
  supply: {
    foreignNetBuy: 'frgn_ntby_qty',
    institutionNetBuy: 'orgn_ntby_qty',
    individualNetBuy: 'prsn_ntby_qty',
    programNetBuy: 'pgtr_ntby_qty',
  },
  balance: {
    symbol: 'pdno',
    name: 'prdt_name',
    quantity: 'hldg_qty',
    averagePrice: 'pchs_avg_pric',
    currentPrice: 'prpr',
    evaluationAmount: 'evlu_amt',
    profitLoss: 'evlu_pfls_amt',
    profitLossRate: 'evlu_pfls_rt',
  },
  order: {
    orderNo: 'odno',
    orderTime: 'ord_tmd',
    acceptedQuantity: 'tot_ccld_qty',
    rejectedReason: 'rjct_rson',
  },
} as const;

export const UNKNOWN_FIELD = 'UNKNOWN_FIELD';
