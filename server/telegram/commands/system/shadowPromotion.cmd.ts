// @responsibility shadowPromotion.cmd — ADR-0432 Shadow Learning Promotion 텔레그램 명령.
// @responsibility: /shadow_promotion — provisional + counterfactual record 의 read-only 추천.
//
// ADR-0432:
// recommendation-only — 매매 액션 0. provisional / counterfactual ledger 만 read,
// 일반 shadow / virtual account / order path 무영향. priceProvider default cache-only
// (ADR-0429) — 외부 API 호출 0건.
//
// 안전 가드:
//   - 5분 rate-limit (운영자 손가락 실수 차단, 텔레그램 메시지 길이 제한 보호)
//   - SYS riskLevel=0 (read-only)
//   - ADMIN visibility
//   - LIVE 매매 영향 0 — KIS 주문 함수 import 0건
//   - aliases: /shadow_learning_promotion / /learning_promotion / /shadow_promote_candidates

import { loadProvisionalShadowLedger } from '../../../persistence/provisionalShadowLedger.js';
import { loadCounterfactualShadowLearningLedger } from '../../../persistence/counterfactualShadowLearningRepo.js';
import {
  buildProvisionalShadowPerformanceReport,
} from '../../../learning/provisionalShadowPerformanceReport.js';
import {
  buildCounterfactualShadowPerformanceReport,
} from '../../../learning/counterfactualShadowLearningPerformanceReport.js';
import {
  buildShadowLearningPromotionRecommendations,
  formatShadowLearningPromotionMessage,
} from '../../../learning/shadowLearningPromotionRecommendation.js';
// ADR-0429/0434 — cache-first read-only priceProvider (default cache-only, 외부 호출 0).
import { createProvisionalShadowPriceProvider } from '../../../learning/provisionalShadowPriceProvider.js';
import { createCounterfactualShadowPriceProvider } from '../../../learning/counterfactualShadowPriceProviderAdapter.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

let _lastReportAt = 0;
const REPORT_RATE_LIMIT_MS = 5 * 60_000;

export function __resetShadowPromotionRateLimitForTests(): void {
  _lastReportAt = 0;
}

const shadowPromotion: TelegramCommand = {
  name: '/shadow_promotion',
  aliases: ['/shadow_learning_promotion', '/learning_promotion', '/shadow_promote_candidates'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    'Shadow Learning Promotion Report (ADR-0432) — provisional + counterfactual learning samples 의 next-step recommendation. read-only.',
  usage: '/shadow_promotion',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastReportAt < REPORT_RATE_LIMIT_MS) {
      const wait = Math.ceil((REPORT_RATE_LIMIT_MS - (now - _lastReportAt)) / 1000);
      await reply(`⏱️ 5분 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    _lastReportAt = now;

    try {
      // 1. 두 ledger read-only — 절대 합치지 않는다 (사용자 §D 정합)
      const provisionalEntries = loadProvisionalShadowLedger();
      const counterfactualEntries = loadCounterfactualShadowLearningLedger();

      // 2. priceProvider — provisional + counterfactual 양쪽 cache-first read-only
      // (ADR-0429) — default maxExternalLookups=0 외부 호출 0건
      const provisionalProvider = createProvisionalShadowPriceProvider({
        entries: provisionalEntries,
      });

      // 3. 두 PerformanceReport build (read-time)
      const nowKst = new Date().toISOString();
      const counterfactualProvider = createCounterfactualShadowPriceProvider({
        entries: counterfactualEntries,
        nowKst,
      });
      const [provisionalSummary, counterfactualSummary] = await Promise.all([
        buildProvisionalShadowPerformanceReport({
          entries: provisionalEntries,
          nowKst,
          priceProvider: provisionalProvider,
        }),
        buildCounterfactualShadowPerformanceReport({
          entries: counterfactualEntries,
          nowKst,
          priceProvider: counterfactualProvider,
        }),
      ]);

      // 4. record 추출 — Top winners 와 Top losers 합집합 (중복 제거)
      // 사용자 §D — provisional / counterfactual 물리적 결합 금지, evaluation 단계에서만 함께 본다.
      const provisionalRecords = [
        ...provisionalSummary.topWinners,
        ...provisionalSummary.topLosers,
      ].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
      const counterfactualRecords = [
        ...counterfactualSummary.topWinners,
        ...counterfactualSummary.topLosers,
      ].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);

      // 5. promotion recommendation build
      const promotionSummary = buildShadowLearningPromotionRecommendations({
        provisionalRecords,
        counterfactualRecords,
        nowKst,
      });

      const message = formatShadowLearningPromotionMessage(promotionSummary);
      await reply(message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ Shadow Learning Promotion Report 생성 실패: ${msg}`);
    }
  },
};

commandRegistry.register(shadowPromotion);

export default shadowPromotion;
