/**
 * @responsibility Today's One Decision 6 case 우선순위 평가 + VOID 4 조건 SSOT (ADR-0046 PR-Z4)
 */
import type { SurvivalSnapshot } from '../api/survivalClient';
import type { DecisionInputs, DecisionInputsMacroSignals } from '../api/decisionClient';
import type { PositionItem } from '../services/autoTrading/autoTradingTypes';
import { evaluateInvalidationConditions } from './invalidationConditions';

export type DecisionTier = 'OK' | 'WARN' | 'CRITICAL' | 'EMERGENCY' | 'VOID';

export type DecisionCaseId =
  | 'EMERGENCY_STOP'
  | 'DAILY_LOSS_EMERGENCY'
  | 'INVALIDATED_POSITIONS'
  | 'ACCOUNT_CRITICAL'
  | 'PENDING_APPROVALS'
  | 'VOID'
  | 'MONITORING';

export type VoidCheckKey = 'HIGH_VOLATILITY' | 'ZERO_POSITIONS' | 'ZERO_APPROVALS' | 'MACRO_RISK';

export interface VoidCheck {
  key: VoidCheckKey;
  label: string;
  met: boolean;
  detail: string;
}

export interface DecisionRecommendation {
  caseId: DecisionCaseId;
  tier: DecisionTier;
  headline: string;
  detail: string;
  suggestedAction: string;
  triggerData?: Record<string, unknown>;
  voidChecks?: VoidCheck[];
}

export interface OneDecisionInputs {
  survival: SurvivalSnapshot | null;
  positions: PositionItem[];
  inputs: DecisionInputs | null;
}

// ─── VOID 모드 평가 ─────────────────────────────────────────────────────

const VKOSPI_Z_THRESHOLD = 1.5;
const VKOSPI_DAY_CHANGE_FALLBACK_PCT = 5;

function computeStdev(values: number[]): { mean: number; stdev: number } {
  if (values.length === 0) return { mean: 0, stdev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, stdev: Math.sqrt(variance) };
}

/**
 * 변동성 z-score — vix history 기반 우선, 없으면 vkospiDayChange fallback.
 * 둘 다 없으면 0 (VOID 활성 안 함, 보수적 기본값).
 */
export function computeVolatilityZScore(macro: DecisionInputsMacroSignals): { z: number; method: 'vix' | 'vkospi-change' | 'none' } {
  const history = macro.vixHistory;
  if (history && history.length >= 3) {
    const valid = history.filter((v) => Number.isFinite(v));
    if (valid.length >= 3) {
      const { mean, stdev } = computeStdev(valid);
      const current = macro.vix ?? valid[valid.length - 1];
      if (Number.isFinite(current) && stdev > 0) {
        return { z: (current - mean) / stdev, method: 'vix' };
      }
    }
  }
  const dayChange = macro.vkospiDayChange;
  if (Number.isFinite(dayChange)) {
    // 5%pt 절대 변화를 1.5σ 와 동등 취급 (heuristic)
    const z = (Math.abs(dayChange as number) / VKOSPI_DAY_CHANGE_FALLBACK_PCT) * VKOSPI_Z_THRESHOLD;
    return { z, method: 'vkospi-change' };
  }
  return { z: 0, method: 'none' };
}

export function evaluateVoidConditions(
  survival: SurvivalSnapshot | null,
  inputs: DecisionInputs | null,
): { met: boolean; checks: VoidCheck[] } {
  const macro = inputs?.macroSignals ?? {};
  const { z, method } = computeVolatilityZScore(macro);

  const highVolatility: VoidCheck = {
    key: 'HIGH_VOLATILITY',
    label: '높은 변동성',
    met: z >= VKOSPI_Z_THRESHOLD,
    detail: method === 'none'
      ? 'VIX/VKOSPI 데이터 부재'
      : `${method === 'vix' ? 'VIX z-score' : 'VKOSPI 일중 변화'} ${z.toFixed(2)}σ (임계 1.5σ)`,
  };

  const activePositions = survival?.sectorConcentration.activePositions ?? 0;
  const zeroPositions: VoidCheck = {
    key: 'ZERO_POSITIONS',
    label: '활성 포지션 0',
    met: activePositions === 0,
    detail: `활성 포지션 ${activePositions}개`,
  };

  const pendingCount = inputs?.pendingApprovals.length ?? 0;
  const zeroApprovals: VoidCheck = {
    key: 'ZERO_APPROVALS',
    label: '승인 대기 0',
    met: pendingCount === 0,
    detail: `승인 대기 ${pendingCount}건`,
  };

  const bearDefense = macro.bearDefenseMode === true;
  const fssHigh = macro.fssAlertLevel === 'HIGH_ALERT';
  const regimeRed = macro.regime === 'RED';
  const macroRisk: VoidCheck = {
    key: 'MACRO_RISK',
    label: '거시 리스크 활성',
    met: bearDefense || fssHigh || regimeRed,
    detail: [
      bearDefense ? 'bearDefenseMode' : null,
      fssHigh ? 'FSS HIGH_ALERT' : null,
      regimeRed ? 'regime RED' : null,
    ].filter(Boolean).join(', ') || '정상 거시 환경',
  };

  const checks = [highVolatility, zeroPositions, zeroApprovals, macroRisk];
  const met = checks.every((c) => c.met);
  return { met, checks };
}

// ─── 6 Case 우선순위 SSOT ───────────────────────────────────────────────

