// @responsibility scheduler.cmd 텔레그램 모듈
// @responsibility: /scheduler /schedule 명령 — 스케줄러 시간표·다음·상세·이력을 4-mode 라우팅.
import {
  formatSchedulerSummary,
  formatSchedulerNext,
  formatSchedulerDetail,
  formatSchedulerHistory,
} from '../../../scheduler/scheduleCatalog.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const scheduler: TelegramCommand = {
  name: '/scheduler',
  aliases: ['/schedule'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '스케줄러 시간표/다음 실행/상세/실행 이력 ([next|detail|history N])',
  usage: '/scheduler [next|detail|history N]',
  async execute({ args, reply }) {
    const sub = (args[0] ?? '').toLowerCase();
    if (sub === 'next') {
      await reply(formatSchedulerNext());
    } else if (sub === 'detail') {
      await reply(formatSchedulerDetail());
    } else if (sub === 'history') {
      const n = Number(args[1]);
      await reply(formatSchedulerHistory(Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 15));
    } else {
      await reply(formatSchedulerSummary());
    }
  },
};

commandRegistry.register(scheduler);

export default scheduler;
