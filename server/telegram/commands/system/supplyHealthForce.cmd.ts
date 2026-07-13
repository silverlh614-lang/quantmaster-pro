/**
 * @responsibility /shf — Supply Health in-memory cache 를 무시하고 즉시 재계산한다.
 *
 * PR-591: seed/backfill 직후 `/sh` 가 TTL cache 때문에 이전 상태를 보여주는 운영 피로를 줄인다.
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { __resetSupplyHealthCacheForTests, buildSupplyHealthMessage } from './supplyHealth.cmd.js';

async function buildSupplyHealthForceMessage(): Promise<string> {
  __resetSupplyHealthCacheForTests();
  return buildSupplyHealthMessage();
}

const supplyHealthForce: TelegramCommand = {
  name: '/supply_health_force',
  aliases: ['/shf', '/sh_force', '/sh_refresh'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Supply Health cache 무시 후 즉시 재계산',
  usage: '/supply_health_force',
  async execute({ reply }) {
    try {
      await reply(await buildSupplyHealthForceMessage());
    } catch (err) {
      console.error('[supplyHealthForce.cmd] failed', err);
      await reply('🔴 Supply Health force refresh 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(supplyHealthForce);
