/**
 * overrideExecutor.ts — 운용자 오버라이드 액션 실행 (안전가드 + 라우팅)
 *
 * Telegram 인라인 버튼(Decision Broker)과 POST /api/operator/override가 모두 여기로 모인다.
 *
 * 처리 순서 (모든 단계를 차례로 통과해야 액션이 실행된다):
 *   1. 안전 가드 — emergencyStop / creditCrisis / dailyLossLimit 중 하나라도 활성이면 전면 차단
 *   2. 모드 가드 — LIVE 모드에서는 RELAX_THRESHOLD 전면 금지 (SHADOW/PAPER에서만 허용)
 *   3. 일일 한도 — overrideLedger.canApplyToday()
 *   4. 액션 실행 — expandOnEmpty() / setRuntimeThresholdDelta() / HOLD(noop)
 *   5. 감사 로그 — recordOverride()
 *
 * 반환값 OverrideResult.status:
 *   APPLIED  — 성공적으로 실행됨
 *   REJECTED — 가드 차단 (emergencyStop, LIVE+RELAX, 일일 한도 등)
 *   NOOP     — HOLD 액션(관망 유지) 또는 효과 없는 호출
 */

import { getEmergencyStop, getDailyLossPct, getTradingMode } from '../state.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { expandOnEmpty } from '../screener/dynamicUniverseExpander.js';
import {
  setRuntimeThresholdDelta,
  getRuntimeThresholdSnapshot,
} from '../trading/gateConfig.js';
import {
  canApplyToday,
  recordOverride,
  DEFAULT_TTL_MS,
  type OverrideAction,
  type OverrideEntry,
} from '../persistence/overrideLedger.js';

export interface OverrideRequest {
  action: OverrideAction;
  /** 트리거 맥락(예: "empty_scans=5", "manual_api") */
  context: string;
  /** 실행 주체 */
  source: string;
}

export interface OverrideResult {
  status: 'APPLIED' | 'REJECTED' | 'NOOP';
  action: OverrideAction;
  /** 사용자에게 보여줄 한국어 요약 */
  summary: string;
  /** 기계 판독용 상세 */
  detail?: Record<string, unknown>;
  ledgerEntry: OverrideEntry;
}

/** Gate Score 완화 폭 — 페르소나: "임계값 -0.5 완화" */
const RELAX_DELTA = -0.5;

/**
 * 안전 가드: 비상정지·일일손실·신용위기 중 하나라도 걸리면 오버라이드 전면 차단.
 * 손실 누적 중에 운용자가 손가락만 한 번 잘못 움직여도 복리가 무너진다.
 */
function checkSafetyGuards(): { ok: boolean; reason?: string } {
  if (getEmergencyStop()) {
    return { ok: false, reason: 'emergency_stop_active' };
  }
  const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
  if (getDailyLossPct() >= dailyLossLimit) {
    return { ok: false, reason: `daily_loss_limit_hit(${getDailyLossPct().toFixed(2)}%)` };
  }
  // creditCrisis: macroState.hySpread 또는 financialStress 기반 — 서버사이드는 간이 판정
  const macro = loadMacroState();
  if (macro) {
    const hySpread = macro.hySpread ?? 0;
    const stress = macro.financialStress ?? 0;
    if (hySpread >= 8 || stress >= 3) {
      return { ok: false, reason: `credit_crisis(hy=${hySpread}, stress=${stress})` };
    }
  }
  return { ok: true };
}

