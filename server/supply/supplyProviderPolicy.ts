/**
 * @responsibility 수급/구조 데이터의 provider 우선순위, 신뢰도, 점수 투입 가능 조건을 선언한다.
 *
 * PR-581: KIS 의존도 격하를 위한 정책 레이어.
 * KIS 는 실시간 실행/호가/종목 프로그램매매에 강하지만, 기관·외인 순매수/공매도/신용잔고 같은
 * 구조 데이터에서는 TR 목적 불일치와 accepted-empty 가 반복된다. 따라서 데이터 성격별 primary 를
 * KRX/Naver/FSS/ECOS/cache 로 재배치하고 KIS 는 강한 영역 또는 diagnostic 역할로 제한한다.
 */

export type SupplySignalKey =
  | 'price'
  | 'dailyChart'
  | 'investorFlow'
  | 'stockProgram'
  | 'marketProgram'
  | 'marketSupply'
  | 'fssPassiveActive'
  | 'shortSelling'
  | 'loanTransaction'
  | 'creditBalance'
  | 'foreignerRatioTrend'
  | 'marginBalance';

export type SupplyProvider =
  | 'KIS_API'
  | 'KRX_INVESTOR_FLOW'
  | 'KRX_MARKET_PROGRAM'
  | 'KRX_SHORT_SELLING'
  | 'KRX_MARGIN_BALANCE'
  | 'NAVER_INVESTOR_TREND'
  | 'NAVER_FOREIGNER_RATIO'
  | 'NAVER_SHORT_SELLING'
  | 'FSS_RECORDS'
  | 'ECOS_API'
  | 'FINANCIAL_INVESTMENT_ASSOCIATION'
  | 'CACHE'
  | 'MANUAL_BACKFILL';

export type SupplyProviderStatus =
  | 'OK'
  | 'STALE'
  | 'DEGRADED'
  | 'ACCEPTED_EMPTY'
  | 'PROVIDER_MISMATCH'
  | 'PROVIDER_UNAVAILABLE'
  | 'COLLECTION_EMPTY'
  | 'MISSING';

export type SupplyScoringMode =
  | 'required_real_fields'
  | 'allowed_when_non_empty'
  | 'optional'
  | 'excluded_until_wired';

export interface SupplyProviderPolicy {
  key: SupplySignalKey;
  title: string;
  primary: SupplyProvider[];
  fallback: SupplyProvider[];
  diagnostic: SupplyProvider[];
  scoringMode: SupplyScoringMode;
  confidence: Partial<Record<SupplyProvider, number>>;
  excludeStatuses: SupplyProviderStatus[];
  notes: string[];
}

