// @responsibility Display-only labels for after-market program-flow diagnostics.
import type {
  ProgramFlowMarketProgramDisplayStatus,
} from './programFlowTypes.js';

export interface ProgramFlowAfterMarketDisplayInput {
  marketSession?: string | null;
  programFlowExpected?: boolean | null;
  marketProgramAvailable?: boolean | null;
  kisStatus?: string | null;
  marketProgramDataStatus?: string | null;
  marketProgramProviderIssue?: boolean | null;
  marketProgramMarketSignal?: boolean | string | null;
  marketProgramBreakPoint?: string | null;
  marketProgramReason?: string | null;
  programFlowUsedForLiveDecision?: boolean | null;
  passiveProxyUsedForLiveDecision?: boolean | null;
  executionImpact?: string | null;
}

export const PROGRAM_FLOW_AVAILABLE_OUTSIDE_LIVE_WINDOW = 'PROGRAM_FLOW_AVAILABLE_OUTSIDE_LIVE_WINDOW';
export const DATA_PARSED_BUT_DIAGNOSTIC_ONLY_OUTSIDE_LIVE_WINDOW =
  'DATA_PARSED_BUT_DIAGNOSTIC_ONLY_OUTSIDE_LIVE_WINDOW';
export const MARKET_PROGRAM_OUTSIDE_LIVE_WINDOW_USER_MESSAGE =
  '시장 프로그램매매 데이터는 KIS에서 정상 파싱되었습니다. 다만 현재 시간은 live 적용 구간 밖이므로 실거래 판단에는 사용하지 않고 진단/Shadow 참고용으로만 사용합니다.';

const AFTER_MARKET_SESSIONS = new Set(['AFTER_MARKET', 'AFTERMARKET', 'CLOSING_SESSION', 'POST_CLOSE']);
const PARSED_STATUSES = new Set(['PARSED', 'EOD_MARKET_PROGRAM_VALID', 'OK_NONZERO', 'OK_RAW_ZERO']);

export function resolveProgramFlowAfterMarketDisplay(
  input: ProgramFlowAfterMarketDisplayInput,
): ProgramFlowMarketProgramDisplayStatus {
  const rawBreakPoint = nonEmpty(input.marketProgramBreakPoint) ?? 'UNKNOWN';
  const rawReason = nonEmpty(input.marketProgramReason) ?? 'N/A';
  const marketSession = nonEmpty(input.marketSession) ?? 'UNKNOWN_SESSION';
  const kisStatus = nonEmpty(input.kisStatus) ?? 'NOT_ATTEMPTED';
  const dataStatus = nonEmpty(input.marketProgramDataStatus) ?? 'UNKNOWN';
  const providerIssue = input.marketProgramProviderIssue === true;
  const programDataAvailable = input.marketProgramAvailable === true;
  const programDataParsed = programDataAvailable && !providerIssue && (
    kisStatus === 'PARSED' ||
    PARSED_STATUSES.has(dataStatus)
  );
  const outsideLiveWindow =
    input.programFlowExpected === false &&
    AFTER_MARKET_SESSIONS.has(marketSession);
  const usedForLiveDecision = input.programFlowUsedForLiveDecision === true;
  const afterMarketParsedDiagnostic =
    programDataParsed &&
    outsideLiveWindow &&
    input.marketProgramProviderIssue === false &&
    typeof input.marketProgramMarketSignal === 'boolean';

  if (afterMarketParsedDiagnostic) {
    return {
      rawBreakPoint,
      displayBreakPoint: PROGRAM_FLOW_AVAILABLE_OUTSIDE_LIVE_WINDOW,
      rawReason,
      displayReason: DATA_PARSED_BUT_DIAGNOSTIC_ONLY_OUTSIDE_LIVE_WINDOW,
      programDataParsed: true,
      programDataAvailable: true,
      outsideLiveWindow: true,
      diagnosticOnly: true,
      usedForLiveDecision: false,
      usedForShadow: true,
      userMessage: MARKET_PROGRAM_OUTSIDE_LIVE_WINDOW_USER_MESSAGE,
    };
  }

  return {
    rawBreakPoint,
    displayBreakPoint: rawBreakPoint,
    rawReason,
    displayReason: rawReason,
    programDataParsed,
    programDataAvailable,
    outsideLiveWindow,
    diagnosticOnly: outsideLiveWindow || !usedForLiveDecision,
    usedForLiveDecision,
    usedForShadow: programDataAvailable && !providerIssue,
    userMessage: fallbackUserMessage({
      programDataAvailable,
      programDataParsed,
      providerIssue,
      outsideLiveWindow,
      executionImpact: input.executionImpact,
    }),
  };
}

function fallbackUserMessage(input: {
  programDataAvailable: boolean;
  programDataParsed: boolean;
  providerIssue: boolean;
  outsideLiveWindow: boolean;
  executionImpact?: string | null;
}): string {
  if (input.programDataParsed && input.outsideLiveWindow) {
    return MARKET_PROGRAM_OUTSIDE_LIVE_WINDOW_USER_MESSAGE;
  }
  if (input.providerIssue) {
    return '시장 프로그램매매 provider issue가 감지되었습니다. 이 표시는 진단 전용이며 executionImpact는 변경하지 않습니다.';
  }
  if (!input.programDataAvailable) {
    return '시장 프로그램매매 데이터가 현재 payload에서 확인되지 않았습니다. unavailable/failed 표시는 이 경우에만 사용합니다.';
  }
  return `시장 프로그램매매 데이터는 확인되었습니다. live 사용 여부는 기존 정책을 따르며 executionImpact=${input.executionImpact ?? 'NONE'}입니다.`;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