export async function executeOverride(req: OverrideRequest): Promise<OverrideResult> {
  const { action, context, source } = req;

  // ── HOLD: 관망 유지 — 아무 변경도 없으므로 일일 한도에서 제외 ──
  if (action === 'HOLD') {
    const entry = recordOverride({
      action, context, source,
      status: 'APPLIED',  // 감사 기록은 남기되, countAppliedToday는 HOLD 제외
      expiresAt: null,
      reason: 'hold_noop',
    });
    return {
      status: 'NOOP',
      action,
      summary: '⏸ 관망 유지 — 조치 없이 현 상태를 유지합니다.',
      ledgerEntry: entry,
    };
  }

  // ── 1. 안전 가드 ──────────────────────────────────────────────────────────
  const guard = checkSafetyGuards();
  if (!guard.ok) {
    const entry = recordOverride({
      action, context, source,
      status: 'REJECTED',
      reason: guard.reason,
      expiresAt: null,
    });
    return {
      status: 'REJECTED',
      action,
      summary: `🛑 안전 가드 차단: ${guard.reason}`,
      detail: { guard: guard.reason },
      ledgerEntry: entry,
    };
  }

  // ── 2. 모드 가드 — LIVE에서는 RELAX_THRESHOLD 금지 ────────────────────────
  if (action === 'RELAX_THRESHOLD') {
    const mode = getTradingMode();
    if (mode === 'LIVE') {
      const entry = recordOverride({
        action, context, source,
        status: 'REJECTED',
        reason: 'relax_forbidden_in_live_mode',
        expiresAt: null,
      });
      return {
        status: 'REJECTED',
        action,
        summary: '🛑 LIVE 모드에서는 임계값 완화를 허용하지 않습니다. (SHADOW/PAPER 전용)',
        detail: { mode },
        ledgerEntry: entry,
      };
    }
  }

  // ── 3. 일일 한도 ──────────────────────────────────────────────────────────
  const limitCheck = canApplyToday();
  if (!limitCheck.ok) {
    const entry = recordOverride({
      action, context, source,
      status: 'REJECTED',
      reason: `daily_limit_reached(${limitCheck.used}/${limitCheck.limit})`,
      expiresAt: null,
    });
    return {
      status: 'REJECTED',
      action,
      summary: `🛑 일일 오버라이드 한도(${limitCheck.limit}회) 초과 — 내일 자정(KST) 이후 재시도 가능.`,
      detail: { used: limitCheck.used, limit: limitCheck.limit },
      ledgerEntry: entry,
    };
  }

  // ── 4. 액션 실행 ──────────────────────────────────────────────────────────
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

  if (action === 'EXPAND_UNIVERSE') {
    const newCount = await expandOnEmpty().catch((e: unknown) => {
      console.error('[OverrideExecutor] expandOnEmpty 실패:', e);
      return -1;
    });
    if (newCount < 0) {
      const entry = recordOverride({
        action, context, source,
        status: 'REJECTED',
        reason: 'expand_failed',
        expiresAt: null,
      });
      return {
        status: 'REJECTED',
        action,
        summary: '🛑 유니버스 확장 실패 — KIS API 오류 (로그 확인 필요).',
        ledgerEntry: entry,
      };
    }
    const entry = recordOverride({
      action, context, source,
      status: 'APPLIED',
      expiresAt,
      reason: `added=${newCount}`,
    });
    return {
      status: 'APPLIED',
      action,
      summary: `✅ 유니버스 확장 완료 — 신규 ${newCount}개 편입 (TTL 30분 후 만료 플래그).`,
      detail: { newCount, expiresAt },
      ledgerEntry: entry,
    };
  }

  if (action === 'RELAX_THRESHOLD') {
    setRuntimeThresholdDelta(RELAX_DELTA, DEFAULT_TTL_MS, `operator_override:${source}`);
    const snap = getRuntimeThresholdSnapshot();
    const entry = recordOverride({
      action, context, source,
      status: 'APPLIED',
      expiresAt,
      reason: `delta=${RELAX_DELTA}`,
    });
    return {
      status: 'APPLIED',
      action,
      summary: `✅ Gate 임계값 ${RELAX_DELTA} 완화 적용 (30분 후 자동 복귀).`,
      detail: { delta: RELAX_DELTA, snapshot: snap },
      ledgerEntry: entry,
    };
  }

  // 도달 불가 — TypeScript exhaustiveness
  const _exhaustive: never = action;
  throw new Error(`Unknown override action: ${String(_exhaustive)}`);
}
