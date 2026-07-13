// @responsibility Trace buffer read-only diagnostic commands.
import {
  clearTraceRecords,
  formatTraceRecent,
  formatTraceRecord,
  getTraceRecord,
} from '../../../utils/logger.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const traceRecent: TelegramCommand = {
  name: '/trace_recent',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '최근 압축 진단 trace 목록',
  usage: '/trace_recent [limit]',
  async execute({ args, reply }) {
    const limit = Math.max(1, Math.min(20, Number(args[0] ?? '10') || 10));
    await reply(formatTraceRecent(limit));
  },
};

const traceShow: TelegramCommand = {
  name: '/trace_show',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'traceId 상세 조회',
  usage: '/trace_show <traceId>',
  async execute({ args, reply }) {
    await reply(formatTraceRecord(getTraceRecord(args[0] ?? '')));
  },
};

const traceClear: TelegramCommand = {
  name: '/trace_clear',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'trace buffer 비우기',
  usage: '/trace_clear',
  async execute({ reply }) {
    const cleared = clearTraceRecords();
    await reply(`[TRACE_CLEAR] cleared=${cleared} executionImpact=NONE`);
  },
};

for (const command of [traceRecent, traceShow, traceClear]) commandRegistry.register(command);
