import { getNotificationStats, queryNotificationLedger } from '../../../persistence/notificationLedgerRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const cmd: TelegramCommand = { name:'/alert_inbox', category:'ALR', visibility:'ADMIN', riskLevel:0, description:'오늘 원장 요약', usage:'/alert_inbox', async execute({reply}) { const d=new Date().toISOString().slice(0,10); const stats=await getNotificationStats(d); const rows=await queryNotificationLedger({dateKey:d}); const top=Object.entries(rows.reduce((a,r)=>{a[r.eventType]=(a[r.eventType]??0)+1;return a;},{} as Record<string,number>)).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}:${v}`).join(', '); await reply(`📬 <b>alert_inbox ${d}</b>\n${Object.entries(stats).map(([k,v])=>`${k}: ${v}`).join('\n')}\nTop: ${top||'-'}`);} };
commandRegistry.register(cmd);
