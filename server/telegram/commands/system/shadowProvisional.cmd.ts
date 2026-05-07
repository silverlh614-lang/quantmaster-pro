// @responsibility shadowProvisional.cmd — ADR-0428 Provisional Shadow Performance Report 텔레그램 명령.
// @responsibility: /shadow_provisional — provisional ledger entries 의 6-horizon 성과 리포트.
//
// ADR-0428:
// Read-only 학습/검증 리포트. provisional-shadow-ledger.json 만 읽고 일반
// shadow-trades.json 무수정. 외부 API 호출 0 (priceProvider default 미전달 시 PENDING).
//
// 안전 가드:
//   - 5분 rate-limit (운영자 손가락 실수 차단)
//   - SYS riskLevel=0 (read-only)
//   - ADMIN visibility
//   - LIVE 매매 영향 0 — KIS 주문 함수 import 0건

import { loadProvisionalShadowLedger } from '../../../persistence/provisionalShadowLedger.js';
import {
  buildProvisionalShadowPerformanceReport,
  formatProvisionalShadowPerformanceMessage,
} from '../../../learning/provisionalShadowPerformanceReport.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 5분 rate-limit (텔레그램 메시지 길이 제한 + 운영자 실수 차단)
let _lastReportAt = 0;
const REPORT_RATE_LIMIT_MS = 5 * 60_000;

export function __resetShadowProvisionalRateLimitForTests(): void {
  _lastReportAt = 0;
}

const shadowProvisional: TelegramCommand = {
  name: '/shadow_provisional',
  aliases: ['/shadow_provisional_report', '/provisional_shadow'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    'Provisional Shadow Performance Report (ADR-0428) — 6-horizon 성과 리포트. read-only 학습/검증.',
  usage: '/shadow_provisional',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastReportAt < REPORT_RATE_LIMIT_MS) {
      const wait = Math.ceil((REPORT_RATE_LIMIT_MS - (now - _lastReportAt)) / 1000);
      await reply(`⏱️ 5분 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    _lastReportAt = now;

    try {
      // priceProvider 미전달 — default PENDING 모드 (외부 API 폭주 차단, 사용자 §D).
      // 실제 priceProvider wiring 은 후속 PR (회귀 위험 격리).
      const entries = loadProvisionalShadowLedger();
      const summary = await buildProvisionalShadowPerformanceReport({
        entries,
        nowKst: new Date().toISOString(),
      });
      const message = formatProvisionalShadowPerformanceMessage(summary);
      await reply(message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ Provisional Shadow Report 생성 실패: ${msg}`);
    }
  },
};

commandRegistry.register(shadowProvisional);

export default shadowProvisional;
