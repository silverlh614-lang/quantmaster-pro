// @responsibility: /health 명령 — 8축 헬스 스냅샷을 텔레그램 텍스트로 포맷 (수집은 server/health/diagnostics SSOT).
import {
  collectHealthSnapshot,
  runExternalProbes,
  type HealthSnapshot,
  type HealthProbeResult,
  type HealthProbeOutcome,
} from '../../../health/diagnostics.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const health: TelegramCommand = {
  name: '/health',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '파이프라인 헬스체크 (KIS/스캐너/토큰/Yahoo/DART/Gemini/Volume/Stream)',
  async execute({ reply }) {
    const snapshot = collectHealthSnapshot();
    const probes = await runExternalProbes();
    await reply(formatHealthMessage(snapshot, probes));
  },
};

commandRegistry.register(health);

export default health;

// ─── 텍스트 포맷팅 ────────────────────────────────────────────────────────

/**
 * 8축 헬스 스냅샷을 텔레그램 HTML 메시지로 변환.
 * 외부 export — `menuSync.test.ts` 와 `diagnostics.test.ts` 가 텍스트 회귀 가드용으로 호출.
 */
export function formatHealthMessage(s: HealthSnapshot, p: HealthProbeResult): string {
  const lastScanAt = formatKstHm(s.lastScanTs);
  const lastBuyAt = formatKstHm(s.lastBuyTs, '없음');
  const yahooLine = formatYahooStatusLine(s);
  const probeLabel = formatProbeOutcome;

  return (
    `🩺 <b>[파이프라인 헬스체크]</b> (uptime ${s.uptimeHours}h / mem ${s.memMB}MB / build ${s.commitSha})\n` +
    `판정: ${s.verdict}\n` +
    `─────────────────────\n` +
    `워치리스트: ${s.watchlistCount}개 | 활성 포지션: ${s.activePositions}개\n` +
    `자동매매: ${s.autoTradeEnabled ? '✅ 켜짐' : '❌ 꺼짐'} (${s.autoTradeMode})\n` +
    `KIS 토큰: ${s.kisTokenHours > 0 ? `✅ ${s.kisTokenHours}시간 남음` : '❌ 만료'}` +
    (s.realDataTokenHours > 0 ? ` | 실데이터: ✅ ${s.realDataTokenHours}h` : '') +
    `\n` +
    `Yahoo probe: ${probeLabel(p.yahoo)}\n` +
    `DART probe: ${probeLabel(p.dart)}\n` +
    `Gemini: ${s.geminiRuntime.status}${s.geminiRuntime.reason ? ` (${s.geminiRuntime.reason})` : ''}\n` +
    `Volume: ${s.volume.ok ? '✅ 마운트됨' : `❌ ${s.volume.error ?? '미마운트'}`}\n` +
    `Yahoo 집계: ${yahooLine}\n` +
    `마지막 스캔: ${lastScanAt} | 마지막 신호: ${lastBuyAt}\n` +
    `일일손실: ${s.dailyLossPct.toFixed(1)}% / 한도 ${s.dailyLossLimit}%\n` +
    `비상정지: ${s.emergencyStop ? '🛑 활성' : '✅ 해제'}\n` +
    `실시간호가: ${s.stream.connected ? `✅ ${s.stream.subscribedCount}종목` : '❌ 미연결'}\n` +
    `─────────────────────\n` +
    `<i>/refresh_token — KIS 토큰 강제 갱신</i>`
  );
}

/**
 * probe outcome → 텔레그램 라벨. severity 별 아이콘 분기:
 * - OK       → ✅
 * - WARN     → ⚠️
 * - CRITICAL → ❌
 *
 * 사용자 패치 권장안 — DART status=013 ("데이터 없음") 같이 의미상 정상인 응답이
 * 빨간 ❌ 로 잘못 표시되던 회귀 차단.
 */
export function formatProbeOutcome(probe: HealthProbeOutcome): string {
  const icon =
    probe.severity === 'OK' ? '✅' :
    probe.severity === 'WARN' ? '⚠️' :
    '❌';
  return `${icon} ${probe.message}`;
}

function formatKstHm(ts: number, fallback = '미실행'): string {
  if (ts <= 0) return fallback;
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatYahooStatusLine(s: HealthSnapshot): string {
  switch (s.yahoo.status) {
    case 'OK':
      return '✅';
    case 'DEGRADED':
      return '⚠️ 부분장애';
    case 'STALE': {
      const last = s.yahoo.heartbeat.lastSuccessAt;
      const lastHm = last > 0
        ? new Date(last).toLocaleTimeString('ko-KR', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'N/A';
      return `🟡 STALE (마지막 성공 ${lastHm})`;
    }
    case 'DOWN':
      return `❌ 불가 (연속 실패 ${s.yahoo.heartbeat.consecutiveFailures}회)`;
    case 'UNKNOWN':
    default:
      return '? 미수집';
  }
}
