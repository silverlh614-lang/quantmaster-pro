// @responsibility scanForce.cmd 텔레그램 모듈
// @responsibility: /scan_offhours — 장외에도 FORCE_MARKET env 우회로 runAutoSignalScan 강제 트리거. TRD ADMIN.
//
// 기존 /scan 은 EgressGuard(ADR-0028) + IntentTag(ADR-0058 main) 가 REALTIME 의도 fetch
// 를 차단하므로 장외에 호출하면 시세 0건으로 신호 0건. 본 명령은 forceMarketGuard 의
// env 임시 토글로 장외에도 신호 스캐너 전체 흐름을 강제 실행 — 분석·디버깅 용도.
//
// /force_watch_scan (ADR-0058 main) 와의 책임 분리:
//   - /force_watch_scan      = 워치리스트 *수집* 강제 (autoPopulateWatchlist + 옵션 universe)
//   - /scan_offhours (본 명령) = 신호 스캐너 *전체 흐름* 강제 (runAutoSignalScan)
//
// 안전 가드:
//   1. emergencyStop 차단
//   2. 장외 시 회로차단기·블랙리스트 부담 사전 경고
//   3. 실주문은 KIS 가 호가 차단으로 자연 거부 (LIVE 위험 0)
import { getEmergencyStop } from '../../../state.js';
import { runAutoSignalScan } from '../../../trading/signalScanner.js';
import { withForcedMarket } from '../../../utils/forceMarketGuard.js';
import { isMarketOpen } from '../../../utils/marketClock.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const scanForce: TelegramCommand = {
  name: '/scan_offhours',
  aliases: ['/scan_force'],
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '장외 시간에도 시장 게이트 우회 후 신호 스캐너 강제 실행 (분석/디버깅용)',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 강제 스캔 불가. /reset 으로 해제 후 재시도.');
      return;
    }

    const wasOpen = isMarketOpen();
    const tag = wasOpen ? '장중' : '장외';
    await reply(
      `🔍 ${tag} 강제 스캔 트리거 중...\n` +
      (!wasOpen
        ? '⚠️ 장외 시간 — Yahoo/KIS 호출이 발생할 수 있어 회로차단기·블랙리스트 부담 가능. ' +
          '실주문은 KIS 가 호가 차단으로 자연 거부됨.'
        : '정상 장중 — /scan 과 동일 동작.'),
    );

    try {
      await withForcedMarket(async () => {
        await runAutoSignalScan();
      });
      await reply(`✅ 강제 스캔 완료 (${tag})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[/scan_offhours] 실행 실패:', e);
      await reply(`❌ 강제 스캔 실패 — ${msg.slice(0, 200)}`);
    }
  },
};

commandRegistry.register(scanForce);

export default scanForce;
