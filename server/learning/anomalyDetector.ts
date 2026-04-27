// @responsibility anomalyDetector 학습 엔진 모듈
/**
 * anomalyDetector.ts — 아이디어 6: 이상 감지 (Anomaly Detection)
 *
 * 매일 장 마감 후(evaluateRecommendations 직후) 실행.
 * 최근 7일 성과가 30일 기준선에서 급격히 이탈할 때 Telegram으로 경보.
 *
 * 감지 유형:
 *   CRASH  — 최근 7일 승률이 30일 평균보다 25%p 이상 급락
 *            → 시장 구조 변화 또는 과최적화 신호
 *   SURGE  — 최근 7일 승률이 30일 평균보다 30%p 이상 급등
 *            → 일시적 행운 / 포지션 사이즈 과열 위험
 *   STREAK — 최근 N건 연속 LOSS (기본 4건)
 *            → 즉각적 시스템 중단 수준의 경보
 *
 * 알림 중복 억제:
 *   같은 유형의 경보가 24시간 내 재발하면 skip.
 *   anomaly-state.json에 마지막 경보 유형·시각 저장.
 */

import fs from 'fs';
import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { ANOMALY_STATE_FILE, ensureDataDir } from '../persistence/paths.js';

// ── 임계값 상수 ───────────────────────────────────────────────────────────────

const CRASH_THRESHOLD   = 0.25; // 7일 WR이 30일 WR보다 25%p 이상 하락
const SURGE_THRESHOLD   = 0.30; // 7일 WR이 30일 WR보다 30%p 이상 상승
const STREAK_THRESHOLD  = 4;    // N건 연속 LOSS → STREAK 경보
const RECENT_DAYS_SHORT = 7;    // 단기 기준선 (일)
const RECENT_DAYS_LONG  = 30;   // 장기 기준선 (일)
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 동일 유형 경보 억제: 24시간
const MIN_SAMPLE_SHORT  = 3;    // 단기 최소 샘플
const MIN_SAMPLE_LONG   = 5;    // 장기 최소 샘플

// ── 타입 ──────────────────────────────────────────────────────────────────────

type AnomalyType = 'CRASH' | 'SURGE' | 'STREAK';

interface AnomalyState {
  /** 마지막으로 발송된 경보 유형별 타임스탬프 (ISO) */
  lastAlertAt: Partial<Record<AnomalyType, string>>;
}

// ── 상태 I/O ──────────────────────────────────────────────────────────────────

function loadAnomalyState(): AnomalyState {
  ensureDataDir();
  if (!fs.existsSync(ANOMALY_STATE_FILE)) return { lastAlertAt: {} };
  try {
    return JSON.parse(fs.readFileSync(ANOMALY_STATE_FILE, 'utf-8')) as AnomalyState;
  } catch {
    return { lastAlertAt: {} };
  }
}