function pickInvalidatedPositions(positions: PositionItem[]): { criticals: PositionItem[]; topName: string | null } {
  const criticals = positions.filter((p) => evaluateInvalidationConditions(p).tier === 'CRITICAL');
  const top = criticals[0] ?? null;
  return { criticals, topName: top?.name ?? top?.symbol ?? null };
}

function isAccountCritical(survival: SurvivalSnapshot): boolean {
  return survival.dailyLoss.tier === 'CRITICAL'
    || survival.sectorConcentration.tier === 'CRITICAL'
    || survival.kellyConcordance.tier === 'CRITICAL';
}

/**
 * 6 case 우선순위 평가 — 위→아래 첫 매칭 단락. 순수 함수, 외부 의존성 0.
 * ADR-0046 §2.1 표 SSOT.
 */
export function resolveOneDecision(input: OneDecisionInputs): DecisionRecommendation {
  const { survival, positions, inputs } = input;

  // case 0 — EMERGENCY_STOP (가장 먼저)
  if (inputs?.emergencyStop === true) {
    return {
      caseId: 'EMERGENCY_STOP',
      tier: 'EMERGENCY',
      headline: '⚫ 비상정지 활성',
      detail: '운영자가 명시적으로 비상정지를 발동했습니다 — 모든 매매 차단됨',
      suggestedAction: '원인 점검 후 비상정지 해제 검토 (/integrity 명령 또는 UI)',
    };
  }

  // case 1 — DAILY_LOSS_EMERGENCY
  if (survival?.dailyLoss.tier === 'EMERGENCY') {
    return {
      caseId: 'DAILY_LOSS_EMERGENCY',
      tier: 'EMERGENCY',
      headline: '⚫ 일일 손실 한도 도달',
      detail: `현재 손실 ${survival.dailyLoss.currentPct.toFixed(2)}% / 한도 ${survival.dailyLoss.limitPct.toFixed(2)}%`,
      suggestedAction: '잔여 포지션 청산 또는 비상정지 발동 검토',
      triggerData: { dailyLoss: survival.dailyLoss },
    };
  }

  // case 2 — INVALIDATED_POSITIONS
  const { criticals, topName } = pickInvalidatedPositions(positions);
  if (criticals.length >= 1) {
    return {
      caseId: 'INVALIDATED_POSITIONS',
      tier: 'CRITICAL',
      headline: criticals.length === 1
        ? `🔴 ${topName} 재평가 권고`
        : `🔴 포지션 ${criticals.length}개 재평가 권고`,
      detail: criticals.length === 1
        ? '무효화 조건 2개 이상 충족 — 매도/유지 결정 필요'
        : `${topName} 외 ${criticals.length - 1}개 — 무효화 조건 2개 이상 충족`,
      suggestedAction: '해당 포지션 카드의 무효화 미터 확장하여 조건 검토',
      triggerData: { criticalCount: criticals.length, topPosition: topName },
    };
  }

  // case 3 — ACCOUNT_CRITICAL
  if (survival && isAccountCritical(survival)) {
    const reasons = [
      survival.dailyLoss.tier === 'CRITICAL' ? '일일 손실' : null,
      survival.sectorConcentration.tier === 'CRITICAL' ? '섹터 집중' : null,
      survival.kellyConcordance.tier === 'CRITICAL' ? 'Kelly 과대' : null,
    ].filter(Boolean).join(', ');
    return {
      caseId: 'ACCOUNT_CRITICAL',
      tier: 'CRITICAL',
      headline: '🔴 계좌 위험 영역',
      detail: `${reasons} CRITICAL — 신규 진입 차단 권고`,
      suggestedAction: '신규 매수 보류, 계좌 생존 게이지 상세 확인',
      triggerData: { reasons },
    };
  }

  // case 4 — PENDING_APPROVALS
  const pending = inputs?.pendingApprovals ?? [];
  if (pending.length > 0) {
    const top = pending[0];
    return {
      caseId: 'PENDING_APPROVALS',
      tier: 'WARN',
      headline: pending.length === 1
        ? `🟡 승인 대기: ${top.stockName}`
        : `🟡 승인 대기 ${pending.length}건 — 최우선: ${top.stockName}`,
      detail: `가장 오래된 항목 ${Math.round(top.ageMs / 1000)}초 경과`,
      suggestedAction: '텔레그램 또는 UI 에서 승인/거부 결정',
      triggerData: { pendingCount: pending.length, topStock: top.stockCode },
    };
  }

  // case 5 — VOID
  const voidEval = evaluateVoidConditions(survival, inputs);
  if (voidEval.met) {
    return {
      caseId: 'VOID',
      tier: 'VOID',
      headline: '🌑 오늘은 진입하지 않는 것이 알파입니다',
      detail: '높은 변동성 + 노출 없음 + 거시 리스크 동시 — 관망이 정답',
      suggestedAction: '신규 진입 보류, 미국 시장·뉴스 모니터링만 유지',
      voidChecks: voidEval.checks,
    };
  }

  // case 6 — MONITORING (default)
  return {
    caseId: 'MONITORING',
    tier: 'OK',
    headline: '🟢 현재 결정할 것 없음',
    detail: '모든 가드 정상 — 자동매매 평소 흐름 유지',
    suggestedAction: '평소대로 시스템 자동 진행',
    voidChecks: voidEval.checks,
  };
}
