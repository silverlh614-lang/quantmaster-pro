/**
 * @responsibility /alert_search 명령 — 키워드로 알림 원장을 검색해 매칭 항목 목록을 회신한다.
 */

import { queryNotificationLedger } from '../../../persistence/notificationLedgerRepo.js'; import { commandRegistry } from '../../commandRegistry.js'; import type { TelegramCommand } from '../_types.js';
const cmd: TelegramCommand={name:'/alert_search',category:'ALR',visibility:'ADMIN',riskLevel:0,description:'원장 검색',usage:'/alert_search <keyword>',async execute({args,reply}){const q=args.join(' ').trim(); if(!q){await reply('usage: /alert_search <keyword>'); return;} const rows=await queryNotificationLedger({keyword:q}); await reply(`🔎 ${rows.length}\n`+rows.slice(-20).map(r=>`${r.id} | ${r.eventType} | ${r.message.slice(0,80)}`).join('\n'));}}; commandRegistry.register(cmd);
