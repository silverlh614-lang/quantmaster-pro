// @responsibility scanBlockers.cmd 텔레그램 모듈
/**
 * @responsibility /scan_blockers 명령 — 직전 스캔의 *매수 차단 사유 분포* 즉시 진단.
 *
 * ADR-0118: 사용자 보고 "FOMC 다음날인데 매수 0건" 직접 대응. 직전 스캔의
 * waitDistribution + macroGateState 를 텔레그램 메시지로 포맷.
 *
 * ADR-0118 §"진단 추정" 확장: TECHNICAL_PROVIDER_DEGRADED 종목 (ADR-0411
 * Yahoo↔KIS 괴리 KIS recovery 마커) 을 운영자에게 즉시 노출. WATCHLIST_HOLD
 * 정책 작동 중인 종목을 1 명령으로 인지 가능. ENV
 * `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true` 시 섹션 미노출.
 */
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatScanBlockersMessage,
  formatTechnicalProviderDegradedSection,
  getLastScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
// ADR-0431 — counterfactual ledger 누적 성과 한 줄 요약 (전체 리포트는 /shadow_counterfactual).
// read-only — counterfactual ledger 만 read, LIVE 매매 무영향.
import { loadCounterfactualShadowLearningLedger } from '../../../persistence/counterfactualShadowLearningRepo.js';
import {
  buildCounterfactualShadowPerformanceReport,
  formatCounterfactualShadowSummaryLine,
} from '../../../learning/counterfactualShadowLearningPerformanceReport.js';

const scanBlockers: TelegramCommand = {
  name: '/scan_blockers',
  aliases: ['/blockers', '/why_no_buy'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '직전 스캔의 매수 차단 사유 분포 + 거시 게이트 상태 (ADR-0118)',
  usage: '/scan_blockers',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const baseMessage = formatScanBlockersMessage(summary);

    // ADR-0118 §"진단 추정" 확장 — TECHNICAL_PROVIDER_DEGRADED 운영자 노출 (ADR-0411).
    // try/catch 격리 — watchlist 영속 throw 가 진단 메시지 자체 차단 안 함.
    let degradedSection: string | null = null;
    try {
      const watchlist = loadWatchlist();
      degradedSection = formatTechnicalProviderDegradedSection(watchlist);
    } catch (err) {
      console.warn(
        '[scan_blockers] technicalProviderDegraded 섹션 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0431 — counterfactual ledger 누적 성과 한 줄 요약.
    // read-only + 외부 API 호출 0 (priceProvider 미전달 → 모든 horizon PENDING).
    // try/catch 격리 — ledger throw 가 진단 메시지 자체 차단 안 함.
    let counterfactualLine: string | null = null;
    try {
      const cfEntries = loadCounterfactualShadowLearningLedger();
      if (cfEntries.length > 0) {
        const cfSummary = await buildCounterfactualShadowPerformanceReport({
          entries: cfEntries,
          nowKst: new Date().toISOString(),
          // priceProvider 미전달 → 모든 horizon PENDING (외부 호출 0)
        });
        counterfactualLine = formatCounterfactualShadowSummaryLine(cfSummary);
      }
    } catch (err) {
      console.warn(
        '[scan_blockers] counterfactual shadow 요약 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    const parts: string[] = [baseMessage];
    if (degradedSection) parts.push(degradedSection);
    if (counterfactualLine) parts.push(counterfactualLine);
    const finalMessage = parts.join('\n');
    await reply(finalMessage);
  },
};

commandRegistry.register(scanBlockers);

export default scanBlockers;
