// @responsibility refreshWatchlistSectors.cmd 텔레그램 모듈
// @responsibility: /refresh_watchlist_sectors — 운영자 트리거 워치리스트 sector 일괄 백필. SYS ADMIN.
//
// ADR-0060 PR-Z1 후속. 부팅 시 1회 자동 백필 외에 운영자가 임의 시각에 강제 트리거.
// 활용 예시:
//   - /refresh_sector_map 직후 신규 종목 sector 가 sectorMap 에 추가됐을 때
//   - 워치리스트에 신규 entry 가 다수 추가됐을 때
//   - sectorCycleDashboard 의 워치리스트 분포 블록이 0건일 때 진단·복구
//
// 안전 가드:
//   - 1분 rate-limit (모듈 로컬 _lastRefreshAt) — disk write 폭주 차단
//   - AUTO_TRADE_ENABLED 가드 *불필요* — sector 백필은 매매 무관 (write only sector field)
//   - emergencyStop 가드 *불필요* — 비상 시에도 sector 메타 갱신 안전

import { backfillWatchlistSectors } from '../../../persistence/watchlistSectorBackfill.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 1분 rate-limit — disk write 폭주 차단 (운영자 손가락 실수 + 재시도 안전망)
let _lastRefreshAt = 0;
const REFRESH_RATE_LIMIT_MS = 60_000;

/** 테스트 전용 — rate-limit state 초기화. */
export function __resetRefreshWatchlistSectorsRateLimitForTests(): void {
  _lastRefreshAt = 0;
}

const refreshWatchlistSectors: TelegramCommand = {
  name: '/refresh_watchlist_sectors',
  aliases: ['/backfill_watchlist_sectors'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '워치리스트 entries 의 빈 sector 필드 일괄 백필 (sectorMap SSOT 결과 적용)',
  usage: '/refresh_watchlist_sectors',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastRefreshAt < REFRESH_RATE_LIMIT_MS) {
      const wait = Math.ceil((REFRESH_RATE_LIMIT_MS - (now - _lastRefreshAt)) / 1000);
      await reply(`⏱️ 1분 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    _lastRefreshAt = now;

    const t0 = Date.now();
    try {
      const r = backfillWatchlistSectors();
      const elapsed = Date.now() - t0;

      if (r.scanned === 0) {
        await reply(
          `✅ 백필 대상 없음 — 총 ${r.total}개 워치리스트 entry 모두 sector 정합 (${(elapsed / 1000).toFixed(1)}s)`,
        );
        return;
      }

      const lines = [
        `🗂️ 워치리스트 sector 백필 완료 (${(elapsed / 1000).toFixed(1)}s)`,
        `  • 전체: ${r.total}개`,
        `  • 검사 대상 (빈 sector): ${r.scanned}개`,
        `  • ✅ 백필 성공: ${r.filled}개`,
      ];
      if (r.unmatched > 0) {
        lines.push(`  • ⚠️ 미매칭 (sectorMap 에 없음): ${r.unmatched}개`);
        lines.push('');
        lines.push('💡 미매칭 종목은 /refresh_sector_map 으로 sectorMap 갱신 후 재시도');
      }
      await reply(lines.join('\n'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ 워치리스트 sector 백필 실패: ${msg}`);
    }
  },
};

commandRegistry.register(refreshWatchlistSectors);

export default refreshWatchlistSectors;
