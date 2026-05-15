// @responsibility /normal_supply_preview diagnostic-only normal-mode supply preview.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE,
  formatNormalSupplyPreviewMissingSection,
  formatNormalSupplyPreviewFullSections,
  formatNormalSupplyPreviewSection,
  getLastNormalSupplyPreview,
  type NormalSupplyPreview,
} from '../../../trading/signalScanner/normalSupplyPreview.js';
import { collectNormalSupplyPreviewFromWatchlist } from '../../../trading/signalScanner/normalSupplyPreviewRunner.js';

const normalSupplyPreview: TelegramCommand = {
  name: '/normal_supply_preview',
  aliases: ['/normal_supply', '/supply_preview'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'SELL_ONLY/macro live block 중 정상모드 기준 후보별 수급 preview',
  usage: '/normal_supply_preview [full]',
  async execute({ args, reply }) {
    const fullMode = args.some((arg) => {
      const normalized = arg.trim().toLowerCase();
      return normalized === 'full' || normalized === '--full';
    });
    const replyMany = async (messages: string[]): Promise<void> => {
      for (const message of messages) {
        await reply(message);
      }
    };
    await reply(
      [
        '🧪 <b>[Normal Supply Preview]</b> collecting...',
        `previewMode=${fullMode ? NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE : 'NORMAL_SUPPLY_DIAGNOSTIC'}`,
        'liveExecutionAllowed=false',
        'realOrderAllowed=false',
        'executionImpact=NONE',
      ].join('\n'),
    );
    try {
      const preview = await collectNormalSupplyPreviewFromWatchlist({
        reason: 'telegram operator /normal_supply_preview',
      });
      if (fullMode) {
        logFullStart(preview);
        const pages = formatNormalSupplyPreviewFullSections(preview, { maxTopCandidates: 10 });
        logFullDone(preview, pages.length);
        await replyMany(pages);
      } else {
        await reply(formatNormalSupplyPreviewSection(preview, { maxTopCandidates: 10 }) ?? formatNormalSupplyPreviewMissingSection());
      }
    } catch (error) {
      const latest = getLastNormalSupplyPreview();
      const message = error instanceof Error ? error.message : String(error);
      if (latest && fullMode) {
        logFullStart(latest);
        const pages = formatNormalSupplyPreviewFullSections(latest, { maxTopCandidates: 10 });
        logFullDone(latest, pages.length);
        await replyMany([...pages, `refreshError: ${message}`]);
      } else {
        await reply(
          latest
            ? [
                formatNormalSupplyPreviewSection(latest, { maxTopCandidates: 10 }),
                '',
                `refreshError: ${message}`,
              ].filter((line): line is string => Boolean(line)).join('\n')
            : formatNormalSupplyPreviewMissingSection(message),
        );
      }
    }
  },
};

commandRegistry.register(normalSupplyPreview);

export default normalSupplyPreview;

function logFullStart(preview: NormalSupplyPreview): void {
  console.info(
    `[NORMAL_SUPPLY_PREVIEW_FULL_START] ` +
      `source=${preview.source} candidateCount=${preview.candidateCount} ` +
      `previewMode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `liveExecutionAllowed=false realOrderAllowed=false executionImpact=NONE`,
  );
}

function logFullDone(preview: NormalSupplyPreview, pages: number): void {
  const contamination =
    preview.signalSourceSplit.bearishFromProviderIssue + preview.signalSourceSplit.bullishFromProviderIssue;
  console.info(
    `[NORMAL_SUPPLY_PREVIEW_FULL_DONE] ` +
      `candidateCount=${preview.candidateCount} verified=${preview.healthCounts.VERIFIED} ` +
      `unknown=${preview.healthCounts.UNKNOWN} bullish=${preview.signalCounts.BULLISH} ` +
      `neutral=${preview.signalCounts.NEUTRAL} bearish=${preview.signalCounts.BEARISH} ` +
      `unusable=${preview.signalCounts.UNUSABLE} ` +
      `bearishFromProviderIssue=${preview.signalSourceSplit.bearishFromProviderIssue} ` +
      `unknownPenaltyApplied=false providerCallsAdded=0 pages=${pages} executionImpact=NONE`,
  );
  if (contamination > 0) {
    console.warn(
      `[NORMAL_SUPPLY_PREVIEW_PROVIDER_SIGNAL_CONTAMINATION] ` +
        `signal=BEARISH|BULLISH providerIssueCount=${contamination} executionImpact=NONE severity=warn`,
    );
  }
}
