/**
 * @responsibility 수동 청산 7일 롤링 빈도를 3/5/7회 임계값으로 판정해 Telegram 행동 경보를 발송한다.
 *
 * manualOverrideMonitor.ts — P2 #17: 수동 오버라이드 3/5/7회 자동 경보.
 *
 * "사용자가 기계를 추월한 횟수" 가 일정 임계값(최근 7일 롤링)을 넘을 때 Telegram 경보.
 * 편향 루프를 끊기 위한 **행동 제어 레이어** — 단순 보고가 아니라 실시간 개입 경고.
 *
 * 임계값 (7일 롤링):
 *   - 3회 WATCH   → 📊 T2: "수동 개입이 쌓이고 있습니다"
 *   - 5회 CAUTION → ⚠️ T1: "패턴화된 수동 개입 — 의심 편향 리뷰 필요"
 *   - 7회 ALARM   → 🚨 T1: "자동 신호 불신 패턴 — 72h 매수 일시중지 검토"
 *
 * dedupe: 같은 티어는 KST 하루 1회만 발송. 상위 티어로 올라가면 새로 발송한다.
 * 호출: 매 /sell 직후 (webhookHandler) + 매일 장마감 hook (scheduler).
 */

import fs from 'fs';
import { MANUAL_OVERRIDE_ALERT_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadManualExitsWithinDays } from '../persistence/manualExitsRepo.js';
import { sendTelegramAlert } from './telegramClient.js';
import {
  computeManualFrequencyAxis,
  MANUAL_FREQ_WATCH,
  MANUAL_FREQ_CAUTION,
  MANUAL_FREQ_ALARM,
  type ManualFrequencyGrade,
} from '../learning/biasHeatmap.js';

export const MANUAL_OVERRIDE_THRESHOLDS = {
  WATCH:   MANUAL_FREQ_WATCH,
  CAUTION: MANUAL_FREQ_CAUTION,
  ALARM:   MANUAL_FREQ_ALARM,
} as const;

interface AlertState {
  /** YYYY-MM-DD (KST) → 당일 마지막으로 발송된 최고 등급 */
  lastGradePerDay: Record<string, ManualFrequencyGrade>;
}

function kstDateKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function loadState(): AlertState {
  ensureDataDir();
  if (!fs.existsSync(MANUAL_OVERRIDE_ALERT_FILE)) return { lastGradePerDay: {} };
  try {
    return JSON.parse(fs.readFileSync(MANUAL_OVERRIDE_ALERT_FILE, 'utf-8')) as AlertState;
  } catch {
    return { lastGradePerDay: {} };
  }
}

function saveState(state: AlertState): void {
  ensureDataDir();
  // 31일 초과 날짜는 트리밍 — 파일이 계속 자라지 않도록.
  const cutoffMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const trimmed: Record<string, ManualFrequencyGrade> = {};
  for (const [day, grade] of Object.entries(state.lastGradePerDay)) {
    const t = new Date(day + 'T00:00:00Z').getTime();
    if (t >= cutoffMs) trimmed[day] = grade;
  }
  fs.writeFileSync(
    MANUAL_OVERRIDE_ALERT_FILE,
    JSON.stringify({ lastGradePerDay: trimmed }, null, 2),
  );
}

/** grade 순위 — 발송 격상 여부 판정용. */
const GRADE_RANK: Record<ManualFrequencyGrade, number> = {
  CALM: 0, WATCH: 1, CAUTION: 2, ALARM: 3,
};

export interface EvaluateOptions {
  now?: Date;
  /** 테스트 주입용 — 텔레그램 발송 대체 */
  sendTelegram?: (msg: string, opts: Record<string, unknown>) => Promise<void>;
}

export interface EvaluateResult {
  grade: ManualFrequencyGrade;
  rolling7d: number;
  rolling30d: number;
  sent: boolean;
  /** 발송 스킵 사유 (이미 동일 등급 발송·CALM 등) */
  skipReason?: 'CALM' | 'SAME_OR_LOWER_TIER_ALREADY_SENT';
}

