// @responsibility counterfacture_gate Phase J — gate×regime ROC 권고가 처음 actionable(≥30표본)로 넘어가면 1회 텔레그램 푸시(dedup 영속, read-only, executionImpact=NONE).
/**
 * gateThresholdReadinessAlert.ts (counterfacture_gate Phase J)
 *
 * 문제: "검증 기간(데이터 ≥30표본)이 됐는데 놓친다" — /gate_threshold_reco 는 PULL 이라
 * operator 가 직접 안 치면 모른다. 본 모듈은 매일 cron 으로 권고를 평가해, 어떤
 * gate×regime 이 `insufficient_sample` → actionable(hold/tighten/loosen) 로 *처음*
 * 넘어가는 순간 1회 텔레그램 푸시한다. 이미 알린 키는 영속 dedup 으로 재알림 안 함
 * (steady-state 무음, 전이 시에만 발화).
 *
 * 안전: read-only — 어떤 임계도 변경하지 않는다. 적용은 여전히 operator 승인 필요.
 */

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { readJson, writeJson } from './learningStorage.js';
import {
  buildGateThresholdRecommendationReport,
  type GateThresholdRecommendation,
  type GateThresholdRecommendationReport,
} from './gateThresholdRecommendation.js';

const STATE_FILE = 'gate-threshold-readiness-alert.json';

interface ReadinessAlertState {
  alertedKeys: string[];
}

export type ReadinessAlerter = (message: string) => Promise<unknown>;

export interface GateThresholdReadinessAlertResult {
  enabled: boolean;
  /** 현재 actionable(≥30 표본)인 gate×regime 키. */
  readyKeys: string[];
  /** 이번에 처음 알림 보낸 키. */
  newlyAlerted: string[];
  alreadyAlerted: number;
  sent: boolean;
  executionImpact: 'NONE';
}

/** ENV COUNTERFACTURE_GATE_READINESS_ALERT_DISABLED=true → 끔(default ON, 사용자 요청 기능). */
export function isGateThresholdReadinessAlertDisabled(): boolean {
  return process.env.COUNTERFACTURE_GATE_READINESS_ALERT_DISABLED === 'true';
}

/** decision 이 검증 가능(≥30 표본) 상태인가 — insufficient_sample/disabled 제외. */
function isActionable(rec: GateThresholdRecommendation): boolean {
  const decision = rec.shift.decision;
  return decision === 'hold' || decision === 'tighten' || decision === 'loosen';
}

function readinessKey(rec: GateThresholdRecommendation): string {
  return `${rec.gate}:${rec.regime}`;
}

function formatReadinessLine(rec: GateThresholdRecommendation): string {
  const s = rec.shift;
  const suggested = s.suggestedThreshold === null ? 'N/A' : s.suggestedThreshold.toFixed(1);
  const verb = s.decision === 'tighten'
    ? `TIGHTEN→${suggested}`
    : s.decision === 'loosen'
      ? `LOOSEN→${suggested}`
      : 'HOLD';
  return `• ${rec.gate}/${rec.regime} (n=${rec.sampleSize}, W${s.winSample}/L${s.lossSample}) → ${verb}`;
}

export function formatReadinessAlertMessage(recs: readonly GateThresholdRecommendation[]): string {
  return [
    '🎯 <b>counterfacture_gate 검증 준비됨</b>',
    '아래 gate×regime 가 ROC 표본 ≥30 도달 — operator 검토 시점입니다.',
    ...recs.map(formatReadinessLine),
    '',
    '상세: /gate_threshold_reco (liveThresholdAutoChanged=false, 적용은 operator 승인 필요)',
  ].join('\n');
}

/**
 * 권고를 평가해 *처음* actionable 로 넘어간 gate×regime 만 1회 알림.
 * dedup: alertedKeys 영속. 테스트는 report/alerter/state 주입(디스크·텔레그램 I/O 우회).
 */
export async function runGateThresholdReadinessAlert(input?: {
  report?: GateThresholdRecommendationReport;
  alerter?: ReadinessAlerter;
  state?: ReadinessAlertState;
  persist?: boolean;
}): Promise<GateThresholdReadinessAlertResult> {
  if (isGateThresholdReadinessAlertDisabled()) {
    return { enabled: false, readyKeys: [], newlyAlerted: [], alreadyAlerted: 0, sent: false, executionImpact: 'NONE' };
  }
  const persist = input?.persist ?? (input?.state === undefined);
  const report = input?.report ?? (await buildGateThresholdRecommendationReport());
  const state = input?.state ?? readJson<ReadinessAlertState>(STATE_FILE, { alertedKeys: [] });
  const alerted = new Set(state.alertedKeys);

  const ready = report.recommendations.filter(isActionable);
  const readyKeys = ready.map(readinessKey);
  const newlyReady = ready.filter((rec) => !alerted.has(readinessKey(rec)));

  let sent = false;
  if (newlyReady.length > 0) {
    const alerter = input?.alerter ?? ((message: string) => sendTelegramAlert(message, {
      priority: 'NORMAL',
      dedupeKey: 'counterfacture_gate_readiness',
      cooldownMs: 12 * 60 * 60_000,
      category: 'counterfacture_gate',
    }));
    await alerter(formatReadinessAlertMessage(newlyReady));
    sent = true;
    for (const rec of newlyReady) alerted.add(readinessKey(rec));
    if (persist) writeJson<ReadinessAlertState>(STATE_FILE, { alertedKeys: [...alerted] });
  }

  return {
    enabled: true,
    readyKeys,
    newlyAlerted: newlyReady.map(readinessKey),
    alreadyAlerted: readyKeys.length - newlyReady.length,
    sent,
    executionImpact: 'NONE',
  };
}
