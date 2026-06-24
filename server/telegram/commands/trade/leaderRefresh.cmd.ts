// @responsibility leaderRefresh.cmd 텔레그램 모듈
// @responsibility: /leader_refresh — 주도주 유니버스 캐시(dynamic-universe.json) 수동 즉시 갱신. TRD.
import { getEmergencyStop } from '../../../state.js';
import {
  runLeaderUniverseDailyRefresh,
  isLeaderUniverseDailyRefreshEnabled,
  loadDynamicUniverse,
} from '../../../screener/dynamicUniverseExpander.js';
import { isLeaderUniverseInjectionEnabled } from '../../../screener/leaderUniverseInjectionAdr0617.js';
import { probeLeaderRanking, type LeaderRankingProbe } from '../../../clients/kisRankingClient.js';
import { isVtsOnly } from '../../../screener/shadowDataGate.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/**
 * bypassCache 강제 프로브 결과 → /scan_blockers 인접 진단 블록 + verdict.
 * "0건"의 *원인*(장외 / circuit OPEN / 키 미설정 / 빈 응답 / 정상)을 단일 섹션으로 가리킨다.
 * 관측 전용 표시 — 빈 응답을 약세 신호로 변환하지 않는다(불변식 #6).
 */
function formatRankingProbe(probe: LeaderRankingProbe, vtsOnly: boolean): string {
  const label: Record<string, string> = {
    'market-cap': '시총',
    'institutional-net-buy': '기관',
    'volume': '거래량',
  };
  const rowLines = probe.rows.map((r) => {
    const circuit = r.circuitOpenForMs > 0
      ? ` · ⛔circuit ${Math.ceil(r.circuitOpenForMs / 1000)}s`
      : '';
    // Patch-LEADER-PROBE-LASTERR-DIAG — 마지막 real-data 실패 status/errorKind 표시(관측 전용).
    const lastErr = r.lastHttpStatus !== undefined || r.lastErrorKind !== undefined
      ? ` · ❌last ${r.lastHttpStatus ?? '?'}/${escapeHtml(r.lastErrorKind ?? 'UNKNOWN')}`
      : '';
    return `· ${escapeHtml(label[r.type] ?? r.type)}(${escapeHtml(r.trId)}): ${r.count}${circuit}${lastErr}`;
  });

  const anyCircuitOpen = probe.rows.some((r) => r.circuitOpenForMs > 0);
  const allZero = probe.rows.every((r) => r.count === 0);
  const anyNonZero = probe.rows.some((r) => r.count > 0);

  // allZero 세분용 — 마지막 실패 분류의 우선순위 집계(권한>일시장애>파라미터).
  //   provider 장애는 providerIssue 이지 bearish/marketSignal 아니다(불변식 #6).
  const errorKinds = new Set(
    probe.rows.map((r) => r.lastErrorKind).filter((k): k is NonNullable<typeof k> => k !== undefined),
  );

  let verdict: string;
  if (!probe.marketOpen) {
    verdict = '판정→장외. KIS 랭킹 데이터는 장중(09:00~15:30)에만 생성됨(ADR-0009). 장중 재시도.';
  } else if (anyCircuitOpen) {
    verdict = '판정→circuit OPEN(반복 실패 차단). /circuits 확인 후 /reset_circuits 로 해제하고 재시도.';
  } else if (!probe.hasRealDataClient && !probe.kisIsReal && !probe.hasOverrides && vtsOnly) {
    verdict = '판정→real-data 키 미설정·VTS-only → getRanking 항상 빈 배열. KIS_REAL_DATA_APP_KEY/SECRET 설정 필요(ADR-0561, Yahoo 폴백 차단됨).';
  } else if (allZero && errorKinds.has('AUTH_OR_TOKEN')) {
    verdict = '판정→403/권한. KIS 콘솔에서 국내주식 순위분석 TR 사용신청·승인 필요(실전계좌·custtype 확인). [providerIssue·marketSignal=false]';
  } else if (allZero && errorKinds.has('TRANSIENT_SERVER_500')) {
    verdict = '판정→KIS 서버 일시장애(5xx). 콘솔 조치 불필요 — 시간 두고 재시도하면 복구. [providerIssue·marketSignal=false]';
  } else if (allZero && errorKinds.has('BAD_REQUEST_OR_SYMBOL')) {
    verdict = '판정→400/404 파라미터·엔드포인트 점검. [providerIssue·marketSignal=false]';
  } else if (allZero) {
    verdict = '판정→real-data 호출됐으나 3종 모두 빈 응답. KIS 콘솔에서 랭킹 TR 권한·계좌·엔드포인트 점검.';
  } else if (anyNonZero) {
    verdict = '판정→랭킹 정상 응답. leader 캐시 충전됨 — 0건이었다면 5분 캐시/타이밍. /scan_blockers funnel 이 HEALTHY 로 전환되는지 확인.';
  } else {
    verdict = '판정→데이터 축적 중.';
  }

  return [
    `🔬 <b>진단 (bypassCache 강제)</b>`,
    `시장: ${probe.marketOpen ? 'OPEN' : 'CLOSED'} · realData: ${probe.hasRealDataClient ? 'ON' : 'OFF'} · KIS_IS_REAL: ${probe.kisIsReal ? 'ON' : 'OFF'} · VTS-only: ${vtsOnly ? 'yes' : 'no'}`,
    ...rowLines,
    verdict,
  ].join('\n');
}

const leaderRefresh: TelegramCommand = {
  name: '/leader_refresh',
  aliases: ['/lr'],
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '주도주 유니버스 캐시 즉시 갱신 + 0건 원인 진단(bypassCache 프로브 — circuit/키/빈응답 판별)',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 캐시 갱신 불가. /reset 으로 해제 후 재시도.');
      return;
    }
    await reply(
      `🔄 <b>주도주 캐시 강제 갱신 트리거</b>\n` +
      `LEADER_SOURCES 3종 (시총·기관순매수·외인근사) KIS 랭킹 fetch 중... (장중에만 유효)`,
    );
    try {
      // 비게이트: flag OFF 여도 운영자 명시 행위이므로 실행. flag 는 read-only 안내용.
      const dailyRefreshEnabled = isLeaderUniverseDailyRefreshEnabled();
      const injectionEnabled = isLeaderUniverseInjectionEnabled();

      // runLeaderUniverseDailyRefresh 는 내부 try/catch 격리 → throw 없이 합산 정수 반환.
      const updated = await runLeaderUniverseDailyRefresh();
      const total = loadDynamicUniverse().length;

      const lines = [
        `✅ <b>주도주 캐시 갱신 완료</b>`,
        `갱신 ${escapeHtml(String(updated))}건 (신규+연장 합산)`,
        `전체 동적 유니버스: ${escapeHtml(String(total))}개`,
        `DAILY_REFRESH flag: ${dailyRefreshEnabled ? 'ON' : 'OFF'} · INJECTION flag: ${injectionEnabled ? 'ON' : 'OFF'}`,
      ];

      if (updated === 0) {
        lines.push(
          `⚠️ 장외이거나 변동 없음 — getRanking 은 장중에만 데이터(ADR-0009). ` +
          `KST 09:00~15:30 에 재시도.`,
        );
      }

      if (!injectionEnabled) {
        lines.push(
          `⚠️ 캐시는 갱신됐으나 후보 풀 반영은 LEADER_UNIVERSE_INJECTION_ENABLED 의존 (현재 OFF).`,
        );
      }

      // ADR-0638/0639 후속 — "0건"의 원인을 bypassCache 강제 프로브로 가시화.
      //   real-data 빈 응답·circuit OPEN·키 미설정을 단일 verdict 로 판별(관측 전용).
      try {
        const probe = await probeLeaderRanking();
        lines.push('', formatRankingProbe(probe, isVtsOnly()));
      } catch (probeErr) {
        lines.push('', `🔬 진단 프로브 실패 (격리): ${escapeHtml(probeErr instanceof Error ? probeErr.message : String(probeErr))}`);
      }

      await reply(lines.join('\n'));
    } catch (e) {
      await reply(
        `❌ <b>주도주 캐시 갱신 실패</b>\n` +
        `${escapeHtml(e instanceof Error ? e.message : String(e))}`,
      );
    }
  },
};

commandRegistry.register(leaderRefresh);

export default leaderRefresh;
