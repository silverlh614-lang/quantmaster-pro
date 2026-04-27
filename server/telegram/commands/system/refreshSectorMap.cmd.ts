// @responsibility refreshSectorMap.cmd 텔레그램 모듈
// @responsibility: /refresh_sector_map — 운영자 트리거 KRX 전종목 섹터맵 즉시 갱신. SYS ADMIN.
//
// data/krx-sector-map.json 부재 또는 stale (carry-over / 36h 초과) 상태일 때 운영자가
// 임의 시각에 갱신할 수 있는 강제 트리거. 정기 갱신 cron 은 매주 월 03:00 KST + 평일
// 04:00 재시도이며 본 명령은 그 외 시점 운영자 진입점.
//
// updateKrxSectorMap 본체는 4-tier fallback (KRX → Naver → Yahoo+Gemini → carry-over).
// 본 handler 는 시작/완료/source/count 안내만 담당.
//
// 안전 가드:
//   - 5분 rate-limit (모듈 로컬 _lastRefreshAt) — KRX 외부 호출 폭주 차단 (회로/블랙리스트 부담)
//   - AUTO_TRADE_ENABLED 가드 *불필요* — sector 갱신은 매매 비활성 환경에서도 유효
//   - emergencyStop 가드 *불필요* — 비상 시에도 sector 인프라 갱신은 안전

import { updateKrxSectorMap } from '../../../screener/sectorMapUpdater.js';
import { invalidateSectorMapCache } from '../../../screener/sectorMap.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 5분 rate-limit — KRX 본선 호출 빈도 제어 (운영자 손가락 실수 + 재시도 폭주 차단)
let _lastRefreshAt = 0;
const REFRESH_RATE_LIMIT_MS = 5 * 60_000;

/** 테스트 전용 — rate-limit state 초기화. */
export function __resetRefreshSectorMapRateLimitForTests(): void {
  _lastRefreshAt = 0;
}

const refreshSectorMap: TelegramCommand = {
  name: '/refresh_sector_map',
  aliases: ['/update_sector_map'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'KRX 전종목 섹터맵(data/krx-sector-map.json) 즉시 갱신 — 4-tier fallback (KRX→Naver→Yahoo+Gemini)',
  usage: '/refresh_sector_map',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastRefreshAt < REFRESH_RATE_LIMIT_MS) {
      const wait = Math.ceil((REFRESH_RATE_LIMIT_MS - (now - _lastRefreshAt)) / 1000);
      await reply(`⏱️ 5분 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }

    _lastRefreshAt = now;

    const t0 = Date.now();
    await reply('🗺️ KRX 섹터맵 갱신 시작 — 전종목 수집 중 (KRX 본선 우선, 실패 시 Naver/Yahoo+Gemini 폴백)...');

    try {
      const result = await updateKrxSectorMap();
      // sectorMap.ts 의 mtime 캐시 무효화 — 새 파일 즉시 반영 (다음 getSectorByCode 호출부터)
      invalidateSectorMapCache();
      const elapsed = Date.now() - t0;
      const sourceLine = result.source === 'KRX'
        ? `✅ KRX 본선 (${result.count}개 종목)`
        : `🟡 폴백 갱신 — Source: ${result.source} (${result.count}개)`;
      await reply(
        `${sourceLine}\n` +
        `trdDd: ${result.trdDd}\n` +
        `소요: ${(elapsed / 1000).toFixed(1)}s\n` +
        `다음 자동 갱신: 매주 월 03:00 KST + 평일 04:00 재시도`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ KRX 섹터맵 갱신 실패: ${msg}\n다음 자동 재시도까지 대기 권장.`);
    }
  },
};

commandRegistry.register(refreshSectorMap);

export default refreshSectorMap;
