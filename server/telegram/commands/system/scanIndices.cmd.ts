// @responsibility scanIndices.cmd 텔레그램 모듈
// @responsibility: /scan_indices — 운영자 트리거 글로벌 지수 스캔 강제 실행 (S&P500/나스닥/다우/VIX/EWY/ITA/SOXX/XLE/WOOD). MKT ADMIN.
//
// 06:00 KST cron(globalScanAgent)이 Yahoo 503/회로차단/블랙리스트 누적으로 N/A 만 반환하는
// 사례에 대비해 운영자가 임의 시각에 즉시 재실행 가능한 강제 트리거.
// runGlobalScanAgent 가 텔레그램 발송 본체 — handler 는 시작/완료 안내만 담당.
//
// 안전 가드:
//   - 60s rate-limit (모듈 로컬 _lastScanIndicesAt) — 9개 심볼 + Gemini 호출 비용 차단
//   - AUTO_TRADE_ENABLED 가드 *불필요* — 분석 데이터 수집은 매매 비활성 환경에서도 유효
//   - emergencyStop 가드 *불필요* — 비상 시에도 시장 상태 파악은 안전

import { runGlobalScanAgent } from '../../../alerts/globalScanAgent.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 60s rate-limit 가드 — Yahoo 회로 부담 + Gemini 호출 비용 차단 (ADR-0014 패턴)
let _lastScanIndicesAt = 0;
const SCAN_INDICES_RATE_LIMIT_MS = 60_000;

/** 테스트 전용 — rate-limit state 초기화. */
export function __resetScanIndicesRateLimitForTests(): void {
  _lastScanIndicesAt = 0;
}

const scanIndices: TelegramCommand = {
  name: '/scan_indices',
  aliases: ['/global_scan', '/index_scan'],
  category: 'MKT',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '글로벌 지수 스캔 강제 실행 (S&P500/나스닥/다우/VIX/EWY/ITA/SOXX/XLE/WOOD + Gemini 분석)',
  usage: '/scan_indices',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastScanIndicesAt < SCAN_INDICES_RATE_LIMIT_MS) {
      const wait = Math.ceil((SCAN_INDICES_RATE_LIMIT_MS - (now - _lastScanIndicesAt)) / 1000);
      await reply(`⏱️ 60초 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }

    _lastScanIndicesAt = now;

    const t0 = Date.now();
    await reply(
      '🌏 글로벌 지수 스캔 시작 — 9개 심볼 (S&P500/나스닥/다우/VIX/EWY/ITA/SOXX/XLE/WOOD) 수집 중...\n' +
        '결과는 별도 메시지로 전달됩니다.',
    );

    try {
      await runGlobalScanAgent();
      const elapsed = Date.now() - t0;
      await reply(`✅ 글로벌 지수 스캔 완료 (${(elapsed / 1000).toFixed(1)}s) — 위 메시지 확인.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ 글로벌 지수 스캔 실패: ${msg}`);
    }
  },
};

commandRegistry.register(scanIndices);

export default scanIndices;