/**
 * 수동 오버라이드 빈도를 평가하고 필요 시 Telegram 경보 발송.
 * 한 번의 /sell 직후 호출해도, 장마감 hook 에서 호출해도 안전 (dedupe 자동).
 */
export async function evaluateAndAlertManualOverride(
  opts: EvaluateOptions = {},
): Promise<EvaluateResult> {
  const now = opts.now ?? new Date();
  const today = loadManualExitsWithinDays(1, now);
  const r7    = loadManualExitsWithinDays(7, now);
  const r30   = loadManualExitsWithinDays(30, now);
  const axis = computeManualFrequencyAxis(today, r7, r30);

  if (axis.grade === 'CALM') {
    return {
      grade: axis.grade,
      rolling7d: axis.rolling7d,
      rolling30d: axis.rolling30d,
      sent: false,
      skipReason: 'CALM',
    };
  }

  const dayKey = kstDateKey(now);
  const state = loadState();
  const prevGrade = state.lastGradePerDay[dayKey] ?? 'CALM';
  if (GRADE_RANK[axis.grade] <= GRADE_RANK[prevGrade]) {
    return {
      grade: axis.grade,
      rolling7d: axis.rolling7d,
      rolling30d: axis.rolling30d,
      sent: false,
      skipReason: 'SAME_OR_LOWER_TIER_ALREADY_SENT',
    };
  }

  const { header, tier, priority } = pickMessageStyle(axis.grade, axis.rolling7d);
  const msg = [
    header,
    `최근 7일 수동 청산: <b>${axis.rolling7d}회</b> (오늘 ${axis.todayCount}회)`,
    `최근 30일 누적: ${axis.rolling30d}회`,
    '',
    actionHint(axis.grade),
  ].join('\n');

  const send = opts.sendTelegram ?? ((m, o) => sendTelegramAlert(m, o).then(() => void 0));
  try {
    await send(msg, {
      tier,
      priority,
      category: 'manual_override_monitor',
      dedupeKey: `manual_override:${dayKey}:${axis.grade}`,
    });
  } catch (e) {
    console.error('[ManualOverrideMonitor] Telegram 발송 실패:', e instanceof Error ? e.message : e);
  }

  state.lastGradePerDay[dayKey] = axis.grade;
  saveState(state);

  return {
    grade: axis.grade,
    rolling7d: axis.rolling7d,
    rolling30d: axis.rolling30d,
    sent: true,
  };
}

function pickMessageStyle(
  grade: ManualFrequencyGrade,
  count: number,
): { header: string; tier: 'T1_ALARM' | 'T2_REPORT'; priority?: 'HIGH' } {
  if (grade === 'ALARM') {
    return {
      header: `🚨 <b>[수동 개입 경보] ${count}회/7일 — 자동 신호 불신 패턴</b>`,
      tier: 'T1_ALARM',
      priority: 'HIGH',
    };
  }
  if (grade === 'CAUTION') {
    return {
      header: `⚠️ <b>[수동 개입 주의] ${count}회/7일 — 편향 리뷰 필요</b>`,
      tier: 'T1_ALARM',
    };
  }
  return {
    header: `📊 <b>[수동 개입 관찰] ${count}회/7일 — 패턴 형성 초기</b>`,
    tier: 'T2_REPORT',
  };
}

function actionHint(grade: ManualFrequencyGrade): string {
  switch (grade) {
    case 'ALARM':
      return '🔒 신규 매수 경로 72h 일시중지 검토 · 반성 엔진 즉시 실행 권장.';
    case 'CAUTION':
      return '🧭 Bias Heatmap 확인 · /sell 직전 5분 대기 룰 자가 점검.';
    case 'WATCH':
    default:
      return '🧪 수동 개입 사유를 /sell 노트에 명시하는지 점검.';
  }
}

export const __test = { loadState, saveState, pickMessageStyle, GRADE_RANK };
