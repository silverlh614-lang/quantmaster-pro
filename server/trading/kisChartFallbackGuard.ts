// @responsibility PRE_OPEN KIS chart/current-price fallback guard SSOT
/**
 * PRE_OPEN 신규 후보 발굴 경로에서 KIS chart/current-price/RealData fallback 이
 * provider 장애를 시장 신호나 매매엔진 장애로 오염시키지 않도록 세션 기반으로
 * 허용 여부를 판정한다. P0/P1 보유·매도 관리는 이 guard 로 차단하지 않는다.
 */

export type KisChartFallbackPurpose =
  | 'STAGE1_DISCOVERY'
  | 'FINAL_SCREEN_FALLBACK'
  | 'STAGE2_DISCOVERY'
  | 'P2_DISCOVERY'
  | 'P3_DIAGNOSTIC'
  | 'OPEN_POSITION'
  | 'P1_POSITION_MANAGEMENT';

export type KisFallbackSession =
  | 'PRE_OPEN'
  | 'REGULAR_TRADING'
  | 'SELL_ONLY_DIAGNOSTIC'
  | 'AFTERHOURS'
  | 'SESSION_CLOSED';

export interface KisChartFallbackDecision {
  allowed: boolean;
  session: KisFallbackSession;
  reason: 'REGULAR_TRADING' | 'PROTECTED_POSITION_MANAGEMENT' | 'SESSION_NOT_REGULAR';
  executionImpact: 'NONE';
  marketSignal: false;
  dataVacuum: false;
  newBuyBlocked: false;
  generalBuyBlocked: false;
  shadowLearning: true;
  engineAlive: true;
  evaluationState?: 'NOT_EVALUATED_PREOPEN_KIS_GUARD';
  sourcePath?: 'KRX_CACHE_ONLY_PREOPEN';
}

function kstMinutesOfDay(now: Date): number {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

export function classifyKisFallbackSession(nowKst: Date = new Date()): KisFallbackSession {
  const mins = kstMinutesOfDay(nowKst);
  if (mins >= 8 * 60 && mins < 9 * 60) return 'PRE_OPEN';
  if (mins >= 9 * 60 && mins <= 15 * 60 + 20) return 'REGULAR_TRADING';
  if (mins > 15 * 60 + 20 && mins <= 15 * 60 + 30) return 'SELL_ONLY_DIAGNOSTIC';
  if (mins > 15 * 60 + 30 && mins <= 18 * 60) return 'AFTERHOURS';
  return 'SESSION_CLOSED';
}

export function evaluateKisChartFallbackAllowed(
  nowKst: Date = new Date(),
  purpose: KisChartFallbackPurpose = 'P2_DISCOVERY',
): KisChartFallbackDecision {
  if (purpose === 'OPEN_POSITION' || purpose === 'P1_POSITION_MANAGEMENT') {
    return {
      allowed: true,
      session: classifyKisFallbackSession(nowKst),
      reason: 'PROTECTED_POSITION_MANAGEMENT',
      executionImpact: 'NONE',
      marketSignal: false,
      dataVacuum: false,
      newBuyBlocked: false,
      generalBuyBlocked: false,
      shadowLearning: true,
      engineAlive: true,
    };
  }

  const session = classifyKisFallbackSession(nowKst);
  if (session === 'REGULAR_TRADING') {
    return {
      allowed: true,
      session,
      reason: 'REGULAR_TRADING',
      executionImpact: 'NONE',
      marketSignal: false,
      dataVacuum: false,
      newBuyBlocked: false,
      generalBuyBlocked: false,
      shadowLearning: true,
      engineAlive: true,
    };
  }

  return {
    allowed: false,
    session,
    reason: 'SESSION_NOT_REGULAR',
    executionImpact: 'NONE',
    marketSignal: false,
    dataVacuum: false,
    newBuyBlocked: false,
    generalBuyBlocked: false,
    shadowLearning: true,
    engineAlive: true,
    evaluationState: 'NOT_EVALUATED_PREOPEN_KIS_GUARD',
    sourcePath: session === 'PRE_OPEN' ? 'KRX_CACHE_ONLY_PREOPEN' : undefined,
  };
}

export function isKisChartFallbackAllowed(
  nowKst: Date = new Date(),
  purpose: KisChartFallbackPurpose = 'P2_DISCOVERY',
): boolean {
  return evaluateKisChartFallbackAllowed(nowKst, purpose).allowed;
}

export function formatPreopenKisFallbackSkippedLog(input: {
  stage: 'Stage1' | 'Stage2' | 'FinalScreen';
  reason?: string;
  fallback?: 'KRX_CACHE_ONLY' | 'YAHOO_KRX_ONLY';
}): string {
  return `[PREOPEN_KIS_FALLBACK_SKIPPED]\n`
    + `stage=${input.stage}\n`
    + `reason=${input.reason ?? 'SESSION_NOT_REGULAR'}\n`
    + `fallback=${input.fallback ?? 'KRX_CACHE_ONLY'}\n`
    + `executionImpact=NONE\n`
    + `marketSignal=false\n`
    + `dataVacuum=false\n`
    + `newBuyBlocked=false\n`
    + `generalBuyBlocked=false\n`
    + `shadowLearning=true\n`
    + `engineAlive=true`;
}
