// @responsibility dataCompleteness.cmd — read-only data completeness first-screen.
// @responsibility: /data_completeness — 데이터 신선도/완결성/실행 권고를 한 화면에 요약.

import {
  buildDataCompletenessSummary,
  formatDataCompletenessSummary,
} from '../../../diagnostics/dataCompletenessSummary.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function wantsFull(args: string[]): boolean {
  return args.some((arg) => arg.toLowerCase() === 'full' || arg.toLowerCase() === '--full');
}

const dataCompleteness: TelegramCommand = {
  name: '/data_completeness',
  aliases: ['/data_matrix', '/data_status_plus'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '데이터 완결성 요약 — 기본 compact, full 상세 지원',
  usage: '/data_completeness [full]',
  async execute({ args, reply }) {
    await reply(formatDataCompletenessSummary(buildDataCompletenessSummary(), { full: wantsFull(args) }));
  },
};

commandRegistry.register(dataCompleteness);

export default dataCompleteness;
