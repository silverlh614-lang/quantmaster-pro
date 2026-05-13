// @responsibility learning repair Telegram commands — virtual-only repair controls
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { runGhostCloseResolver } from '../../../learning/ghostCloseResolver.js';
import { runAttributionBackfill } from '../../../learning/attributionBackfillEngine.js';
import { runSuggestThresholdCalibrator } from '../../../learning/suggestThresholdCalibrator.js';
import { scheduleGeminiLearningReflection } from '../../../learning/geminiUtilizationScheduler.js';
import { learningRepairDryRun, learningRepairRun, formatDryRunMessage, formatRunMessage } from '../../../learning/learningRepairCommand.js';
const cmds: TelegramCommand[] = [
  { name: '/learning_repair_dryrun', category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: '학습 루프 repair dry-run (데이터 변경 없음)', async execute({ reply }) { reply(formatDryRunMessage(await learningRepairDryRun())); } },
  { name: '/learning_repair_run', category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: '학습 루프 repair 실행 (실거래 영향 없음)', async execute({ reply }) { reply(formatRunMessage(await learningRepairRun())); } },
  { name: '/ghost_close_status', category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: 'Ghost close resolver dry-run 상태', async execute({ reply }) { const r = await runGhostCloseResolver({ dryRun: true }); reply(`👻 ghost_close_status scanned=${r.candidatesScanned} closeCandidates=${r.closed} pendingRetry=${r.pendingRetry} quarantined=${r.quarantined} executionImpact=NONE brokerOrdersCreated=${r.brokerOrdersCreated}`); } },
  { name: '/ghost_close_run', category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: 'OPEN ghost case virtual close 실행', async execute({ reply }) { const r = await runGhostCloseResolver(); reply(`👻 ghost_close_run scanned=${r.candidatesScanned} closed=${r.closed} pendingRetry=${r.pendingRetry} quarantined=${r.quarantined} executionImpact=NONE brokerOrdersCreated=${r.brokerOrdersCreated}`); } },
  { name: '/attribution_backfill', category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: 'closed but not attributed backfill', async execute({ reply }) { const r = runAttributionBackfill(); reply(`🧬 attribution_backfill processed=${r.processedCount} skipped=${r.skippedCount} samples7d=${r.attributionSamples7d}/${r.targetSampleCount} starvation=${r.starvationFlag} skipReason=${JSON.stringify(r.skipReasons)}`); } },
  { name: '/suggest_diagnostics', category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: 'Suggest silence 진단 및 proposal 생성', async execute({ reply }) { const r = runSuggestThresholdCalibrator({ suggest7d: { counterfactual: 0, ledger: 0, kellySurface: 0, regime: 0 } }); reply(`💡 suggest_diagnostics blocker=${r.blocker} proposals=${r.proposals.length} autoApply=false\n${r.proposals.map(p => `${p.channel}: score=${p.observedScore}/${p.currentThreshold} sample=${p.sampleSize}`).join('\n')}`); } },
  { name: '/gemini_learning_status', category: 'LRN', visibility: 'ADMIN', riskLevel: 0, description: 'Gemini learning reflection 호출률/예약 상태', async execute({ reply }) { const r = scheduleGeminiLearningReflection(); reply(`♊ gemini_learning_status callsThisMonth=${r.callsThisMonth}/${r.tradingDaysThisMonth} utilizationRate=${(r.utilizationRate*100).toFixed(0)}% lastCallAt=${r.lastCallAt ?? 'N/A'} nextScheduledAt=${r.nextScheduledAt ?? 'N/A'} diagnostic=${r.diagnostic} recommendationOnly=${r.recommendationOnly}`); } },
];
for (const c of cmds) commandRegistry.register(c);
export default cmds;
