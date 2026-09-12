// @responsibility channelTest.cmd 활성 채널 시험 발송과 결과 요약
// @responsibility: /channel_test — 활성 채팅방마다 한 번 발송으로 환경변수·봇 권한·채널 ID 검증 (ADR-0042).
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { runChannelHealthCheck, type ChannelHealthItem } from '../../../alerts/alertRouter.js';
import { AlertCategory } from '../../../alerts/alertCategories.js';

/** AlertCategory enum 값 → 사용자 시멘틱 라벨 (CH1/CH2/CH3/CH4 + 별칭) */
const CATEGORY_LABEL: Record<AlertCategory, string> = {
  [AlertCategory.TRADE]: 'CH1 EXECUTION (TRADE)',
  [AlertCategory.ANALYSIS]: 'CH2 SIGNAL (ANALYSIS)',
  [AlertCategory.INFO]: 'CH3 REGIME (INFO)',
  [AlertCategory.SYSTEM]: 'CH4 JOURNAL (SYSTEM)',
};

/** 카테고리 → 환경변수 이름 (실패 진단용) */
const CATEGORY_ENV: Record<AlertCategory, string> = {
  [AlertCategory.TRADE]: 'TELEGRAM_TRADE_CHANNEL_ID',
  [AlertCategory.ANALYSIS]: 'TELEGRAM_ANALYSIS_CHANNEL_ID',
  [AlertCategory.INFO]: 'TELEGRAM_INFO_CHANNEL_ID',
  [AlertCategory.SYSTEM]: 'TELEGRAM_SYSTEM_CHANNEL_ID',
};

/** 헬스체크 결과 → 사용자 메시지 포맷 (순수 함수, 테스트 가능) */
export function formatChannelHealthCheckResult(
  result: Record<AlertCategory, ChannelHealthItem>,
): string {
  const order: AlertCategory[] = [
    AlertCategory.TRADE,
    AlertCategory.ANALYSIS,
    AlertCategory.INFO,
    AlertCategory.SYSTEM,
  ];
  const lines: string[] = ['🧪 <b>[4채널 헬스체크 결과]</b>', '━━━━━━━━━━━━━━━━'];
  let okCount = 0;
  const failedEnvs: string[] = [];

  for (const cat of order) {
    const item = result[cat];
    const label = CATEGORY_LABEL[cat];
    if (!item) {
      lines.push(`❓ ${label} — 결과 누락`);
      continue;
    }
    if (item.ok) {
      okCount += 1;
      lines.push(`✅ ${label} — 정상 (msg #${item.messageId})`);
    } else {
      // 실패 사유별 분기
      if (!item.configured) {
        lines.push(`❌ ${label} — 채널 ID 미설정 (${CATEGORY_ENV[cat]})`);
        failedEnvs.push(CATEGORY_ENV[cat]);
      } else if (!item.enabled) {
        lines.push(`⏸️ ${label} — 비활성 (CHANNEL_ENABLED 설정)`);
      } else {
        lines.push(`❌ ${label} — 발송 실패 (${item.reason ?? 'unknown'})`);
      }
    }
  }

  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`<b>요약:</b> ${okCount}/4 채널 정상`);
  if (failedEnvs.length > 0) {
    lines.push(`⚠️ 미설정 환경변수: ${failedEnvs.join(', ')}`);
  }
  if (okCount === 4) {
    lines.push('✨ 모든 채널 정상 — 알림 라우팅 건강함');
  }

  return lines.join('\n');
}

const channelTest: TelegramCommand = {
  name: '/channel_test',
  aliases: ['/channel_health'],
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '활성 채널 시험 발송 + 연결 결과 요약',
  async execute({ reply }) {
    try {
      const result = await runChannelHealthCheck();
      const message = formatChannelHealthCheckResult(result);
      await reply(message);
    } catch (e) {
      await reply(`❌ 헬스체크 실행 중 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

commandRegistry.register(channelTest);
