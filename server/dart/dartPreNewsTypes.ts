// @responsibility DART 선행공시 후보 타입 SSOT
export type DartPreNewsStage = 'OBSERVE' | 'SHADOW_SCORE' | 'ADVISORY';
export type DartExecutionImpact = 'NONE';

export type DartCatalystCategory =
  | 'STRUCTURAL_POSITIVE'
  | 'CYCLICAL_POSITIVE'
  | 'SHORT_TERM_POSITIVE'
  | 'NEUTRAL_INFO'
  | 'RISK_NEGATIVE'
  | 'OVERHANG_RISK'
  | 'DILUTION_RISK'
  | 'GOVERNANCE_RISK'
  | 'UNKNOWN';

export type DataConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED'
  | 'UNKNOWN';

export type DataConfidenceSummary = {
  verified: number;
  degraded: number;
  stale: number;
  missing: number;
  aiEstimated: number;
  unknown: number;
};

export interface DartExtractedFact {
  key: string;
  label: string;
  value?: string | number;
  unit?: string;
  source: 'DART_ORIGINAL' | 'DART_PARSED' | 'AI_ESTIMATED' | 'UNKNOWN';
  confidence: DataConfidence;
}

export interface DartAiInterpretation {
  summary: string;
  possibleMarketImplication: string[];
  cautionPoints: string[];
  followUpChecks: string[];
  confidence: 'AI_ESTIMATED';
}

export interface DartPreNewsCandidate {
  id: string;
  corpCode?: string;
  stockCode?: string;
  corpName: string;
  market?: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'UNKNOWN';
  disclosureId: string;
  disclosureTitle: string;
  disclosureType: string;
  receivedAt: string;
  reportUrl?: string;
  stage: DartPreNewsStage;
  catalystCategory: DartCatalystCategory;
  catalystScore: number;
  riskScore: number;
  extractedFacts: DartExtractedFact[];
  aiInterpretation?: DartAiInterpretation;
  dataConfidence: DataConfidenceSummary;
  providerIssue: boolean;
  marketSignal: boolean;
  executionImpact: 'NONE';
  reasons: string[];
  risks: string[];
  missingData: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DartDisclosureRecord {
  corpCode?: string;
  stockCode?: string;
  corpName: string;
  market?: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'UNKNOWN';
  disclosureId: string;
  disclosureTitle: string;
  disclosureType: string;
  receivedAt: string;
  reportUrl?: string;
  bodyText?: string;
}

export interface DartFetchResult {
  disclosures: DartDisclosureRecord[];
  providerIssue: boolean;
  dataHealth: DataConfidence;
  reasons: string[];
  missingData: string[];
  executionImpact: 'NONE';
}

export type DartReason =
  | 'PASS_DART_LARGE_CONTRACT'
  | 'PASS_DART_LONG_TERM_SUPPLY'
  | 'PASS_DART_CAPEX_INVESTMENT'
  | 'PASS_DART_TREASURY_BUYBACK'
  | 'PASS_DART_PATENT_ACQUIRED'
  | 'PASS_DART_TECH_TRANSFER'
  | 'PASS_DART_EARNINGS_SURPRISE'
  | 'PASS_DART_STRUCTURAL_CATALYST'
  | 'RISK_DART_CONTRACT_TERMINATION'
  | 'RISK_DART_CAPITAL_INCREASE'
  | 'RISK_DART_CB_BW_ISSUANCE'
  | 'RISK_DART_MAJOR_SHAREHOLDER_SELL'
  | 'RISK_DART_OVERHANG'
  | 'RISK_DART_GOVERNANCE_CHANGE'
  | 'RISK_DART_TRADING_HALT'
  | 'RISK_DART_MANAGED_STOCK'
  | 'RISK_DART_UNFAITHFUL_DISCLOSURE'
  | 'PROVIDER_DART_API_KEY_MISSING'
  | 'PROVIDER_DART_RATE_LIMIT'
  | 'PROVIDER_DART_EMPTY_RESPONSE'
  | 'PROVIDER_DART_BODY_FETCH_FAILED'
  | 'PROVIDER_DART_PARSER_FAILED'
  | 'PROVIDER_DART_CORP_MAPPING_MISSING'
  | 'DATA_DART_FIELD_MISSING'
  | 'DATA_DART_FIELD_UNKNOWN';

export interface DartShadowTelemetry {
  disclosureId: string;
  stockCode?: string;
  corpCode?: string;
  learningTags: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  shadowLearning: true;
  stage: DartPreNewsStage;
  createdAt: string;
}
