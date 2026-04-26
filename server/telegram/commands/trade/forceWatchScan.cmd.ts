// @responsibility forceWatchScan.cmd 텔레그램 모듈
// @responsibility: /force_watch_scan — 운영자 트리거 워치리스트 강제 재스캔 (light/full 분기). TRD ADMIN.
//
// ADR-0056 §Migration & Compat — EgressGuard IntentTag 가 OVERNIGHT/HISTORICAL 의도
// 호출의 시간대 차단을 풀어줘도 *운영자 임의 시각 트리거* 는 여전히 부재. 본 명령이 그 갭을 메운다.
//
// 옵션 C 채택 (architect 결정, force-watch-scan-design.md):
//   인자 없음 → light (autoPopulateWatchlist 만, ~5s)
//   'full' 인자 → heavy (runFullDiscoveryPipeline + autoPopulateWatchlist, ~30s)
//
// 안전 가드 3중:
//   1. 60s rate-limit (모듈 로컬 _lastForceScanAt) — ADR-0014 reconcile 패턴 차용
//   2. AUTO_TRADE_ENABLED 검증 — disabled 환경에서 호출 의미 없음
//   3. emergencyStop 검증 — 비상정지 중 차단

import { getEmergencyStop } from '../../../state.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { getLiveRegime } from '../../../trading/regimeBridge.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 60s rate-limit 가드 — 명령 폭주 차단 (ADR-0014 패턴)
let _lastForceScanAt = 0;
const FORCE_SCAN_RATE_LIMIT_MS = 60_000;

/** 테스트 전용 — rate-limit state 초기화. */
export function __resetForceWatchScanRateLimitForTests(): void {
  _lastForceScanAt = 0;
}

const forceWatchScan: TelegramCommand = {
  name: '/force_watch_scan',
  aliases: ['/force_scan'],
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '워치리스트 강제 재스캔 (운영자 트리거 — light=populate / full=universe+populate)',
  usage: '/force_watch_scan [full]',
  async execute({ args, reply }) {
    const isFull = args[0]?.toLowerCase() === 'full';

    // 안전 가드 1: 60s rate-limit
    const now = Date.now();
    if (now - _lastForceScanAt < FORCE_SCAN_RATE_LIMIT_MS) {
      const wait = Math.ceil((FORCE_SCAN_RATE_LIMIT_MS - (now - _lastForceScanAt)) / 1000);
      await reply(`⏱️ 60초 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }

    // 안전 가드 2: AUTO_TRADE_ENABLED
    if (process.env.AUTO_TRADE_ENABLED !== 'true') {
      await reply('⚠️ AUTO_TRADE_ENABLED=false — SHADOW/LIVE 모드 모두에서 비활성');
      return;
    }

    // 안전 가드 3: emergencyStop
    if (getEmergencyStop()) {
      await reply('🛑 비상정지 활성 — /reset 으로 해제 후 재시도');
      return;
    }

    // 가드 통과 시점에 rate-limit 갱신 (실패 시도도 폭주 차단 대상)
    _lastForceScanAt = now;

    const t0 = Date.now();
    await reply(
      `🔍 워치리스트 강제 재스캔 시작 — 모드: ${isFull ? 'FULL (universe + populate)' : 'LIGHT (populate only)'}`,
    );

    try {
      let universeRan = false;
      if (isFull) {
        // dynamic import — 모듈 결합도 최소화 (텔레그램 명령 모듈이 거대 스크리너를 직접 import 안 함)
        const { runFullDiscoveryPipeline } = await import('../../../screener/universeScanner.js');
        const macroState = loadMacroState();
        const regime = getLiveRegime(macroState);
        await runFullDiscoveryPipeline(regime, macroState);
        universeRan = true;
      }

      const { autoPopulateWatchlist } = await import('../../../screener/stockScreener.js');
      const added = await autoPopulateWatchlist();

      const watchlist = loadWatchlist();
      const elapsed = Date.now() - t0;

      const lines = [
        `✅ 워치리스트 강제 재스캔 완료 (${(elapsed / 1000).toFixed(1)}s)`,
        universeRan ? `📡 universe 발굴: 완료` : null,
        `📋 워치리스트 추가: ${added}건`,
        `📊 현재 워치리스트: ${watchlist.length}종목`,
      ].filter(Boolean) as string[];
      await reply(lines.join('\n'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ 재스캔 실패: ${msg}`);
    }
  },
};

commandRegistry.register(forceWatchScan);

export default forceWatchScan;
