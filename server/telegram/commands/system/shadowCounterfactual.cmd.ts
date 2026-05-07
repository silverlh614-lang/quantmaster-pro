// @responsibility shadowCounterfactual.cmd — ADR-0431 Counterfactual Shadow Performance Report 텔레그램 명령.
// @responsibility: /shadow_counterfactual — counterfactual ledger entries 의 6-horizon 성과 리포트.
//
// ADR-0431:
// Counterfactual shadow performance reporting evaluates learning-only samples
// created under SELL_ONLY / HARD_BLOCK by ADR-0430. Read-only learning report.
// counterfactual-shadow-learning-ledger.json 만 read 하고 일반 shadow-trades.json /
// provisional-shadow-ledger.json 무수정. 외부 API 호출은 ADR-0429 cache-first
// priceProvider 를 thin adapter 로 wrap (default cache-only, maxExternal=0).
//
// 안전 가드:
//   - 5분 rate-limit (운영자 손가락 실수 차단, 텔레그램 메시지 길이 제한 보호)
//   - SYS riskLevel=0 (read-only)
//   - ADMIN visibility
//   - LIVE 매매 영향 0 — KIS 주문 함수 import 0건
//   - aliases: /counterfactual_shadow / /shadow_learning / /learning_shadow

import { loadCounterfactualShadowLearningLedger } from '../../../persistence/counterfactualShadowLearningRepo.js';
import {
  buildCounterfactualShadowPerformanceReport,
  formatCounterfactualShadowPerformanceMessage,
} from '../../../learning/counterfactualShadowLearningPerformanceReport.js';
// ADR-0429 cache-first read-only priceProvider — thin adapter 로 wrap (사용자 §C 권장).
// counterfactual ledger 와 provisional ledger 절대 혼합 금지 — 본 명령은 counterfactual
// entries 만 ledger-aware index 로 priceProvider 에 전달하지 않고, ADR-0429 generic
// horizon-based interface 를 그대로 사용. cached price lookup 은 후속 PR scope —
// 현재 default cache-only 라 모든 horizon DATA_UNAVAILABLE 또는 PENDING.
import { createProvisionalShadowPriceProvider } from '../../../learning/provisionalShadowPriceProvider.js';
import { wrapProvisionalProviderForCounterfactual } from '../../../learning/counterfactualShadowPriceProviderAdapter.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

// 5분 rate-limit (텔레그램 메시지 길이 제한 + 운영자 실수 차단)
let _lastReportAt = 0;
const REPORT_RATE_LIMIT_MS = 5 * 60_000;

export function __resetShadowCounterfactualRateLimitForTests(): void {
  _lastReportAt = 0;
}

const shadowCounterfactual: TelegramCommand = {
  name: '/shadow_counterfactual',
  aliases: ['/counterfactual_shadow', '/shadow_learning', '/learning_shadow'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    'Counterfactual Shadow Performance Report (ADR-0431) — SELL_ONLY/HARD_BLOCK 차단 후 학습 표본의 6-horizon 성과. read-only.',
  usage: '/shadow_counterfactual',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastReportAt < REPORT_RATE_LIMIT_MS) {
      const wait = Math.ceil((REPORT_RATE_LIMIT_MS - (now - _lastReportAt)) / 1000);
      await reply(`⏱️ 5분 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    _lastReportAt = now;

    try {
      // counterfactual ledger 만 read — 일반 shadow / provisional 무수정 (사용자 §J 정합).
      const entries = loadCounterfactualShadowLearningLedger();

      // ADR-0429 priceProvider 를 ADR-0431 시그니처로 wrap.
      // provisional priceProvider 는 entries 인덱싱 인자를 받지만, counterfactual ledger
      // entry 형식과 다르므로 *빈 인덱스* 로 생성 — cache miss → DATA_UNAVAILABLE
      // (default cache-only). 실제 cached price wiring 은 후속 PR scope.
      const provisionalProvider = createProvisionalShadowPriceProvider({ entries: [] });
      const priceProvider = wrapProvisionalProviderForCounterfactual(provisionalProvider);

      const summary = await buildCounterfactualShadowPerformanceReport({
        entries,
        nowKst: new Date().toISOString(),
        priceProvider,
      });
      const message = formatCounterfactualShadowPerformanceMessage(summary);
      await reply(message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ Counterfactual Shadow Report 생성 실패: ${msg}`);
    }
  },
};

commandRegistry.register(shadowCounterfactual);

export default shadowCounterfactual;
