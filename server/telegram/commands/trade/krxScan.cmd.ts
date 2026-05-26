// @responsibility krxScan.cmd 텔레그램 모듈
// @responsibility: /krx_scan — KRX 서킷·캐시 reset 후 Stage1+2+3 발굴 파이프라인 강제 재실행. TRD.
import { getEmergencyStop } from '../../../state.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { getKrxMasterMetadata } from '../../../persistence/krxStockMasterRepo.js';
import { resolveCanonicalRegimeLevel } from '../../../trading/regime/canonicalRegimeAccess.js';
import { resetKrxCache } from '../../../clients/krxClient.js';
import {
  _resetKrxOpenApiBreaker,
  getKrxOpenApiStatus,
  resetKrxOpenApiCache,
} from '../../../clients/krxOpenApi.js';
import { runGuardedFullDiscoveryPipeline } from '../../../screener/guardedDiscoveryPipeline.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const krxScan: TelegramCommand = {
  name: '/krx_scan',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: 'KRX 종목조회 강제 재스캔 (Stage1+2+3 — 회로/캐시 reset 후 재실행)',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 스캔 불가. /reset 으로 해제 후 재시도.');
      return;
    }
    const before = getKrxOpenApiStatus();
    _resetKrxOpenApiBreaker();
    resetKrxOpenApiCache();
    resetKrxCache();
    await reply(
      `🇰🇷 <b>KRX 강제 스캔 트리거</b>\n` +
      `서킷: ${before.circuitState} (실패 ${before.failures}회) → RESET\n` +
      `캐시: KRX client cache 초기화 완료 (정상 KRX_FULL_MASTER 파일은 검증 통과 전 보존)\n` +
      `Stage1(KRX_FULL_MASTER 로딩) → Stage2(tradable universe 필터링) → Stage3(scanner candidate 생성) 재실행 중...`,
    );
    try {
      const macroState = loadMacroState();
      const regime = resolveCanonicalRegimeLevel(macroState); // ADR-0531: Gate0 정본 레짐
      const result = await runGuardedFullDiscoveryPipeline(regime, macroState);
      if (!result.ok) {
        await reply(
          `🛑 <b>KRX 강제 스캔 중단</b>\n` +
          `${escapeHtml(result.reason ?? result.status)}\n` +
          `추천 0개가 아니라 데이터 품질 차단입니다.`,
        );
        return;
      }
      const after = getKrxOpenApiStatus();
      const wl = loadWatchlist();
      const meta = getKrxMasterMetadata();
      await reply(
        `✅ <b>KRX 강제 스캔 완료</b>\n` +
        `KRX Raw Master: ${meta.raw_krx_master_total}개\n` +
        `- KOSPI: ${meta.kospi_total}개\n` +
        `- KOSDAQ: ${meta.kosdaq_total}개\n` +
        `- KONEX: ${meta.konex_total_optional}개 (optional)\n` +
        `Tradable Universe: ${meta.tradable_universe_total}개\n` +
        `Scanner Candidates: ${meta.scanner_candidate_total}개\n` +
        `Watchlist: ${wl.length}개\n` +
        `Cache: ${meta.is_partial ? 'PARTIAL' : meta.stale ? 'STALE' : 'CACHE'}\n` +
        `서킷: ${after.circuitState} (실패 ${after.failures}회)`,
      );
    } catch (e) {
      await reply(
        `❌ <b>KRX 강제 스캔 실패</b>\n` +
        `${escapeHtml(e instanceof Error ? e.message : String(e))}`,
      );
    }
  },
};

commandRegistry.register(krxScan);

export default krxScan;
