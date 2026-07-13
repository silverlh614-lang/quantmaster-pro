// @responsibility User-facing notification wording tone policy.

type MessageToneLevel =
  | 'CRITICAL_ALERT'
  | 'ACTION_REQUIRED'
  | 'TRADE_EVENT'
  | 'CAUTION_SUMMARY'
  | 'OBSERVE'
  | 'DIAGNOSTIC'
  | 'DEBUG_ONLY';

export interface MessageWordingInput {
  eventType: string;
  originalTone?: MessageToneLevel | 'WARNING' | string;
  executionImpact?: 'NONE' | string;
  actionRequired?: boolean;
  diagnosticOnly?: boolean;
  tradeEvent?: boolean;
  critical?: boolean;
  debugOnly?: boolean;
  displayTextType?: string;
}

export interface MessageWordingDecision {
  eventType: string;
  originalTone: string;
  mappedTone: MessageToneLevel;
  executionImpact: 'NONE' | string;
  actionRequired: boolean;
  diagnosticOnly: boolean;
  displayTextType: string;
  userActionText: '조치 필요: 있음' | '조치 필요: 없음' | '승인 필요: true';
  impactText: '매매 영향: 있음' | '매매 영향: 없음' | '실행 영향: 없음';
  notificationOnly: true;
  displayOnly: true;
  tradingLogicChanged: false;
  gateLogicChanged: false;
  orderLogicChanged: false;
  thresholdChanged: false;
  providerSelectionChanged: false;
  watchlistSelectionChanged: false;
}

function boolText(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}

function resolveMessageToneLevel(input: MessageWordingInput): MessageToneLevel {
  if (input.debugOnly) return 'DEBUG_ONLY';
  if (input.critical) return 'CRITICAL_ALERT';
  if (input.tradeEvent) return 'TRADE_EVENT';
  if (input.actionRequired) return 'ACTION_REQUIRED';
  if (input.diagnosticOnly) return 'DIAGNOSTIC';
  if ((input.executionImpact ?? 'NONE') === 'NONE') return 'OBSERVE';
  return 'CAUTION_SUMMARY';
}

export function buildMessageWordingDecision(input: MessageWordingInput): MessageWordingDecision {
  const executionImpact = input.executionImpact ?? 'NONE';
  const actionRequired = input.actionRequired === true;
  const diagnosticOnly = input.diagnosticOnly === true;
  const mappedTone = resolveMessageToneLevel(input);
  const approvalPrompt = actionRequired && String(input.displayTextType ?? '').includes('APPROVAL');
  const userActionText = actionRequired
    ? (approvalPrompt ? '승인 필요: true' : '조치 필요: 있음')
    : '조치 필요: 없음';
  const impactText = executionImpact === 'NONE'
    ? (diagnosticOnly ? '실행 영향: 없음' : '매매 영향: 없음')
    : '매매 영향: 있음';

  return {
    eventType: input.eventType,
    originalTone: input.originalTone ?? mappedTone,
    mappedTone,
    executionImpact,
    actionRequired,
    diagnosticOnly,
    displayTextType: input.displayTextType ?? 'SUMMARY',
    userActionText,
    impactText,
    notificationOnly: true,
    displayOnly: true,
    tradingLogicChanged: false,
    gateLogicChanged: false,
    orderLogicChanged: false,
    thresholdChanged: false,
    providerSelectionChanged: false,
    watchlistSelectionChanged: false,
  };
}

export function canUseRestrictedIncidentWords(input: Pick<MessageWordingDecision, 'actionRequired' | 'executionImpact' | 'mappedTone'>): boolean {
  return input.actionRequired ||
    input.executionImpact !== 'NONE' ||
    input.mappedTone === 'CRITICAL_ALERT' ||
    input.mappedTone === 'TRADE_EVENT';
}

function safetyFields(decision: MessageWordingDecision): string {
  return [
    'notificationOnly=true',
    'displayOnly=true',
    'tradingLogicChanged=false',
    'gateLogicChanged=false',
    'orderLogicChanged=false',
    'thresholdChanged=false',
    'providerSelectionChanged=false',
    'watchlistSelectionChanged=false',
    `executionImpact=${decision.executionImpact}`,
  ].join(' ');
}

export function formatMessageWordingMappedLog(decision: MessageWordingDecision): string {
  return [
    '[MESSAGE_WORDING_MAPPED]',
    `eventType=${decision.eventType}`,
    `originalTone=${decision.originalTone}`,
    `mappedTone=${decision.mappedTone}`,
    `executionImpact=${decision.executionImpact}`,
    `actionRequired=${boolText(decision.actionRequired)}`,
    `diagnosticOnly=${boolText(decision.diagnosticOnly)}`,
    `displayTextType=${decision.displayTextType}`,
    safetyFields(decision),
  ].join(' ');
}

export function formatDiagnosticWordingDowngradedLog(
  decision: MessageWordingDecision,
  reason: string,
): string {
  return [
    '[DIAGNOSTIC_WORDING_DOWNGRADED]',
    `eventType=${decision.eventType}`,
    `reason=${reason}`,
    `fromTone=${decision.originalTone}`,
    `toTone=${decision.mappedTone}`,
    `executionImpact=${decision.executionImpact}`,
    safetyFields(decision),
  ].join(' ');
}

export function formatUserActionLabelResolvedLog(decision: MessageWordingDecision): string {
  return [
    '[USER_ACTION_LABEL_RESOLVED]',
    `actionRequired=${boolText(decision.actionRequired)}`,
    `userActionText=${decision.userActionText.replace(/\s+/g, '_')}`,
    `executionImpact=${decision.executionImpact}`,
    safetyFields(decision),
  ].join(' ');
}

export function formatCausalReasonSuppressedLog(
  decision: MessageWordingDecision,
  reason: string,
  count: number,
): string {
  return [
    '[CAUSAL_REASON_SUPPRESSED]',
    `reason=${reason}`,
    `count=${count}`,
    'causedEntryHold=false',
    'causalArrowSuppressed=true',
    safetyFields(decision),
  ].join(' ');
}
