// @responsibility health.cmd 텔레그램 모듈
// @responsibility: /health 명령 — 8축 헬스 스냅샷을 텔레그램 텍스트로 포맷 (수집은 server/health/diagnostics SSOT).
import {
  collectHealthSnapshot,
  runExternalProbes,
  type HealthSnapshot,
  type HealthProbeResult,
  type HealthProbeOutcome,
} from '../../../health/diagnostics.js';
import { computeMarketDataHealthScore, formatMarketDataHealthLine } from '../../../health/marketDataHealth.js';
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
  // ADR-0070: 시장 데이터 통합 품질 점수. staleFields 는 서버측에서 헤더 cache 미보유로 빈 배열 — 후속 PR 에서 보완.
  const mdhScore = computeMarketDataHealthScore(s, [], new Date());
  const mdhLine = formatMarketDataHealthLine(mdhScore);

  return (
    `🩺 <b>[파이프라인 헬스체크]</b> (uptime ${s.uptimeHours}h / mem ${s.memMB}MB / build ${s.commitSha})\n` +
    `판정: ${s.verdict}\n` +
    `─────────────────────\n` +
    `워치리스트: ${s.watchlistCount}개 | 활성 포지션: ${s.activePositions}개\n` +
    `자동매매: ${s.autoTradeEnabled ? '✅ 켜짐' : '❌ 꺼짐'} (${s.autoTradeMode})\n` +
    `KIS 토큰: ${s.kisTokenHours > 0 ? `✅ ${s.kisTokenHours}시간 남음` : '❌ 만료'}` +
    (s.realDataTokenHours > 0 ? ` | 실데이터: ✅ ${s.realDataTokenHours}h` : '') +
    `\n` +
    `KRX OpenAPI: ${formatKrxStatusLine(s)}\n` +
    `공매도 출처: ${formatShortSellingSourceLine(s)}\n` +
    `매크로 신선도: ${formatMacroFreshnessLine(s)}\n` +
    `시장 데이터 품질: ${mdhLine}\n` +
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

/**
 * KRX OpenAPI 회로 상태 라벨 SSOT — 5 분기.
 *
 * 우선순위:
 *   1. AUTH_KEY 미설정 → ⚠️ (회로 카운트 표시 무의미)
 *   2. 회로 OPEN       → ❌ (Tier-1 차단)
 *   3. 회로 HALF_OPEN  → 🟡 (재시도 중)
 *   4. 회로 CLOSED + krxTokenValid=true  → ✅ 정상
 *   5. 회로 CLOSED + krxTokenValid=false → 🟡 비활성 (DISABLED env 등)
 *
 * 외부 export — 단위 테스트 + 회귀 가드용.
 */
export function formatKrxStatusLine(s: HealthSnapshot): string {
  if (!s.krxTokenConfigured) {
    return '⚠️ 토큰 미설정 (KRX_OPEN_API_AUTH_KEY)';
  }
  const failures = s.krxFailures;
  const failSuffix = `(실패 ${failures}회)`;
  switch (s.krxCircuitState) {
    case 'OPEN':
      return `❌ 회로 OPEN ${failSuffix}`;
    case 'HALF_OPEN':
      return `🟡 회복 중 ${failSuffix}`;
    case 'CLOSED':
      return s.krxTokenValid
        ? `✅ 정상 ${failSuffix}`
        : `🟡 비활성 ${failSuffix}`;
    default:
      return `? ${s.krxCircuitState} ${failSuffix}`;
  }
}

/**
 * 공매도 비율 데이터 출처 라벨 SSOT — Phase 1 운영 가시화.
 *
 * 우선순위:
 *   1. shortSellingSource 미수집 (부팅 직후 또는 오래된 운영) → "? 미수집"
 *   2. KRX_DIRECT  → ✅ KRX 직접 (가장 신뢰도 높음)
 *   3. KRX_OTP     → 🟡 KRX OTP 폴백 (정상 fallback, 정확도 동일)
 *   4. KIS_ESTIMATE → ⚠️ KIS 추정값 (KRX 두 경로 모두 실패, 근사값)
 *   + fetchedAt 이 있으면 KST 시각 ("HH:MM") 부착
 */
export function formatShortSellingSourceLine(s: HealthSnapshot): string {
  if (!s.shortSellingSource) return '? 미수집';
  const time = formatShortSellingFetchedAt(s.shortSellingFetchedAt);
  const suffix = time ? ` (${time})` : '';
  switch (s.shortSellingSource) {
    case 'KRX_DIRECT':
      return `✅ KRX 직접${suffix}`;
    case 'KRX_OTP':
      return `🟡 KRX OTP 폴백${suffix}`;
    case 'KIS_ESTIMATE':
      return `⚠️ KIS 추정값${suffix}`;
    default: {
      const exhaustive: never = s.shortSellingSource;
      return `? ${exhaustive as string}${suffix}`;
    }
  }
}

/**
 * 매크로 신선도 라벨 SSOT — PR-2 사용자 보고 #5 (USD/KRW stale 감지) 표면화.
 *
 * 분기:
 *   1. macroStateUpdatedAt 미수집 → "? 미수집"
 *   2. age ≤ 8h → "✅ <usdKrw>원 (HH:MM, Nh)"
 *   3. 8h < age ≤ 24h → "🟡 <usdKrw>원 (HH:MM, Nh) — 갱신 지연"
 *   4. age > 24h → "❌ <usdKrw>원 (HH:MM, Nd) — STALE 24h+"
 *
 * USD/KRW 부재 시 "(N/A)" 표기. 실제 환율과 큰 격차 의심 시 운영자가 즉시 인지 가능.
 */
export function formatMacroFreshnessLine(s: HealthSnapshot): string {
  if (!s.macroStateUpdatedAt) return '? 미수집';
  const t = Date.parse(s.macroStateUpdatedAt);
  if (!Number.isFinite(t)) return '? 잘못된 시각';
  const ageMs = Date.now() - t;
  const ageHours = ageMs / 3600_000;
  const kstTime = new Date(t).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const usdKrwLabel = typeof s.macroStateUsdKrw === 'number' && s.macroStateUsdKrw > 0
    ? `${Math.round(s.macroStateUsdKrw).toLocaleString('ko-KR')}원`
    : 'N/A';
  const ageLabel = ageHours < 24
    ? `${ageHours.toFixed(1)}h`
    : `${(ageHours / 24).toFixed(1)}d`;
  if (ageHours <= 8) {
    return `✅ ${usdKrwLabel} (${kstTime}, ${ageLabel})`;
  }
  if (ageHours <= 24) {
    return `🟡 ${usdKrwLabel} (${kstTime}, ${ageLabel}) — 갱신 지연`;
  }
  return `❌ ${usdKrwLabel} (${kstTime}, ${ageLabel}) — STALE 24h+`;
}

function formatShortSellingFetchedAt(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false, // "23:30" — ko-KR 기본 hour12=true("PM 11:30") 회피
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
