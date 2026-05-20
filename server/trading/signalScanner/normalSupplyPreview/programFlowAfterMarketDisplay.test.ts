import { describe, expect, it } from 'vitest';
import { resolveProgramFlowAfterMarketDisplay } from './programFlowAfterMarketDisplay.js';

describe('program flow after-market display status', () => {
  it('labels parsed KIS market program data as available outside the live window', () => {
    const status = resolveProgramFlowAfterMarketDisplay({
      marketSession: 'AFTER_MARKET',
      programFlowExpected: false,
      marketProgramAvailable: true,
      kisStatus: 'PARSED',
      marketProgramDataStatus: 'NOT_EXPECTED_AFTER_MARKET',
      marketProgramProviderIssue: false,
      marketProgramMarketSignal: true,
      marketProgramBreakPoint: 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED',
      marketProgramReason: 'MARKET_CLOSED_NO_INTRADAY_PROGRAM_FLOW_EXPECTED',
      programFlowUsedForLiveDecision: false,
      passiveProxyUsedForLiveDecision: false,
      executionImpact: 'NONE',
    });

    expect(status.displayBreakPoint).toBe('PROGRAM_FLOW_AVAILABLE_OUTSIDE_LIVE_WINDOW');
    expect(status.displayReason).toBe('DATA_PARSED_BUT_DIAGNOSTIC_ONLY_OUTSIDE_LIVE_WINDOW');
    expect(status.programDataParsed).toBe(true);
    expect(status.programDataAvailable).toBe(true);
    expect(status.outsideLiveWindow).toBe(true);
    expect(status.diagnosticOnly).toBe(true);
    expect(status.usedForLiveDecision).toBe(false);
    expect(status.usedForShadow).toBe(true);
    expect(status.userMessage).toContain('정상 파싱');
    expect(status.userMessage).toContain('진단/Shadow');
  });

  it('uses the same display label during closing session when parsed data exists', () => {
    const status = resolveProgramFlowAfterMarketDisplay({
      marketSession: 'CLOSING_SESSION',
      programFlowExpected: false,
      marketProgramAvailable: true,
      kisStatus: 'PARSED',
      marketProgramDataStatus: 'PARSED',
      marketProgramProviderIssue: false,
      marketProgramMarketSignal: true,
      marketProgramBreakPoint: 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED',
      marketProgramReason: 'MARKET_CLOSED_NO_INTRADAY_PROGRAM_FLOW_EXPECTED',
      programFlowUsedForLiveDecision: false,
      passiveProxyUsedForLiveDecision: false,
      executionImpact: 'NONE',
    });

    expect(status.displayBreakPoint).toBe('PROGRAM_FLOW_AVAILABLE_OUTSIDE_LIVE_WINDOW');
    expect(status.userMessage).not.toContain('없');
    expect(status.usedForLiveDecision).toBe(false);
  });

  it('does not describe a real market signal as a provider issue', () => {
    const status = resolveProgramFlowAfterMarketDisplay({
      marketSession: 'AFTER_MARKET',
      programFlowExpected: false,
      marketProgramAvailable: true,
      kisStatus: 'PARSED',
      marketProgramDataStatus: 'PARSED',
      marketProgramProviderIssue: false,
      marketProgramMarketSignal: true,
      marketProgramBreakPoint: 'PROGRAM_FLOW_NOT_EXPECTED_MARKET_CLOSED',
      marketProgramReason: 'MARKET_CLOSED_NO_INTRADAY_PROGRAM_FLOW_EXPECTED',
      programFlowUsedForLiveDecision: false,
      passiveProxyUsedForLiveDecision: false,
      executionImpact: 'NONE',
    });

    expect(status.userMessage).not.toContain('provider issue');
    expect(status.userMessage).not.toContain('장애');
  });

  it('keeps unavailable wording for truly unavailable or failed data', () => {
    const status = resolveProgramFlowAfterMarketDisplay({
      marketSession: 'AFTER_MARKET',
      programFlowExpected: false,
      marketProgramAvailable: false,
      kisStatus: 'ERROR',
      marketProgramDataStatus: 'PROVIDER_ERROR',
      marketProgramProviderIssue: true,
      marketProgramMarketSignal: false,
      marketProgramBreakPoint: 'KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS',
      marketProgramReason: 'ALL_PROVIDERS_EMPTY',
      programFlowUsedForLiveDecision: false,
      passiveProxyUsedForLiveDecision: false,
      executionImpact: 'NONE',
    });

    expect(status.displayBreakPoint).toBe('KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS');
    expect(status.programDataAvailable).toBe(false);
    expect(status.usedForShadow).toBe(false);
    expect(status.userMessage).toContain('provider issue');
  });
});
