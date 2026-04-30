// @responsibility scanBlockers.cmd 텔레그램 모듈
/**
 * @responsibility /scan_blockers 명령 — 직전 스캔의 *매수 차단 사유 분포* 즉시 진단.
 *
 * ADR-0118: 사용자 보고 "FOMC 다음날인데 매수 0건" 직접 대응. 직전 스캔의
 * waitDistribution + macroGateState 를 텔레그램 메시지로 포맷.
 */
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatScanBlockersMessage,
  getLastScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';

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
    await reply(formatScanBlockersMessage(summary));
  },
};

commandRegistry.register(scanBlockers);

export default scanBlockers;
