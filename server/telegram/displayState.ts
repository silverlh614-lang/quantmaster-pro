// @responsibility Telegram DisplayState routing/rendering SSOT. No trading decision logic.

export type TelegramSeverity =
  | 'ACTION'
  | 'POSITION'
  | 'SUMMARY'
  | 'WARNING'
  | 'DEBUG'
  | 'NOISE';

export type TelegramAudience =
  | 'USER_SIGNAL'
  | 'USER_BOT'
  | 'OPERATOR_DEBUG'
  | 'INTERNAL_LOG_ONLY';

export interface DisplayState {
  audience: TelegramAudience;
  severity: TelegramSeverity;
  eventType: string;
  symbol?: string;
  name?: string;
  decision?: string;
  label?: string;
  finalScore?: number;
  executionScore?: number;
  adjustmentScore?: number;
  advisoryScore?: number;
  positionAmount?: number;
  entryPrice?: number;
  stopLoss?: number;
  initialStopLoss?: number;
  currentStopLoss?: number;
  targetPrice?: number;
  targetPrice1?: number;
  riskReward?: number;
  riskReward1?: number;
  tradePlanId?: string;
  tp1SellPct?: number;
  moveStopToBreakevenAfterTp1?: boolean;
  mode?: 'LIVE' | 'SHADOW' | 'COUNTERFACTUAL';
  lifecycleStage?: string;
  tradingDate?: string;
  summaryLines: string[];
  debugLines?: string[];
  hiddenDebugCount?: number;
}

export interface TelegramRouteResult {
  displayState: DisplayState;
  audience: TelegramAudience;
  severity: TelegramSeverity;
  messageKey: string;
  sentToUserChannel: boolean;
  sentToDebugChannel: boolean;
  storedInternal: true;
  notificationSuppressed: boolean;
  reason?: 'DUPLICATE_OR_NOISE';
  executionDecisionImpact: 'NONE';
  learningImpact: 'NONE';
  hiddenDebugCount: number;
}

const userMessageKeys = new Set<string>();

const USER_SIGNAL_EVENTS = new Set([
  'BUY_CANDIDATE',
  'SHADOW_FILL',
  'POSITION_OPENED',
  'POSITION_PARTIAL_CLOSED',
  'POSITION_CLOSED',
  'STOP_LOSS_RAISED',
  'TARGET_REACHED',
  'DAILY_SUMMARY',
  'CRITICAL_SYSTEM_FAILURE',
]);

const DEBUG_EVENT_TYPES = new Set([
  'ALWAYS_ON_POLICY_APPLIED',
  'VOLUME_CLOCK_ADJUSTMENT_APPLIED',
  'REGIME_ADJUSTMENT_APPLIED',
  'AI_ESTIMATE_EXCLUDED_FROM_EXECUTION',
  'SCORE_CONFIDENCE_SPLIT',
  'DEDUP_EXECUTION_AUTHORITY_REMOVED',
  'STALE_DEDUP_LOCK_SUSPECTED',
  'POSITION_POLICY_SIMPLE_APPLIED',
  'SIMPLE_DECISION_FINAL',
  'KIS_REALDATA_500',
  'PROVIDER_ISSUE_ISOLATED_FROM_MARKET_SIGNAL',
  'EMPTY_RESPONSE_CLASSIFIED_AS_NO_DATA',
  'DATA_VACUUM_CLASSIFIED_AS_DATA_GAP',
  'DIAGNOSTIC_PROVIDER_ISSUE_ISOLATED',
]);

const FORBIDDEN_USER_PHRASES = [
  ['R6_DEFENSE', '신규 진입 차단'].join(' '),
  ['블랙스완 감지로', '매수 금지'].join(' '),
  'SELL_ONLY',
  ['Volume Clock', '매수 차단'].join(' '),
  '신규 진입 차단',
  'Kelly',
  ['STRONG_BUY', '조건 미충족'].join(' '),
  ['AI 추천으로', '매수'].join(' '),
  ['Gemini 추천으로', 'BUY_ALLOWED'].join(' '),
];

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