export const SUPPLY_PROVIDER_POLICIES: Record<SupplySignalKey, SupplyProviderPolicy> = {
  price: {
    key: 'price',
    title: '가격/현재가',
    primary: ['KIS_API'],
    fallback: ['CACHE'],
    diagnostic: [],
    scoringMode: 'required_real_fields',
    confidence: { KIS_API: 1.0, CACHE: 0.45 },
    excludeStatuses: ['PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: [
      'KRX 복구 전까지 KIS 공식 현재가를 primary price source 로 사용한다.',
      'Yahoo 는 별도 가격 라우터에서 diagnostic-only 비교 대상으로 둔다.',
    ],
  },
  dailyChart: {
    key: 'dailyChart',
    title: '일봉/차트',
    primary: ['KIS_API'],
    fallback: ['CACHE'],
    diagnostic: [],
    scoringMode: 'required_real_fields',
    confidence: { KIS_API: 0.95, CACHE: 0.45 },
    excludeStatuses: ['PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: ['KIS chart 가 있으면 KIS OHLCV 기반 지표를 우선한다. Yahoo-only path 에서만 provider degraded 허용.'],
  },
  investorFlow: {
    key: 'investorFlow',
    title: '기관/외인 수급',
    primary: ['KIS_API', 'KRX_INVESTOR_FLOW'],
    fallback: ['CACHE', 'NAVER_INVESTOR_TREND'],
    diagnostic: ['FSS_RECORDS', 'NAVER_INVESTOR_TREND', 'CACHE'],
    scoringMode: 'required_real_fields',
    confidence: {
      KRX_INVESTOR_FLOW: 1.0,
      KIS_API: 0.9,
      FSS_RECORDS: 0.75,
      NAVER_INVESTOR_TREND: 0.55,
      CACHE: 0.45,
    },
    excludeStatuses: ['PROVIDER_MISMATCH', 'PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'ACCEPTED_EMPTY', 'MISSING'],
    notes: [
      'KRX 복구 전 긴급 운영에서는 KIS symbol-level investor-flow real fields 를 primary/weighted source 로 사용한다.',
      'KRX 투자자별 매매동향 복구 path 는 병렬 유지한다.',
      'NAVER 는 공식 원천이 아니라 SECONDARY/DISPLAY_DERIVED cross-check 및 fallback 이다.',
      '진짜 초록 조건은 외국인/기관 순매수 필드 존재 + 날짜/값 검증 통과다.',
    ],
  },
  stockProgram: {
    key: 'stockProgram',
    title: '종목 프로그램매매',
    primary: ['KIS_API'],
    fallback: ['CACHE'],
    diagnostic: ['KIS_API'],
    scoringMode: 'allowed_when_non_empty',
    confidence: { KIS_API: 0.95, CACHE: 0.6 },
    excludeStatuses: ['ACCEPTED_EMPTY', 'PROVIDER_UNAVAILABLE', 'MISSING'],
    notes: ['KIS 강점 영역으로 유지하되 zero-filled 의심은 scoring 에서 제외한다.'],
  },
  marketProgram: {
    key: 'marketProgram',
    title: '시장 프로그램매매',
    primary: ['KIS_API', 'KRX_MARKET_PROGRAM'],
    fallback: ['CACHE'],
    diagnostic: ['KIS_API'],
    scoringMode: 'allowed_when_non_empty',
    confidence: { KIS_API: 0.85, KRX_MARKET_PROGRAM: 0.9, CACHE: 0.55 },
    excludeStatuses: ['ACCEPTED_EMPTY', 'PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: ['KIS MCA00000 + output empty 는 정상 0억이 아니라 ACCEPTED_EMPTY 로 보아 점수에서 제외한다.'],
  },
  marketSupply: {
    key: 'marketSupply',
    title: '시장 수급',
    primary: ['KIS_API'],
    fallback: ['CACHE'],
    diagnostic: [],
    scoringMode: 'allowed_when_non_empty',
    confidence: { KIS_API: 0.85, CACHE: 0.5 },
    excludeStatuses: ['ACCEPTED_EMPTY', 'PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: ['KIS 시장 수급은 risk-on/off 보조로 사용하며 단독 bearish 확정 금지.'],
  },
  fssPassiveActive: {
    key: 'fssPassiveActive',
    title: 'FSS Passive/Active',
    primary: ['FSS_RECORDS'],
    fallback: ['MANUAL_BACKFILL', 'CACHE'],
    diagnostic: [],
    scoringMode: 'excluded_until_wired',
    confidence: { FSS_RECORDS: 0.9, MANUAL_BACKFILL: 0.65, CACHE: 0.5 },
    excludeStatuses: ['COLLECTION_EMPTY', 'PROVIDER_UNAVAILABLE', 'MISSING'],
    notes: ['레코드가 누적되기 전까지는 중립이며 실시간 자동매매 점수에는 넣지 않는다.'],
  },
  shortSelling: {
    key: 'shortSelling',
    title: '공매도/대차잔고',
    primary: ['KIS_API', 'KRX_SHORT_SELLING', 'NAVER_SHORT_SELLING'],
    fallback: ['CACHE'],
    diagnostic: ['KIS_API'],
    scoringMode: 'optional',
    confidence: { KIS_API: 0.85, KRX_SHORT_SELLING: 0.95, NAVER_SHORT_SELLING: 0.75, CACHE: 0.55 },
    excludeStatuses: ['PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: ['KIS 공매도/대차/신용 official pack 은 EnemyChecklist 의 high-conviction 진단 후보로 우선 사용한다. 데이터 없음은 bearish 아님.'],
  },
  loanTransaction: {
    key: 'loanTransaction',
    title: '대차거래',
    primary: ['KIS_API'],
    fallback: ['CACHE'],
    diagnostic: [],
    scoringMode: 'optional',
    confidence: { KIS_API: 0.85, CACHE: 0.5 },
    excludeStatuses: ['PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: ['KIS 대차잔고 급증은 EnemyChecklist warning 이며 데이터 없음은 providerIssue 로만 기록한다.'],
  },
  creditBalance: {
    key: 'creditBalance',
    title: '신용잔고',
    primary: ['KIS_API', 'KRX_MARGIN_BALANCE', 'FINANCIAL_INVESTMENT_ASSOCIATION'],
    fallback: ['CACHE'],
    diagnostic: [],
    scoringMode: 'optional',
    confidence: { KIS_API: 0.85, KRX_MARGIN_BALANCE: 0.9, FINANCIAL_INVESTMENT_ASSOCIATION: 0.85, CACHE: 0.5 },
    excludeStatuses: ['PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: ['KIS 신용잔고 급증은 high-conviction 진단 후보. missing 은 bearish 변환 금지.'],
  },
  foreignerRatioTrend: {
    key: 'foreignerRatioTrend',
    title: '외인 보유율 추세',
    primary: ['NAVER_FOREIGNER_RATIO'],
    fallback: ['CACHE'],
    diagnostic: [],
    scoringMode: 'optional',
    confidence: { NAVER_FOREIGNER_RATIO: 0.8, CACHE: 0.55 },
    excludeStatuses: ['COLLECTION_EMPTY', 'PROVIDER_UNAVAILABLE', 'MISSING'],
    notes: ['시계열 미누적은 장애가 아니라 warm-up 전 상태다.'],
  },
  marginBalance: {
    key: 'marginBalance',
    title: '신용잔고',
    primary: ['KIS_API', 'KRX_MARGIN_BALANCE', 'FINANCIAL_INVESTMENT_ASSOCIATION', 'ECOS_API'],
    fallback: ['CACHE'],
    diagnostic: ['ECOS_API'],
    scoringMode: 'optional',
    confidence: {
      KIS_API: 0.85,
      KRX_MARGIN_BALANCE: 0.9,
      FINANCIAL_INVESTMENT_ASSOCIATION: 0.85,
      ECOS_API: 0.7,
      CACHE: 0.5,
    },
    excludeStatuses: ['PROVIDER_UNAVAILABLE', 'COLLECTION_EMPTY', 'MISSING'],
    notes: ['ECOS 결손은 즉시 장애가 아니라 provider/wiring 미확정 상태로 둔다.'],
  },
};

export function getSupplyProviderPolicy(key: SupplySignalKey): SupplyProviderPolicy {
  return SUPPLY_PROVIDER_POLICIES[key];
}

export function getProviderConfidence(key: SupplySignalKey, provider: SupplyProvider): number {
  return SUPPLY_PROVIDER_POLICIES[key].confidence[provider] ?? 0;
}

export function isSupplyStatusScoringExcluded(key: SupplySignalKey, status: SupplyProviderStatus): boolean {
  return SUPPLY_PROVIDER_POLICIES[key].excludeStatuses.includes(status);
}

export function describeProviderRoute(key: SupplySignalKey): string {
  const policy = SUPPLY_PROVIDER_POLICIES[key];
  return `${policy.title}: primary=${policy.primary.join('>')} / fallback=${policy.fallback.join('>') || 'NONE'} / diagnostic=${policy.diagnostic.join('>') || 'NONE'} / scoring=${policy.scoringMode}`;
}
