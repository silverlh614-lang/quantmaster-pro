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
import { logVisibilityEvent, withLogVerbosity, type LogVerbosity } from '../../../utils/logger.js';

const normalSupplyPreview: TelegramCommand = {
  name: '/normal_supply_preview',
  aliases: ['/normal_supply', '/supply_preview'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'SELL_ONLY/macro live block 중 정상모드 기준 후보별 수급 preview',
  usage: '/normal_supply_preview [full] [verbose|trace]',
  async execute({ args, reply }) {
    const fullMode = args.some((arg) => {
      const normalized = arg.trim().toLowerCase();
      return normalized === 'full' || normalized === '--full';
    });
    const verbosity = parseCommandVerbosity(args);
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
      await withLogVerbosity(verbosity, async () => {
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
      });
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

function parseCommandVerbosity(args: string[]): LogVerbosity | undefined {
  if (args.some((arg) => ['trace', '--trace'].includes(arg.toLowerCase()))) return 'trace';
  if (args.some((arg) => ['verbose', '--verbose', 'diagnostic', '--diagnostic'].includes(arg.toLowerCase()))) return 'diagnostic';
  return undefined;
}

function logFullStart(preview: NormalSupplyPreview): void {
  logVisibilityEvent({
    visibility: 'DIAGNOSTIC',
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    message: `[NORMAL_SUPPLY_PREVIEW_FULL_START] ` +
      `source=${preview.source} candidateCount=${preview.candidateCount} ` +
      `previewMode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `liveExecutionAllowed=false realOrderAllowed=false executionImpact=NONE`,
    summary: { source: preview.source, candidateCount: preview.candidateCount, executionImpact: 'NONE' },
    details: { previewMode: NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE },
    level: 'info',
    executionImpact: 'NONE',
  });
}

function logFullDone(preview: NormalSupplyPreview, pages: number): void {
  const contamination =
    preview.signalSourceSplit.bearishFromProviderIssue +
    preview.signalSourceSplit.bullishFromProviderIssue +
    preview.signalSourceSplit.accumulatingFromProviderIssue;
  logVisibilityEvent({
    visibility: 'DIAGNOSTIC',
    category: 'SUPPLY',
    sourceCommand: '/normal_supply_preview',
    message: `[NORMAL_SUPPLY_PREVIEW_FULL_DONE] ` +
      `candidateCount=${preview.candidateCount} verified=${preview.healthCounts.VERIFIED} ` +
      `unknown=${preview.healthCounts.UNKNOWN} bullish=${preview.signalCounts.BULLISH} ` +
      `accumulating=${preview.signalCounts.ACCUMULATING} neutral=${preview.signalCounts.NEUTRAL} bearish=${preview.signalCounts.BEARISH} ` +
      `unusable=${preview.signalCounts.UNUSABLE} ` +
      `bearishFromProviderIssue=${preview.signalSourceSplit.bearishFromProviderIssue} ` +
      `unknownPenaltyApplied=false providerCallsAdded=0 pages=${pages} executionImpact=NONE`,
    summary: { candidateCount: preview.candidateCount, healthCounts: preview.healthCounts, signalCounts: preview.signalCounts, pages, executionImpact: 'NONE' },
    details: { preview },
    level: 'info',
    executionImpact: 'NONE',
  });
  if (contamination > 0) {
    console.warn(
      `[NORMAL_SUPPLY_PREVIEW_PROVIDER_SIGNAL_CONTAMINATION] ` +
        `signal=BEARISH|BULLISH|ACCUMULATING providerIssueCount=${contamination} executionImpact=NONE severity=warn`,
    );
  }
}