function tradingDateFromNow(nowMs = Date.now()): string {
  return new Date(nowMs).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function isBuyAllowed(state: DisplayState): boolean {
  return state.decision === 'BUY_ALLOWED';
}

function isWatchOrReject(state: DisplayState): boolean {
  return state.decision === 'WATCH'
    || state.decision === 'REJECT_LOW_SCORE'
    || state.decision === 'WATCH_RR_INSUFFICIENT'
    || state.decision === 'WATCH_SLOT_FULL'
    || state.decision === 'NO_TRADE_DATA_INCOMPLETE';
}

function isNearBuyWatch(state: DisplayState): boolean {
  return state.decision === 'WATCH'
    && typeof state.finalScore === 'number'
    && Number.isFinite(state.finalScore)
    && state.finalScore >= 68;
}

export function resolveTelegramAudience(state: DisplayState): TelegramAudience {
  if (state.audience === 'USER_BOT') return 'USER_BOT';
  if (state.audience === 'INTERNAL_LOG_ONLY') return 'INTERNAL_LOG_ONLY';
  if (state.audience === 'OPERATOR_DEBUG') return 'OPERATOR_DEBUG';
  if (state.severity === 'NOISE') return 'INTERNAL_LOG_ONLY';
  if (state.severity === 'DEBUG' || DEBUG_EVENT_TYPES.has(state.eventType)) return 'OPERATOR_DEBUG';
  if (state.eventType === 'BUY_CANDIDATE') {
    if (isBuyAllowed(state) || isNearBuyWatch(state)) return 'USER_SIGNAL';
    return 'INTERNAL_LOG_ONLY';
  }
  if (isWatchOrReject(state)) return 'INTERNAL_LOG_ONLY';
  if (USER_SIGNAL_EVENTS.has(state.eventType)) return 'USER_SIGNAL';
  return state.audience;
}

export function buildTelegramMessageKey(state: DisplayState, audience: TelegramAudience, nowMs = Date.now()): string {
  const tradingDate = state.tradingDate ?? tradingDateFromNow(nowMs);
  return [
    tradingDate,
    audience,
    state.eventType,
    state.symbol ?? 'GLOBAL',
    state.lifecycleStage ?? state.decision ?? 'STATE',
  ].join(':');
}

export function routeTelegramDisplayState(state: DisplayState, nowMs = Date.now()): TelegramRouteResult {
  const audience = resolveTelegramAudience(state);
  const messageKey = buildTelegramMessageKey(state, audience, nowMs);
  const eligibleUserChannel = audience === 'USER_SIGNAL'
    && ['ACTION', 'POSITION', 'SUMMARY', 'WARNING'].includes(state.severity);
  const duplicate = eligibleUserChannel && userMessageKeys.has(messageKey);
  if (eligibleUserChannel && !duplicate) userMessageKeys.add(messageKey);
  const notificationSuppressed = duplicate || audience === 'INTERNAL_LOG_ONLY' || audience === 'OPERATOR_DEBUG';

  return {
    displayState: state,
    audience,
    severity: state.severity,
    messageKey,
    sentToUserChannel: eligibleUserChannel && !duplicate,
    sentToDebugChannel: audience === 'OPERATOR_DEBUG',
    storedInternal: true,
    notificationSuppressed,
    reason: notificationSuppressed ? 'DUPLICATE_OR_NOISE' : undefined,
    executionDecisionImpact: 'NONE',
    learningImpact: 'NONE',
    hiddenDebugCount: state.hiddenDebugCount ?? state.debugLines?.length ?? 0,
  };
}

function formatNumber(value: number | undefined, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : 'n/a';
}

function formatPrice(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : 'n/a';
}

function userVisibleSummaryLines(lines: readonly string[]): string[] {
  return lines.filter((line) => !FORBIDDEN_USER_PHRASES.some((phrase) => line.includes(phrase)));
}

export function renderDisplayState(state: DisplayState): string {
  const audience = resolveTelegramAudience(state);
  const summaryLines = audience === 'USER_SIGNAL'
    ? userVisibleSummaryLines(state.summaryLines)
    : state.summaryLines;

  if (state.eventType === 'BUY_CANDIDATE' && audience === 'USER_SIGNAL') {
    return [
      '📌 [BUY 후보]',
      `종목: ${state.name ?? 'n/a'} (${state.symbol ?? 'n/a'})`,
      `판단: ${state.decision ?? 'n/a'} / ${state.label ?? 'n/a'}`,
      `점수: ${formatNumber(state.finalScore, '점')}`,
      `진입가: ${formatPrice(state.entryPrice)}`,
      `손절가: ${formatPrice(state.initialStopLoss ?? state.stopLoss)}`,
      `목표가: ${formatPrice(state.targetPrice1 ?? state.targetPrice)}`,
      `R:R: ${formatNumber(state.riskReward1 ?? state.riskReward)}`,
      `비중: ${formatPrice(state.positionAmount)}`,
      `모드: ${state.mode ?? 'n/a'}`,
      `TradePlan: ${state.tradePlanId ?? 'n/a'}`,
      `TP1: ${formatNumber(state.tp1SellPct !== undefined ? state.tp1SellPct * 100 : undefined, '%')}`,
      `BE after TP1: ${state.moveStopToBreakevenAfterTp1 === undefined ? 'n/a' : state.moveStopToBreakevenAfterTp1 ? 'ON' : 'OFF'}`,
      '',
      '보조 정보:',
      ...summaryLines.map((line) => `- ${line}`),
    ].join('\n');
  }

  return summaryLines.join('\n');
}

export function formatTelegramEventRoutedLog(route: TelegramRouteResult): string {
  return [
    '[TELEGRAM_EVENT_ROUTED]',
    kv('eventType', route.displayState.eventType),
    kv('symbol', route.displayState.symbol),
    kv('severity', route.severity),
    kv('audience', route.audience),
    kv('sentToUserChannel', route.sentToUserChannel),
    kv('sentToDebugChannel', route.sentToDebugChannel),
    kv('storedInternal', route.storedInternal),
    kv('hiddenDebugCount', route.hiddenDebugCount),
  ].join(' ');
}

export function formatTelegramUserNoiseSuppressedLog(route: TelegramRouteResult): string {
  return [
    '[TELEGRAM_USER_NOISE_SUPPRESSED]',
    kv('eventType', route.displayState.eventType),
    kv('symbol', route.displayState.symbol),
    kv('reason', route.reason ?? 'DUPLICATE_OR_NOISE'),
    `redirectedTo='${route.audience}'`,
    "executionImpact='NONE'",
    "learningImpact='NONE'",
  ].join(' ');
}

export function formatDisplayStateRenderedLog(route: TelegramRouteResult): string {
  return [
    '[DISPLAY_STATE_RENDERED]',
    kv('eventType', route.displayState.eventType),
    kv('symbol', route.displayState.symbol),
    kv('decision', route.displayState.decision),
    kv('label', route.displayState.label),
    kv('finalScore', route.displayState.finalScore),
    kv('audience', route.audience),
    kv('severity', route.severity),
    "renderer='DISPLAY_STATE_ONLY'",
  ].join(' ');
}

export function formatTelegramNotificationSuppressedLog(route: TelegramRouteResult): string {
  return [
    '[TELEGRAM_NOTIFICATION_SUPPRESSED]',
    kv('messageKey', route.messageKey),
    kv('eventType', route.displayState.eventType),
    kv('symbol', route.displayState.symbol),
    kv('audience', route.audience),
    "reason='DUPLICATE_OR_NOISE'",
    "executionDecisionImpact='NONE'",
    "learningImpact='NONE'",
  ].join(' ');
}

export function __resetTelegramDisplayStateForTests(): void {
  userMessageKeys.clear();
}
