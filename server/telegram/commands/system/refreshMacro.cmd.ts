// @responsibility refreshMacro.cmd 텔레그램 모듈
// @responsibility: /refresh_macro — 시장 지표 강제 갱신 진입점. SYS ADMIN.
//
// 정기 cron: refreshMarketRegimeVars 평일 KST 08:40 + 15:30 (reportJobs.ts).
// 본 명령은 그 외 시점 운영자 강제 트리거 — Railway 배포 직후 macroState 갱신 / cron
// 일시 장애 / ADR-0423/0424 같은 신규 영속 schema 활성화 즉시 검증 시점에 사용.
//
// 영향 범위 (refreshMarketRegimeVars 본체):
//   - KOSPI / SPX / DXY / USD-KRW Yahoo Finance 갱신
//   - KIS 수급 (FSS) 갱신
//   - KRX 공매도 갱신
//   - ECOS 신용공여잔액 갱신 (ADR-0139)
//   - KIS 시장 종합 프로그램 매매 (ADR-0138)
//   - SectorEnergy 4-axis (ADR-0396) + ADR-0399 진단 + ADR-0423 quality + ADR-0424 backfill
//
// 안전 가드:
//   - 5분 rate-limit (외부 호출 폭주 차단 — KIS/KRX 회로 부담)
//   - ENV `REFRESH_MACRO_CMD_DISABLED=true` 우회 (default OFF, ADR-0157 정확 비교)
//   - try/catch 격리 — refreshMarketRegimeVars throw 가 텔레그램 응답 차단 안 함
//
// 본 명령은 ADR 미생성 — 기존 HTTP `GET /api/macro/refresh` (macroRouter.ts:73) 의 텔레그램 진입점.
// refreshMarketRegimeVars 본체 무수정.

import { refreshMarketRegimeVars } from '../../../trading/marketDataRefresh.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 5분 rate-limit — 외부 호출 폭주 차단 (KIS/KRX/Yahoo/ECOS 다중 호출)
let _lastRefreshAt = 0;
const REFRESH_RATE_LIMIT_MS = 5 * 60_000;

/** 테스트 전용 — rate-limit state 초기화. */
export function __resetRefreshMacroRateLimitForTests(): void {
  _lastRefreshAt = 0;
}

/** ENV `REFRESH_MACRO_CMD_DISABLED=true` 정확 비교 (ADR-0157 정합). */
export function isRefreshMacroDisabled(): boolean {
  return process.env.REFRESH_MACRO_CMD_DISABLED === 'true';
}

const refreshMacro: TelegramCommand = {
  name: '/refresh_macro',
  aliases: ['/macro_refresh', '/refresh_market'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '시장 지표 강제 갱신 (Yahoo + KIS + KRX + ECOS + SectorEnergy 4-axis + ADR-0423/0424)',
  usage: '/refresh_macro',
  async execute({ reply }) {
    if (isRefreshMacroDisabled()) {
      await reply('🔒 명령 비활성 — ENV `REFRESH_MACRO_CMD_DISABLED=true`');
      return;
    }

    const now = Date.now();
    if (now - _lastRefreshAt < REFRESH_RATE_LIMIT_MS) {
      const wait = Math.ceil((REFRESH_RATE_LIMIT_MS - (now - _lastRefreshAt)) / 1000);
      await reply(`⏱️ 5분 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }

    _lastRefreshAt = now;

    const t0 = Date.now();
    await reply(
      '🔄 시장 지표 강제 갱신 시작...\n' +
      '  • KOSPI / SPX / DXY / USD-KRW (Yahoo)\n' +
      '  • KIS 수급 + 프로그램 매매\n' +
      '  • KRX 공매도\n' +
      '  • ECOS 신용공여잔액\n' +
      '  • SectorEnergy 4-axis + ADR-0423/0424 진단\n' +
      '\n예상 소요: 10~30초',
    );

    try {
      await refreshMarketRegimeVars();
      const elapsed = Date.now() - t0;
      await reply(
        `✅ 시장 지표 갱신 완료 — ${(elapsed / 1000).toFixed(1)}초 소요\n\n` +
        `💡 후속 검증:\n` +
        `  • <code>/sector_energy_diag</code> — ADR-0423 quality + ADR-0424 repairStatus 표시 확인\n` +
        `  • <code>/regime</code> — MHS / regime / 4-axis 갱신 확인\n` +
        `  • <code>/scan_blockers</code> — sectorEnergy 블록 표시 확인\n\n` +
        `다음 정기 cron: 평일 KST 08:40 + 15:30`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ 시장 지표 갱신 실패: ${msg}\n서버 로그 확인 필요.`);
    }
  },
};

commandRegistry.register(refreshMacro);

export default refreshMacro;
