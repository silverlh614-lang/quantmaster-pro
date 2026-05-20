// @responsibility Normalize Telegram NOW display labels without changing regime or trading decisions.

export interface NowDisplayNormalizeInput {
  dataHealth?: string | null;
  providerIssue?: boolean | null;
  marketSignal?: boolean | null;
  conflicts?: string[] | string | null;

  freshness?: string | null;
  ageSec?: number | null;
  ttlSec?: number | null;
  softStaleSec?: number | null;
  hardStaleSec?: number | null;
  marketSession?: string | null;
  isPostClose?: boolean | null;
  updatedAt?: string | null;
  lastRefreshSuccessAt?: string | null;

  shadowCandidateScanStatus?: string | null;
  shadowCandidateScanSkipReason?: string | null;
  shadowPolicyOn?: boolean | null;
  shadowLearningAllowed?: boolean | null;
  shadowScanAllowed?: boolean | null;
  trigger?: string | null;

  effectiveRegime?: string | null;
  riskOverride?: string | null;
}

export interface NowDisplayNormalized {
  dataLine: string;
  dataExplanation: string;
  freshnessLabel: string;
  freshnessExplanation: string;
  shadowScanLabel: string;
  shadowScanExplanation: string;
  conflictLabel: string;
  providerIsolationLabel: string;
  shouldShowRawTtl: boolean;
  notes: string[];
}

export interface R6LatchDisplayInput {
  activeR6Triggers?: string[] | null;
  previousR6Triggers?: string[] | null;
  releaseEligibleAt?: string | null;
  expiresAt?: string | null;
}

export interface R6LatchDisplayNormalized {
  state: 'ACTIVE_TRIGGER_PRESENT' | 'COOLDOWN_WAITING_CONFIRMATION' | 'NONE';
  explanation: string;
}

const POST_CLOSE_POLICY = 'VALID_UNTIL_NEXT_MARKET_REFRESH';

function asConflictList(value: NowDisplayNormalizeInput['conflicts']): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value || value === 'none') return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== 'none');
}

function isPostCloseValid(input: NowDisplayNormalizeInput): boolean {
  const session = String(input.marketSession ?? '').toUpperCase();
  return input.freshness === 'POST_CLOSE_VALID'
    || input.freshness === 'EOD_SNAPSHOT_VALID'
    || input.isPostClose === true
    || session.includes('POST_CLOSE')
    || session.includes('CLOSED');
}

function normalizedProviderIsolation(input: NowDisplayNormalizeInput): {
  label: string;
  explanation: string;
  conflictLabel?: string;
  warning?: string;
} {
  if (input.providerIssue === true && input.marketSignal === false) {
    return {
      label: 'providerIssue isolated',
      explanation: '데이터 제공자 이슈는 감지됐지만 시장 약세 신호로 전파되지 않았습니다.',
      conflictLabel: 'none - provider issue isolated from market signal',
    };
  }
  if (input.providerIssue === true && input.marketSignal === true) {
    return {
      label: 'providerIssue leaked',
      explanation: 'Provider issue와 marketSignal이 동시에 표시됩니다. 표시상 분리 여부 검토가 필요합니다.',
      conflictLabel: 'provider issue leaked into market signal - review required',
      warning: 'WARNING_PROVIDER_ISSUE_MARKET_SIGNAL_LEAK',
    };
  }
  return {
    label: input.providerIssue === true ? 'providerIssue=true' : 'providerIssue=false',
    explanation: 'Provider issue와 market signal이 분리되어 표시됩니다.',
  };
}

export function normalizeNowDisplay(input: NowDisplayNormalizeInput): NowDisplayNormalized {
  const notes: string[] = [];
  const postCloseValid = isPostCloseValid(input);
  const provider = normalizedProviderIsolation(input);
  if (provider.warning) notes.push(provider.warning);

  const conflicts = asConflictList(input.conflicts);
  const conflictLabel = provider.conflictLabel
    ?? (conflicts.length > 0 ? conflicts.join(',') : 'none');

  const dataHealth = input.dataHealth ?? 'UNKNOWN';
  const dataLineHealth = dataHealth === 'STALE' && postCloseValid ? 'POST_CLOSE_STALE_VALID' : dataHealth;
  const dataExplanation = dataLineHealth === 'POST_CLOSE_STALE_VALID'
    ? '장후 snapshot은 post-close policy로 유효합니다. Provider issue는 시장 신호로 사용되지 않았습니다.'
    : provider.explanation;

  const freshnessLabel = input.freshness ?? 'UNKNOWN';
  const freshnessExplanation = postCloseValid
    ? `장후 스냅샷 정책상 유효합니다. 장중 TTL(${input.ttlSec ?? 'N/A'}s)은 초과했을 수 있지만 다음 정규 refresh 또는 다음 거래일 확인 전까지 post-close policy(${POST_CLOSE_POLICY})로 사용됩니다.`
    : '장중 TTL 기준 freshness를 그대로 표시합니다.';

  const rawShadowStatus = input.shadowCandidateScanStatus ?? 'UNKNOWN';
  const rawSkipReason = input.shadowCandidateScanSkipReason ?? '';
  const waitingScheduled = input.shadowPolicyOn === true
    && input.shadowLearningAllowed === true
    && rawShadowStatus === 'NOT_RUN'
    && rawSkipReason === 'SCHEDULER_NOT_TRIGGERED';
  const shadowScanLabel = waitingScheduled
    ? (postCloseValid ? 'DEFERRED_POST_CLOSE' : 'WAITING_SCHEDULE')
    : rawShadowStatus;
  const shadowScanExplanation = waitingScheduled
    ? (postCloseValid
      ? '장후 구간이라 신규 후보 스캔은 대기 중이며, 보유 Shadow 포지션 관리와 학습은 계속됩니다.'
      : 'Shadow 후보 스캔은 아직 스케줄 트리거 전입니다. Shadow 포지션 관리와 학습은 ON입니다.')
    : 'Shadow candidate scan raw status를 표시합니다.';

  return {
    dataLine: `${dataLineHealth} / ${provider.label} / marketSignal=${input.marketSignal === true ? 'true' : 'false'}`,
    dataExplanation,
    freshnessLabel,
    freshnessExplanation,
    shadowScanLabel,
    shadowScanExplanation,
    conflictLabel,
    providerIsolationLabel: provider.label,
    shouldShowRawTtl: !postCloseValid,
    notes,
  };
}

export function normalizeR6LatchDisplay(input: R6LatchDisplayInput): R6LatchDisplayNormalized {
  const active = input.activeR6Triggers ?? [];
  const previous = input.previousR6Triggers ?? [];
  if (active.length > 0) {
    return {
      state: 'ACTIVE_TRIGGER_PRESENT',
      explanation: '현재 신규 R6 trigger가 활성화되어 방어 상태가 유지됩니다.',
    };
  }
  if (previous.length > 0) {
    return {
      state: 'COOLDOWN_WAITING_CONFIRMATION',
      explanation: '현재 신규 R6 trigger는 없지만, 이전 급락 trigger의 latch/cooldown이 유지 중입니다.',
    };
  }
  return {
    state: 'NONE',
    explanation: '활성 또는 보존된 R6 latch trigger가 없습니다.',
  };
}

export const NOW_POST_CLOSE_POLICY_LABEL = POST_CLOSE_POLICY;
