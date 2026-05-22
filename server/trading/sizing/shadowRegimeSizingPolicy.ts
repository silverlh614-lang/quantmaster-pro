// @responsibility Shadow regime sizing cap policy.

export type ShadowRegimeSizingLevel =
  | 'R6_DEFENSE'
  | 'R5_RECOVERY_WATCH'
  | 'R4_CAUTION'
  | 'R3_NEUTRAL'
  | 'R2_RISK_ON'
  | 'R1_AGGRESSIVE';

export type ShadowSizingSource = 'SHADOW_REGIME_SIZING_POLICIES';

export type ShadowRegimeSizingBlockReason =
  | 'REGIME_SHADOW_SLOT_BLOCKED'
  | 'REGIME_EXPOSURE_CAP_REACHED'
  | 'VIRTUAL_CASH_EXHAUSTED'
  | 'LIVE_SIZING_ENGINE_BLOCKED';

export interface ShadowRegimeSizingPolicy {
  level: ShadowRegimeSizingLevel;
  maxSymbols: number;
  maxPositionPct: number;
  totalExposureCap: number;
  perSymbolCapPct: number;
  totalExposureCapPct: number;
  liveBuyPctMin: number;
  liveBuyPctMax: number;
}

export const SHADOW_REGIME_SIZING_POLICIES: Record<ShadowRegimeSizingLevel, ShadowRegimeSizingPolicy> = {
  R6_DEFENSE: {
    level: 'R6_DEFENSE',
    maxSymbols: 3,
    maxPositionPct: 0.10,
    totalExposureCap: 0.20,
    perSymbolCapPct: 10,
    totalExposureCapPct: 20,
    liveBuyPctMin: 0,
    liveBuyPctMax: 0.10,
  },
  R5_RECOVERY_WATCH: {
    level: 'R5_RECOVERY_WATCH',
    maxSymbols: 3,
    maxPositionPct: 0.10,
    totalExposureCap: 0.20,
    perSymbolCapPct: 10,
    totalExposureCapPct: 20,
    liveBuyPctMin: 0,
    liveBuyPctMax: 0.10,
  },
  R4_CAUTION: {
    level: 'R4_CAUTION',
    maxSymbols: 4,
    maxPositionPct: 0.10,
    totalExposureCap: 0.40,
    perSymbolCapPct: 10,
    totalExposureCapPct: 40,
    liveBuyPctMin: 0.20,
    liveBuyPctMax: 0.40,
  },
  R3_NEUTRAL: {
    level: 'R3_NEUTRAL',
    maxSymbols: 6,
    maxPositionPct: 0.10,
    totalExposureCap: 0.60,
    perSymbolCapPct: 10,
    totalExposureCapPct: 60,
    liveBuyPctMin: 0.40,
    liveBuyPctMax: 0.60,
  },
  R2_RISK_ON: {
    level: 'R2_RISK_ON',
    maxSymbols: 8,
    maxPositionPct: 0.10,
    totalExposureCap: 0.80,
    perSymbolCapPct: 10,
    totalExposureCapPct: 80,
    liveBuyPctMin: 0.60,
    liveBuyPctMax: 0.80,
  },
  R1_AGGRESSIVE: {
    level: 'R1_AGGRESSIVE',
    maxSymbols: 10,
    maxPositionPct: 0.10,
    totalExposureCap: 1.00,
    perSymbolCapPct: 10,
    totalExposureCapPct: 100,
    liveBuyPctMin: 0.80,
    liveBuyPctMax: 1.00,
  },
};

export interface ResolveShadowRegimeSizingInput {
  regime?: string | null;
  effectiveRegime?: string | null;
  r6RecoveryStatus?: string | null;
  engineMode?: string | null;
  riskOverride?: string | null;
}

export interface CalculateShadowRegimeSizingInput {
  regimeLevel: ShadowRegimeSizingLevel;
  liveSizingEngineBudget: number;
  totalShadowEquity: number;
  currentShadowExposure: number;
  availableVirtualCash: number;
  openShadowSymbolCount: number;
}

export interface ShadowRegimeSizingResult {
  allowed: boolean;
  blockReason?: ShadowRegimeSizingBlockReason;
  sizingSource: ShadowSizingSource;
  liveOrderSent: false;
  executionImpact: 'NONE';
  policy: ShadowRegimeSizingPolicy;
  liveSizingEngineBudget: number;
  perPositionBudgetCap: number;
  remainingRegimeExposureBudget: number;
  availableVirtualCash: number;
  finalShadowBudget: number;
  cappedBy: Array<'LIVE_SIZING_ENGINE' | 'MAX_POSITION_PCT' | 'TOTAL_EXPOSURE_CAP' | 'VIRTUAL_CASH'>;
}

function normalizeToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function resolveShadowRegimeSizingLevel(input: ResolveShadowRegimeSizingInput): ShadowRegimeSizingLevel {
  const effectiveRegime = normalizeToken(input.effectiveRegime);
  const engineMode = normalizeToken(input.engineMode);
  const riskOverride = normalizeToken(input.riskOverride);
  const rawRegime = normalizeToken(input.regime);
  const recoveryStatus = normalizeToken(input.r6RecoveryStatus);

  const r6PriorityTokens = [effectiveRegime, engineMode, riskOverride].join(' ');
  if (
    r6PriorityTokens.includes('R6_DEFENSE') ||
    r6PriorityTokens.includes('HARD_BLOCK') ||
    r6PriorityTokens.includes('BEAR_DEFENSE')
  ) {
    return 'R6_DEFENSE';
  }

  if (
    effectiveRegime.includes('R6_RECOVERY_WATCH') ||
    effectiveRegime.includes('R5_STABILIZING') ||
    recoveryStatus.includes('RECOVERY_WATCH')
  ) {
    return 'R5_RECOVERY_WATCH';
  }

  if (rawRegime.includes('R1_TURBO')) return 'R1_AGGRESSIVE';
  if (rawRegime.includes('R2_BULL')) return 'R2_RISK_ON';
  if (rawRegime.includes('R3_EARLY')) return 'R3_NEUTRAL';
  if (rawRegime.includes('R4_NEUTRAL')) return 'R4_CAUTION';
  if (rawRegime.includes('R5_CAUTION')) return 'R5_RECOVERY_WATCH';
  return 'R3_NEUTRAL';
}

export function calculateShadowRegimeSizing(
  input: CalculateShadowRegimeSizingInput,
): ShadowRegimeSizingResult {
  const policy = SHADOW_REGIME_SIZING_POLICIES[input.regimeLevel];
  const totalShadowEquity = sanitizeMoney(input.totalShadowEquity);
  const currentShadowExposure = sanitizeMoney(input.currentShadowExposure);
  const availableVirtualCash = sanitizeMoney(input.availableVirtualCash);
  const liveSizingEngineBudget = sanitizeMoney(input.liveSizingEngineBudget);
  const perPositionBudgetCap = totalShadowEquity * policy.maxPositionPct;
  const remainingRegimeExposureBudget = Math.max(
    0,
    totalShadowEquity * policy.totalExposureCap - currentShadowExposure,
  );

  const common = {
    sizingSource: 'SHADOW_REGIME_SIZING_POLICIES' as const,
    liveOrderSent: false as const,
    executionImpact: 'NONE' as const,
    policy,
    liveSizingEngineBudget,
    perPositionBudgetCap,
    remainingRegimeExposureBudget,
    availableVirtualCash,
  };

  if (input.openShadowSymbolCount >= policy.maxSymbols) {
    return {
      ...common,
      allowed: false,
      blockReason: 'REGIME_SHADOW_SLOT_BLOCKED',
      finalShadowBudget: 0,
      cappedBy: ['TOTAL_EXPOSURE_CAP'],
    };
  }

  if (liveSizingEngineBudget <= 0) {
    return {
      ...common,
      allowed: false,
      blockReason: 'LIVE_SIZING_ENGINE_BLOCKED',
      finalShadowBudget: 0,
      cappedBy: ['LIVE_SIZING_ENGINE'],
    };
  }

  const rawCaps = [
    ['LIVE_SIZING_ENGINE', liveSizingEngineBudget],
    ['MAX_POSITION_PCT', perPositionBudgetCap],
    ['TOTAL_EXPOSURE_CAP', remainingRegimeExposureBudget],
    ['VIRTUAL_CASH', availableVirtualCash],
  ] as const;
  const finalShadowBudget = Math.max(0, Math.min(...rawCaps.map(([, value]) => value)));
  const cappedBy = rawCaps
    .filter(([, value]) => nearlyEqual(value, finalShadowBudget))
    .map(([name]) => name);

  if (finalShadowBudget <= 0) {
    return {
      ...common,
      allowed: false,
      blockReason: remainingRegimeExposureBudget <= 0 ? 'REGIME_EXPOSURE_CAP_REACHED' : 'VIRTUAL_CASH_EXHAUSTED',
      finalShadowBudget: 0,
      cappedBy: cappedBy.length > 0 ? cappedBy : ['TOTAL_EXPOSURE_CAP'],
    };
  }

  return {
    ...common,
    allowed: true,
    finalShadowBudget,
    cappedBy,
  };
}

function sanitizeMoney(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}
