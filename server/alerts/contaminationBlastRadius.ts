/**
 * contaminationBlastRadius.ts — Phase 2차 C6: 오염 반경 계산기.
 *
 * 치명 버그 발생 시 자동 호출되어 "영향받은 샘플/포지션/캘리브레이션 주기" 를
 * 구체 수치로 산정한 뒤 Telegram 리포트로 발송. 운용자는 위 리포트만 보고 즉시
 * 복구 스코프 판단을 내릴 수 있다.
 *
 * 입력:
 *   - 사건 시각 (기본: 최신 incident.at)
 *
 * 출력:
 *   - 영향 기간 (사건 시각 ~ 현재)
 *   - 생성된 Shadow 수 (incident 시각 이후 signalTime)
 *   - 영향받은 Active 포지션
 *   - 캘리브레이션 영향 (이번 달 기간 중 비중)
 *   - 권고 액션
 */

import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { getLatestIncidentAt, listIncidents } from '../persistence/incidentLogRepo.js';
import { sendTelegramAlert } from './telegramClient.js';

export interface BlastRadiusSnapshot {
  incidentAt: string | null;
  nowIso:     string;
  durationMinutes: number;
  newShadowsSince: number;
  affectedActive: Array<{ stockCode: string; stockName: string }>;
  monthlyCoveragePct: number;   // 이번 달 전체 일수 중 오염 기간 비중 (%)
  recommendation: string;
  sourceSummary: string[];      // 최근 incident 요약 (reason 리스트)
}

function kstNow(): Date {
  return new Date();
}

function daysInMonth(d: Date): number {
  const kst = new Date(d.getTime() + 9 * 3_600_000);
  return new Date(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 0).getDate();
}

export function computeBlastRadius(fromIso?: string): BlastRadiusSnapshot {
  const now = kstNow();
  const incidentAt = fromIso ?? getLatestIncidentAt();
  if (!incidentAt) {
    return {
      incidentAt: null,
      nowIso: now.toISOString(),
      durationMinutes: 0,
      newShadowsSince: 0,
      affectedActive: [],
      monthlyCoveragePct: 0,
      recommendation: '기록된 incident 없음 — 정상 운용 상태.',
      sourceSummary: [],
    };
  }

  const shadows = loadShadowTrades();
  const newShadows = shadows.filter(s => s.signalTime >= incidentAt);
  const active = shadows
    .filter(s => isOpenShadowStatus(s.status))
    .filter(s => (s.incidentFlag ?? '') >= incidentAt || s.signalTime >= incidentAt)
    .map(s => ({ stockCode: s.stockCode, stockName: s.stockName }));

  const durationMs = now.getTime() - new Date(incidentAt).getTime();
  const durationMinutes = Math.max(0, Math.round(durationMs / 60_000));

  const daysInThisMonth = daysInMonth(now);
  const durationDays = durationMs / 86_400_000;
  const monthlyCoveragePct = Math.min(100, (durationDays / daysInThisMonth) * 100);

  let recommendation: string;
  if (newShadows.length === 0) {
    recommendation = '오염 기간 중 신규 Shadow 없음 — 격리 불필요, 수정 후 재개.';
  } else if (newShadows.length < 5) {
    recommendation = `당일 샘플 ${newShadows.length}건 격리 + 긴급 수정 배포.`;
  } else if (monthlyCoveragePct < 10) {
    recommendation = `샘플 ${newShadows.length}건 격리 + 이번 달 캘리브레이션 정상 진행.`;
  } else {
    recommendation = `이번 달 캘리브레이션 스킵 권고 — 오염 기간이 ${monthlyCoveragePct.toFixed(1)}% 차지.`;
  }

  const sourceSummary = listIncidents(10)
    .filter(e => e.at >= incidentAt)
    .map(e => `${e.severity}:${e.source} — ${e.reason}`);

  return {
    incidentAt,
    nowIso: now.toISOString(),
    durationMinutes,
    newShadowsSince: newShadows.length,
    affectedActive: active,
    monthlyCoveragePct,
    recommendation,
    sourceSummary,
  };
}

export function formatBlastRadius(r: BlastRadiusSnapshot): string {
  const hours = Math.floor(r.durationMinutes / 60);
  const mins = r.durationMinutes % 60;
  const activeLines = r.affectedActive.length > 0
    ? r.affectedActive.map(a => `  ${a.stockName}(${a.stockCode})`).join('\n')
    : '  (없음)';
  const sourceLines = r.sourceSummary.length > 0
    ? r.sourceSummary.map(s => `  • ${s}`).join('\n')
    : '  (추가 기록 없음)';

  return [
    `🚨 <b>[오염 반경 추정]</b>`,
    `사건 시각: ${r.incidentAt ?? '없음'}`,
    `영향 기간: ${hours}시간 ${mins}분`,
    `━━━━━━━━━━━━━━━━━━`,
    `생성된 Shadow: ${r.newShadowsSince}건`,
    `영향받은 Active:`,
    activeLines,
    `이번 달 오염 비중: ${r.monthlyCoveragePct.toFixed(1)}%`,
    `━━━━━━━━━━━━━━━━━━`,
    `<b>Incident 소스:</b>`,
    sourceLines,
    ``,
    `<b>권고:</b> ${r.recommendation}`,
  ].join('\n');
}

/**
 * 가장 최근 incident 에 대해 blast radius 리포트를 Telegram 으로 발송.
 * incident 가 없으면 noop.
 */
export async function sendBlastRadiusReport(fromIso?: string): Promise<boolean> {
  const snapshot = computeBlastRadius(fromIso);
  if (!snapshot.incidentAt) return false;
  await sendTelegramAlert(formatBlastRadius(snapshot), {
    priority: 'CRITICAL',
    dedupeKey: `blast-radius-${snapshot.incidentAt}`,
    cooldownMs: 30 * 60 * 1000, // 30분 쿨다운 (같은 incident 중복 방지)
  }).catch(console.error);
  return true;
}
