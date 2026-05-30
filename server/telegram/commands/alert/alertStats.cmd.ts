/**
 * @responsibility 알림 원장 일별 통계를 조회해 텔레그램으로 응답하는 /alert_stats 명령을 등록한다.
 */

import { getNotificationStats } from '../../../persistence/notificationLedgerRepo.js'; import { commandRegistry } from '../../commandRegistry.js'; import type { TelegramCommand } from '../_types.js';
const cmd: TelegramCommand={name:'/alert_stats',category:'ALR',visibility:'ADMIN',riskLevel:0,description:'원장 통계',usage:'/alert_stats [YYYY-MM-DD]',async execute({args,reply}){const d=args[0]??new Date().toISOString().slice(0,10);const s=await getNotificationStats(d);await reply(`📊 ${d}\n`+Object.entries(s).map(([k,v])=>`${k}: ${v}`).join('\n'));}}; commandRegistry.register(cmd);
