// @responsibility ADR-0118 ScanCounters 확장 + buildMacroGateState + formatScanBlockersMessage 회귀
import { describe, expect, it } from 'vitest';
import {
  buildMacroGateState,
  buildWaitDistribution,
  createScanCounters,
  formatScanBlockersMessage,
  type ScanSummary,
} from './scanDiagnostics.js';

describe('createScanCounters — ADR-0118 신규 카운터 초기화', () => {
  it('waitDataHold/preBreakout/gateFail/sizingBlocked/driftRemove/corpAction/volumeDrop/other 모두 0', () => {
    const c = createScanCounters();
    expect(c.waitDataHold).toBe(0);
    expect(c.waitPreBreakout).toBe(0);
    expect(c.waitGateFail).toBe(0);
    expect(c.waitSizingBlocked).toBe(0);
    expect(c.waitDriftRemove).toBe(0);
    expect(c.waitDriftCorpAction).toBe(0);
    expect(c.waitVolumeDrop).toBe(0);
    expect(c.waitOther).toBe(0);
  });

  it('기존 카운터 (yahooFails/gateMisses/rrrMisses/entries) 보존', () => {
    const c = createScanCounters();
    expect(c.yahooFails).toBe(0);
    expect(c.gateMisses).toBe(0);
    expect(c.rrrMisses).toBe(0);
    expect(c.entries).toBe(0);
    expect(c.counterfactualRecordedToday).toBe(0);
    expect(c.pendingTraces).toEqual([]);
  });
});

describe('buildWaitDistribution — ScanCounters → WaitDistribution', () => {
  it('카운터 값 그대로 매핑', () => {
    const c = createScanCounters();
    c.waitDataHold = 8;
    c.waitPreBreakout = 7;
    c.waitGateFail = 25;
    c.waitSizingBlocked = 2;
    c.waitDriftRemove = 1;
    c.waitDriftCorpAction = 3;
    c.waitVolumeDrop = 4;
    c.waitOther = 5;

    const wd = buildWaitDistribution(c);
    expect(wd.dataHold).toBe(8);
    expect(wd.preBreakout).toBe(7);
    expect(wd.gateFail).toBe(25);
    expect(wd.sizingBlocked).toBe(2);
    expect(wd.driftRemove).toBe(1);
    expect(wd.corpAction).toBe(3);
    expect(wd.volumeDrop).toBe(4);
    expect(wd.other).toBe(5);
  });

  it('빈 카운터 → 모두 0', () => {
    const wd = buildWaitDistribution(createScanCounters());
    expect(wd.dataHold + wd.preBreakout + wd.gateFail + wd.sizingBlocked
         + wd.driftRemove + wd.corpAction + wd.volumeDrop + wd.other).toBe(0);
  });
});

describe('buildMacroGateState — 거시 게이트 상태 빌더', () => {
  it('정상 R2_BULL + FOMC NORMAL → finalKelly = regimeKelly × fomcKelly', () => {
    const mg = buildMacroGateState({
      emergencyStop: false,
      autoTradeEnabled: true,
      regime: 'R2_BULL',
      regimeKelly: 0.8,
      fomcPhase: 'NORMAL',
      fomcKelly: 1.0,
      finalKelly: 0.8,
      vixGatingActive: false,
      bearDefenseMode: false,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: false,
    });
    expect(mg.regime).toBe('R2_BULL');
    expect(mg.kellyMultiplierFromRegime).toBe(0.8);
    expect(mg.fomcPhase).toBe('NORMAL');
    expect(mg.finalKellyMultiplier).toBe(0.8);
    expect(mg.emergencyStop).toBe(false);
  });

  it('FOMC POST_1 + R4_NEUTRAL → finalKelly=1.30 (FOMC 우선)', () => {
    const mg = buildMacroGateState({
      emergencyStop: false,
      autoTradeEnabled: true,
      regime: 'R4_NEUTRAL',
      regimeKelly: 0.5,
      fomcPhase: 'POST_1',
      fomcKelly: 1.30,
      finalKelly: 1.30,  // ADR-0076 FOMC 우선
      vixGatingActive: false,
      bearDefenseMode: false,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: true,  // 점심 시간대
    });
    expect(mg.fomcKellyMultiplier).toBe(1.30);
    expect(mg.finalKellyMultiplier).toBe(1.30);
    expect(mg.sellOnlyMode).toBe(true);
  });

  it('R6_DEFENSE → finalKelly=0 (R6_OVERRIDE)', () => {
    const mg = buildMacroGateState({
      emergencyStop: false,
      autoTradeEnabled: true,
      regime: 'R6_DEFENSE',
      regimeKelly: 0,
      fomcPhase: 'POST_1',
      fomcKelly: 1.30,
      finalKelly: 0,  // R6_OVERRIDE
      vixGatingActive: false,
      bearDefenseMode: true,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: false,
    });
    expect(mg.finalKellyMultiplier).toBe(0);
    expect(mg.bearDefenseMode).toBe(true);
  });

  it('emergencyStop=true / autoTradeEnabled=false 명시 보존', () => {
    const mg = buildMacroGateState({
      emergencyStop: true,
      autoTradeEnabled: false,
      regime: 'R4_NEUTRAL',
      regimeKelly: 0.5,
      fomcPhase: 'NORMAL',
      fomcKelly: 1.0,
      finalKelly: 0.5,
      vixGatingActive: false,
      bearDefenseMode: false,
      mhsBelow30: false,
      watchlistEmpty: false,
      sellOnlyMode: false,
    });
    expect(mg.emergencyStop).toBe(true);
    expect(mg.autoTradeEnabled).toBe(false);
  });
});

