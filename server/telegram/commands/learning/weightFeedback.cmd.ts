// @responsibility /weight_feedback ADR-0524 Dynamic Weight Feedback report. Read-only, suggest-only.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { outcomeClosureRepo } from '../../../learning/outcomeClosure.js';
import {
  buildWeightFeedbackReport,
  formatWeightFeedbackCompact,
  formatWeightFeedbackDetail,
  formatWeightFeedbackFull,
  nextWeightFeedbackRunKst,
} from '../../../learning/dynamicWeightFeedback.js';

async function replyInChunks(reply: (message: string) => Promise<void>, message: string): Promise<void> {
  const maxLen = 3600;
  if (message.length <= maxLen) {
    await reply(message);
    return;
  }
  let chunk = '';
  for (const line of message.split('\n')) {
    if (chunk.length + line.length + 1 > maxLen) {
      await reply(chunk.trimEnd());
      chunk = '';
    }
    chunk += `${line}\n`;
  }
  if (chunk.trim()) await reply(chunk.trimEnd());
}

const weightFeedback: TelegramCommand = {
  name: '/weight_feedback',
  aliases: ['/weight_fb', '/weight_feedback_full'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Dynamic weight feedback report-only suggestions',
  usage: '/weight_feedback [detail|full|refresh]',
  async execute({ args, command, reply }) {
    const report = buildWeightFeedbackReport({
      seeds: outcomeClosureRepo.listSeeds(),
      createdAt: new Date().toISOString(),
    });
    const mode = command === '/weight_feedback_full' ? 'full' : args.find(arg => ['detail', 'full', 'refresh'].includes(arg.toLowerCase()))?.toLowerCase();
    const body = mode === 'full'
      ? formatWeightFeedbackFull(report)
      : mode === 'detail'
        ? formatWeightFeedbackDetail(report)
        : formatWeightFeedbackCompact(report);
    await replyInChunks(reply, [
      body,
      '',
      `governance: approvalRequired=true autoApplyAllowed=false nextWeeklyRun=${nextWeightFeedbackRunKst()}`,
      'note: report-only; no CORE weight mutation, no provider fetch, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(weightFeedback);

export default weightFeedback;