function saveAnomalyState(state: AnomalyState): void {
  ensureDataDir();
  fs.writeFileSync(ANOMALY_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

function isWithinDays(signalTime: string, days: number): boolean {
  return Date.now() - new Date(signalTime).getTime() <= days * 86_400_000;
}

function calcWinRate(recs: RecommendationRecord[]): number {
  const resolved = recs.filter((r) => r.status !== 'PENDING');
  if (resolved.length === 0) return 0;
  return resolved.filter((r) => r.status === 'WIN').length / resolved.length;
}

/** 마지막 경보로부터 24시간이 지났는지 확인 */
function isCooledDown(state: AnomalyState, type: AnomalyType): boolean {
  const last = state.lastAlertAt[type];
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > ALERT_COOLDOWN_MS;
}

/** 최근 resolved 거래에서 연속 LOSS 건수 계산 */
function calcConsecutiveLoss(recs: RecommendationRecord[]): number {
  const resolved = [...recs]
    .filter((r) => r.status !== 'PENDING')
    .sort((a, b) => new Date(b.resolvedAt ?? b.signalTime).getTime() -
                    new Date(a.resolvedAt ?? a.signalTime).getTime());

  let streak = 0;
  for (const r of resolved) {
    if (r.status === 'LOSS' || r.status === 'EXPIRED') streak++;
    else break;
  }
  return streak;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 성과 이상 감지를 실행한다.
 * evaluateRecommendations() 직후 매일 호출 권장.
 */
export async function detectPerformanceAnomaly(): Promise<void> {
  const allRecs = getRecommendations();
  const state   = loadAnomalyState();
  let   dirty   = false;

  const recent7d = allRecs.filter(
    (r) => isWithinDays(r.signalTime, RECENT_DAYS_SHORT) && r.status !== 'PENDING',
  );
  const hist30d = allRecs.filter(
    (r) => isWithinDays(r.signalTime, RECENT_DAYS_LONG) && r.status !== 'PENDING',
  );

  console.log(
    `[AnomalyDetector] 단기 ${RECENT_DAYS_SHORT}일: ${recent7d.length}건` +
    ` | 기준 ${RECENT_DAYS_LONG}일: ${hist30d.length}건`,
  );

  // ── 샘플 부족 → 스킵 ─────────────────────────────────────────────────────────
  if (recent7d.length < MIN_SAMPLE_SHORT || hist30d.length < MIN_SAMPLE_LONG) {
    console.log('[AnomalyDetector] 샘플 부족 — 이상 감지 건너뜀');
    return;
  }

  const recentWR = calcWinRate(recent7d);
  const histWR   = calcWinRate(hist30d);
  const delta    = histWR - recentWR; // 양수 = 하락, 음수 = 상승

  // ── 1. CRASH 감지: 단기 WR 급락 ──────────────────────────────────────────────
  if (delta > CRASH_THRESHOLD && isCooledDown(state, 'CRASH')) {
    await sendTelegramAlert(
      `🚨 <b>[이상 감지] 시스템 성과 급락</b>\n\n` +
      `기준 ${RECENT_DAYS_LONG}일 승률: <b>${(histWR * 100).toFixed(1)}%</b> (${hist30d.length}건)\n` +
      `최근 ${RECENT_DAYS_SHORT}일 승률: <b>${(recentWR * 100).toFixed(1)}%</b> (${recent7d.length}건)\n` +
      `급락 폭: <b>${(delta * 100).toFixed(1)}%p</b>\n\n` +
      `⚠️ 권고: 현재 레짐 재확인 및 가중치 점검\n` +
      `현재 포지션 사이즈 축소 고려`,
    ).catch(console.error);
    state.lastAlertAt['CRASH'] = new Date().toISOString();
    dirty = true;
    console.log(`[AnomalyDetector] 🚨 CRASH 경보 — delta ${(delta * 100).toFixed(1)}%p`);
  }

  // ── 2. SURGE 감지: 단기 WR 급등 (과도한 낙관) ────────────────────────────────
  const surgeDelta = recentWR - histWR; // 음수 delta → 단기가 더 높음
  if (surgeDelta > SURGE_THRESHOLD && isCooledDown(state, 'SURGE')) {
    await sendTelegramAlert(
      `📈 <b>[이상 감지] 최근 성과 급등 — 과열 주의</b>\n\n` +
      `기준 ${RECENT_DAYS_LONG}일 승률: <b>${(histWR * 100).toFixed(1)}%</b> (${hist30d.length}건)\n` +
      `최근 ${RECENT_DAYS_SHORT}일 승률: <b>${(recentWR * 100).toFixed(1)}%</b> (${recent7d.length}건)\n` +
      `급등 폭: <b>${(surgeDelta * 100).toFixed(1)}%p</b>\n\n` +
      `⚠️ 권고: 일시적 행운 가능성 — 포지션 사이즈 보수적 유지`,
    ).catch(console.error);
    state.lastAlertAt['SURGE'] = new Date().toISOString();
    dirty = true;
    console.log(`[AnomalyDetector] 📈 SURGE 경보 — surge ${(surgeDelta * 100).toFixed(1)}%p`);
  }

  // ── 3. STREAK 감지: 연속 LOSS ────────────────────────────────────────────────
  const streak = calcConsecutiveLoss(allRecs);
  if (streak >= STREAK_THRESHOLD && isCooledDown(state, 'STREAK')) {
    await sendTelegramAlert(
      `❌ <b>[이상 감지] 연속 손절 ${streak}건</b>\n\n` +
      `최근 결산 ${streak}건이 모두 LOSS/EXPIRED입니다.\n\n` +
      `⚠️ 권고: 신규 진입 일시 중단 검토\n` +
      `시장 구조 변화 또는 파라미터 이탈 가능성 점검`,
    ).catch(console.error);
    state.lastAlertAt['STREAK'] = new Date().toISOString();
    dirty = true;
    console.log(`[AnomalyDetector] ❌ STREAK 경보 — 연속 손절 ${streak}건`);
  }

  if (!dirty) {
    console.log(
      `[AnomalyDetector] 정상 — 7일WR ${(recentWR * 100).toFixed(1)}%` +
      ` vs 30일WR ${(histWR * 100).toFixed(1)}% | 연속손절 ${streak}건`,
    );
  } else {
    saveAnomalyState(state);
  }
}
