// @responsibility F2W drift 텔레그램 알림 — 클라이언트 POST 진입점 + dispatchAlert + sendPrivateAlert (ADR-0046 PR-Y1)
/**
 * f2wDriftAlert.ts — F2W drift 감지 시 CH4 JOURNAL + 운영자 DM 동시 발송 (ADR-0046)
 *
 * 사용자 원안: "변화는 영양이지만 변화의 변화는 독."
 *
 * 동작:
 *   - 클라이언트 학습 회로(feedbackLoopEngine)가 drift 감지 시 POST /api/learning/f2w-drift-alert
 *   - 본 모듈이 페이로드 검증 → dispatchAlert(JOURNAL) + sendPrivateAlert 일괄
 *   - 24h dedupe (KST 일자) — 같은 날 다회 호출 시 첫 건만 채널 발송
 *   - 운영자 DM 은 dedupeKey 별도 (즉각 인지 우선) — 같은 KST 일자 내 1회로 제한
 *
 * 절대 규칙:
 *   - 잔고 키워드 누출 금지 (validate:sensitiveAlerts 자동 차단)
 *   - 종목 정보 미포함 (CH4 JOURNAL 메타 학습 정체성 보존)
 *   - dispatchAlert(ChannelSemantic.JOURNAL) + sendPrivateAlert 단일 진입점
 */

import { dispatchAlert, ChannelSemantic } from './alertRouter.js';
import { sendPrivateAlert } from './telegramClient.js';

export interface F2WDriftAlertPayload {
  sigma7d: number;
  sigma30dAvg: number;
  ratio: number;
  pausedUntil: string;
  reason: string;
  topConditions: Array<{ conditionId: number; weight: number; deviation: number }>;
}

export interface F2WDriftAlertResult {
  ok: boolean;
  dispatched: boolean;
  privateSent: boolean;
  error?: string;
}

/** KST 일자 (YYYY-MM-DD) 추출 */
function kstDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 페이로드 형태 검증 — 최소 필수 필드만 체크 */
function isValidPayload(raw: unknown): raw is F2WDriftAlertPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Partial<F2WDriftAlertPayload>;
  return (
    typeof p.sigma7d === 'number' &&
    typeof p.sigma30dAvg === 'number' &&
    typeof p.ratio === 'number' &&
    typeof p.pausedUntil === 'string' &&
    typeof p.reason === 'string' &&
    Array.isArray(p.topConditions)
  );
}

/** Top 조건 ID → 한국어 라벨 (간소화 — alertRouter 의존 차단) */
const CONDITION_NAME_HINTS: Record<number, string> = {
  1: '주도주 사이클',
  2: '모멘텀',
  3: 'Risk-On',
  4: 'ROE',
  5: 'PER',
  6: 'PBR',
  7: '시총',
  8: '외인비율',
  9: '거래량',
  10: 'OCF',
  11: '마진',
  12: '이자보상',
  13: '수급',
  14: '손절',
  15: 'MACD',
  16: '볼린저',
  17: '심리적객관성',
  18: '리더십',
  19: '정책',
  20: '엘리엇',
  21: '일목균형표',
  22: '촉매',
  23: '섹터',
  24: '모멘텀가속',
  25: 'VCP',
  26: 'RS',
  27: '신고가',
};

function formatConditionLabel(id: number): string {
  return CONDITION_NAME_HINTS[id] ?? `조건${id}`;
}

/**
 * drift 메시지 빌더 (텔레그램 HTML).
 *
 * 노출 정보:
 *   - σ7d / σ30d / ratio
 *   - 일시정지 만료 (KST)
 *   - 의심 조건 Top 3 (이름 + 가중치 + 편차)
 *
 * 절대 미노출: 잔고/자산/종목 정보.
 */
export function formatF2WDriftMessage(p: F2WDriftAlertPayload, now: Date = new Date()): string {
  const date = kstDate(now);
  let untilKst = p.pausedUntil;
  try {
    const d = new Date(p.pausedUntil);
    if (Number.isFinite(d.getTime())) {
      const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
      untilKst = kst.toISOString().slice(0, 16).replace('T', ' ') + ' KST';
    }
  } catch {
    // ignore — raw 문자열 그대로
  }

  const lines: string[] = [
    '🛡️ <b>[F2W Drift] 자기학습 가중치 동결</b>',
    `📅 ${date} KST`,
    '',
    `σ7d   = ${p.sigma7d.toFixed(4)}`,
    `σ30d  = ${p.sigma30dAvg.toFixed(4)}`,
    `ratio = ${p.ratio.toFixed(2)}× (임계 ≥ 2.0×)`,
    '',
    `⚠️ 사유: ${p.reason}`,
    `⏸️ 일시정지 만료: ${untilKst}`,
    '',
    '<b>의심 조건 Top 3 (가중치 / 편차):</b>',
  ];

  if (p.topConditions.length === 0) {
    lines.push('— 데이터 부재');
  } else {
    for (const t of p.topConditions.slice(0, 3)) {
      const name = formatConditionLabel(t.conditionId);
      lines.push(`  • ${name}: ${t.weight.toFixed(2)} (Δ ${t.deviation.toFixed(2)})`);
    }
  }

  lines.push('');
  lines.push('💡 변화는 영양이지만 변화의 변화는 독');
  lines.push('   shadow 학습은 계속 진행 중 (LIVE 가중치만 동결)');
  lines.push('   /clear_f2w_pause 로 수동 해제 가능 (운영자 판단)');

  return lines.join('\n');
}

/**
 * POST /api/learning/f2w-drift-alert 진입점.
 *
 * 페이로드 검증 → 메시지 빌드 → 채널(JOURNAL) + 개인 DM 일괄 발송.
 * 24h dedupe (KST 일자) — 같은 날 다회 호출은 첫 건만.
 */
export async function handleF2WDriftAlert(rawBody: unknown): Promise<F2WDriftAlertResult> {
  if (!isValidPayload(rawBody)) {
    return { ok: false, dispatched: false, privateSent: false, error: 'invalid_payload' };
  }

  const now = new Date();
  const date = kstDate(now);
  const message = formatF2WDriftMessage(rawBody, now);

  let dispatched = false;
  let privateSent = false;
  let error: string | undefined;

  // CH4 JOURNAL — 메타 학습 채널, 진동 OFF (VIBRATION_POLICY[SYSTEM])
  try {
    await dispatchAlert(ChannelSemantic.JOURNAL, message, {
      priority: 'HIGH',
      dedupeKey: `f2w_drift_detected:${date}`,
    });
    dispatched = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error('[F2WDriftAlert] dispatchAlert 실패:', error);
  }

  // 개인 DM — 즉각 인지 (priority HIGH)
  try {
    await sendPrivateAlert(message, {
      priority: 'HIGH',
      dedupeKey: `f2w_drift_private:${date}`,
      cooldownMs: 24 * 60 * 60 * 1000,
    });
    privateSent = true;
  } catch (e) {
    const dmErr = e instanceof Error ? e.message : String(e);
    error = error ? `${error} / ${dmErr}` : dmErr;
    console.error('[F2WDriftAlert] sendPrivateAlert 실패:', dmErr);
  }

  return { ok: dispatched || privateSent, dispatched, privateSent, error };
}
