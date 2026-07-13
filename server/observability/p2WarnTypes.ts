// @responsibility Shared warning contracts for auxiliary operational diagnostics.

export type ProviderWarnSource =
  | 'GEMINI'
  | 'GOOGLE_SEARCH'
  | 'DART'
  | 'YAHOO'
  | 'LOCAL_RAG'
  | 'AI_PROVIDER'
  | 'SCREENER'
  | 'SECTOR'
  | 'KIS_AUX'
  | 'KRX_AUX';

export type ReportSection =
  | 'SCAN_BLOCKERS'
  | 'LEARNING_STATUS'
  | 'NORMAL_SUPPLY_PREVIEW'
  | 'PROGRAM_MARKET'
  | 'PROGRAM_TODAY'
  | 'R3_UNBLOCK'
  | 'UNMANAGE_ONLY'
  | 'MARKET_REPORT'
  | 'POSITION_REPORT'
  | 'PNL_REPORT';