const SUMMARY_BASE: ScanSummary = {
  time: '12:34 KST',
  candidates: 43,
  trackB: 43,
  swing: 6,
  catalyst: 4,
  momentum: 33,
  yahooFails: 0,
  gateMisses: 25,
  rrrMisses: 0,
  entries: 0,
  waitDistribution: {
    dataHold: 0, preBreakout: 7, gateFail: 25, sizingBlocked: 0,
    driftRemove: 0, corpAction: 0, volumeDrop: 3, other: 0,
  },
  macroGateState: {
    emergencyStop: false,
    autoTradeEnabled: true,
    regime: 'R4_NEUTRAL',
    kellyMultiplierFromRegime: 0.5,
    fomcPhase: 'POST_1',
    fomcKellyMultiplier: 1.30,
    finalKellyMultiplier: 1.30,
    vixGatingActive: false,
    bearDefenseMode: false,
    mhsBelow30: false,
    watchlistEmpty: false,
    sellOnlyMode: false,
  },
};

describe('formatScanBlockersMessage — 진단 메시지 SSOT', () => {
  it('summary=null → "진단 데이터 없음"', () => {
    const msg = formatScanBlockersMessage(null);
    expect(msg).toMatch(/진단 데이터 없음/);
  });

  it('정상 흐름 — 거시 게이트 + 종목 분포 + 추정 원인', () => {
    const msg = formatScanBlockersMessage(SUMMARY_BASE);
    expect(msg).toMatch(/12:34 KST/);
    expect(msg).toMatch(/R4_NEUTRAL/);
    expect(msg).toMatch(/POST_1/);
    expect(msg).toMatch(/×1\.30/);
    expect(msg).toMatch(/Gate 재검증 미달: 25개/);
    expect(msg).toMatch(/Pre-breakout WAIT: 7개/);
    expect(msg).toMatch(/💡 .*추정 원인/);
  });

  it('emergencyStop=true → 추정 원인 "비상정지"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      macroGateState: { ...SUMMARY_BASE.macroGateState!, emergencyStop: true },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/emergencyStop:.*ON/);
    expect(msg).toMatch(/비상정지 활성/);
  });

  it('R6_DEFENSE → 추정 원인 "R6_DEFENSE 레짐"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      macroGateState: {
        ...SUMMARY_BASE.macroGateState!,
        regime: 'R6_DEFENSE',
        kellyMultiplierFromRegime: 0,
        finalKellyMultiplier: 0,
      },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/R6_DEFENSE/);
    expect(msg).toMatch(/Kelly ×0\.0/);
  });

  it('SELL_ONLY=true → 추정 원인 "SELL_ONLY 시간대"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      macroGateState: { ...SUMMARY_BASE.macroGateState!, sellOnlyMode: true },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/SELL_ONLY:.*ON/);
    expect(msg).toMatch(/SELL_ONLY 시간대/);
  });

  it('워치리스트 0건 → 추정 원인 "워치리스트 0개"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      candidates: 0,
      macroGateState: { ...SUMMARY_BASE.macroGateState!, watchlistEmpty: true },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/워치리스트:.*0개/);
    expect(msg).toMatch(/워치리스트 0개/);
  });

  it('DATA_HOLD 30%+ → 추정 원인 "sanity 위반 다수"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      candidates: 10,
      waitDistribution: {
        dataHold: 5, preBreakout: 0, gateFail: 0, sizingBlocked: 0,
        driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0,
      },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/DATA_HOLD: 5개/);
    expect(msg).toMatch(/sanity 위반 다수/);
  });

  it('Gate 재검증 50%+ → 추정 원인 "minGate 임계 검토"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      candidates: 10,
      waitDistribution: {
        dataHold: 0, preBreakout: 0, gateFail: 8, sizingBlocked: 0,
        driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0,
      },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/Gate 재검증 미달/);
    expect(msg).toMatch(/minGate 임계.*검토|EXECUTION_RELAXATION/);
  });

  it('autoTradeEnabled=false → 추정 원인 "AUTO_TRADE_ENABLED=false"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      macroGateState: { ...SUMMARY_BASE.macroGateState!, autoTradeEnabled: false },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/AUTO_TRADE_ENABLED=false/);
  });

  it('waitDistribution 부재 (레거시) → 기존 카운터 폴백 표시', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      waitDistribution: undefined,
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/waitDistribution 미수집/);
  });

  it('macroGateState 부재 → 거시 게이트 섹션 미표시', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      macroGateState: undefined,
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).not.toMatch(/거시 게이트:/);
  });

  it('Bear Defense → 추정 원인 "Bear Defense 모드"', () => {
    const summary: ScanSummary = {
      ...SUMMARY_BASE,
      macroGateState: { ...SUMMARY_BASE.macroGateState!, bearDefenseMode: true },
    };
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/bearDefenseMode:.*ON/);
    expect(msg).toMatch(/Bear Defense/);
  });
});

describe('scanBlockers.cmd 등록', () => {
  it('commandRegistry 에 /scan_blockers 등록 (alias /blockers, /why_no_buy)', async () => {
    await import('../../telegram/commands/system/scanBlockers.cmd.js');
    const { commandRegistry } = await import('../../telegram/commandRegistry.js');
    const main = commandRegistry.resolve('/scan_blockers');
    const aliasA = commandRegistry.resolve('/blockers');
    const aliasB = commandRegistry.resolve('/why_no_buy');
    expect(main).toBeDefined();
    expect(aliasA).toBeDefined();
    expect(aliasB).toBeDefined();
    expect(main).toBe(aliasA);
    expect(main).toBe(aliasB);
    expect(main?.category).toBe('SYS');
    expect(main?.riskLevel).toBe(0);
    expect(main?.visibility).toBe('ADMIN');
  });
});
