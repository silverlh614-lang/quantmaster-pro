// @responsibility Diagnostic-only KRX session guard for program-flow wiring forensics.
import {
  isKrxHoliday,
  isKrxTradingDay,
  toKstDateKey,
} from '../../calendar/krxTradingCalendar.js';

export type ProgramFlowMarketSession =
  | 'WEEKEND'
  | 'HOLIDAY'
  | 'PRE_MARKET'
  | 'WARMUP_SESSION'
  | 'REGULAR_SESSION'
  | 'CLOSING_SESSION'
  | 'AFTER_MARKET'
  | 'MARKET_CLOSED'
  | 'UNKNOWN_SESSION';

export type ProgramFlowForensicNextAction =
  | 'RETRY_DURING_REGULAR_SESSION'
  | 'CHECK_MACROSTATE_PROGRAM_CARRY'
  | 'CHECK_MARKET_PROGRAM_CONSUMER_PARSE'
  | 'CHECK_INTRADAY_PROGRAM_SNAPSHOT_PRODUCER'
  | 'CHECK_PER_STOCK_SYMBOL_MATCHING'
  | 'CHECK_STOCK_PROGRAM_CONSUMER_PARSE'
  | 'OBSERVE_DIAGNOSTIC_ONLY'
  | 'PROMOTE_TO_SHADOW_SCORE_AFTER_STABLE_CAPTURE';

export interface ProgramFlowSessionGuard {
  marketSession: ProgramFlowMarketSession;
  isTradingDay: boolean;
  kstDate: string;
  kstTime: string;
  programFlowExpected: boolean;
  programFlowExpectedReason:
    | 'PROGRAM_FLOW_EXPECTED_REGULAR_SESSION'
    | 'PROGRAM_FLOW_EXPECTED_BUT_VALUE_MISSING_DIAGNOSTIC_ONLY'
    | 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED'
    | 'PROGRAM_FLOW_SESSION_UNKNOWN';
  providerIssueSuppressedByMarketClosed: boolean;
  recheckWindowKST: '09:10~15:20';
  nextAction: ProgramFlowForensicNextAction;
  executionImpact: 'NONE';
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const PROGRAM_FLOW_EXPECTED_START_MINUTES = 9 * 60 + 10;
const PROGRAM_FLOW_EXPECTED_END_MINUTES = 15 * 60 + 20;

export function classifyProgramFlowSession(now: Date = new Date()): ProgramFlowSessionGuard {
  if (!Number.isFinite(now.getTime())) {
    return closedGuard('UNKNOWN_SESSION', '', '', 'PROGRAM_FLOW_SESSION_UNKNOWN');
  }
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const kstDate = toKstDateKey(now);
  const kstTime = `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const isTradingDay = isKrxTradingDay(kstDate);

  if (!isTradingDay) {
    const session = isKstWeekendDate(kstDate)
      ? 'WEEKEND'
      : isKrxHoliday(kstDate)
        ? 'HOLIDAY'
        : 'MARKET_CLOSED';
    return closedGuard(session, kstDate, kstTime, 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED');
  }

  if (minutes < 9 * 60) return closedGuard('PRE_MARKET', kstDate, kstTime, 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED');
  if (minutes < PROGRAM_FLOW_EXPECTED_START_MINUTES) return closedGuard('WARMUP_SESSION', kstDate, kstTime, 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED');
  if (minutes <= PROGRAM_FLOW_EXPECTED_END_MINUTES) {
    return {
      marketSession: 'REGULAR_SESSION',
      isTradingDay,
      kstDate,
      kstTime,
      programFlowExpected: true,
      programFlowExpectedReason: 'PROGRAM_FLOW_EXPECTED_REGULAR_SESSION',
      providerIssueSuppressedByMarketClosed: false,
      recheckWindowKST: '09:10~15:20',
      nextAction: 'OBSERVE_DIAGNOSTIC_ONLY',
      executionImpact: 'NONE',
    };
  }
  if (minutes < 15 * 60 + 30) return closedGuard('CLOSING_SESSION', kstDate, kstTime, 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED');
  return closedGuard('AFTER_MARKET', kstDate, kstTime, 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED');
}

function closedGuard(
  marketSession: ProgramFlowMarketSession,
  kstDate: string,
  kstTime: string,
  programFlowExpectedReason: ProgramFlowSessionGuard['programFlowExpectedReason'],
): ProgramFlowSessionGuard {
  return {
    marketSession,
    isTradingDay: marketSession !== 'WEEKEND' && marketSession !== 'HOLIDAY' && marketSession !== 'MARKET_CLOSED' && marketSession !== 'UNKNOWN_SESSION',
    kstDate,
    kstTime,
    programFlowExpected: false,
    programFlowExpectedReason,
    providerIssueSuppressedByMarketClosed: true,
    recheckWindowKST: '09:10~15:20',
    nextAction: 'RETRY_DURING_REGULAR_SESSION',
    executionImpact: 'NONE',
  };
}

function isKstWeekendDate(kstDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kstDate)) return false;
  const [year, month, day] = kstDate.split('-').map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
}
