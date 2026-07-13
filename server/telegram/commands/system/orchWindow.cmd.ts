// @responsibility Telegram orchestrator window inspection command handler.
import { tradingOrchestrator } from '../../../orchestrator/tradingOrchestrator.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function kstDate(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function clock(now = new Date()): { hm: string; min: number; dow: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? '0');
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? '0');
  const w = p.find((x) => x.type === 'weekday')?.value ?? 'Mon';
  const dow = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[w] ?? 1;
  return { hm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, min: h * 60 + m, dow };
}

function windowLabel(now = new Date()): string {
  const c = clock(now);
  if (c.dow === 0 || c.dow === 6) return `weekend ${c.hm}`;
  if (c.min < 480) return `pre  ${c.hm}->08:00`;
  if (c.min < 1020) return `active ${c.hm}`;
  return `closed ${c.hm}->next 08:00`;
}

function dateOf(iso?: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : null;
}

function flag(iso: string | undefined, current: string): string {
  const d = dateOf(iso);
  if (!d) return 'notRan';
  return d === current ? 'current' : `stale ${d}`;
}

function message(now = new Date()): string {
  const s = tradingOrchestrator.getStatus();
  const cur = kstDate(now);
  const fresh = s.tradingDate === cur;
  return [
    '🕒 <b>ORCH WINDOW</b>',
    `window: <b>${windowLabel(now)}</b>`,
    `tradingDate: <b>${s.tradingDate || 'unknown'}</b>`,
    `currentKstDate: <b>${cur}</b>`,
    `dateFresh: <b>${fresh ? 'true' : 'false'}</b>`,
    `state: ${s.computedState} / ${s.currentState}`,
    '',
    `openAuction: ${flag(s.handlerRanAt.openAuction, cur)}`,
    `marketOpen: ${flag(s.handlerRanAt.marketOpen, cur)}`,
    `midday: ${flag(s.handlerRanAt.middayRescan, cur)}`,
    '',
    fresh ? 'Meaning: current.' : 'Meaning: before 08:00, stale date may be normal until first cycle.',
    'Next: /scan_readiness, /cron_status',
  ].join('\n');
}

const cmd: TelegramCommand = {
  name: '/orch_window',
  aliases: ['/orchestrator_window', '/rollover_window'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '오케스트레이터 시간대/날짜 상태 요약',
  usage: '/orch_window',
  async execute({ reply }) {
    await reply(message());
  },
};

commandRegistry.register(cmd);
