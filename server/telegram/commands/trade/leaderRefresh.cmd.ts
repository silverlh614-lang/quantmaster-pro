// @responsibility leaderRefresh.cmd 텔레그램 모듈
// @responsibility: /leader_refresh — 주도주 유니버스 캐시(dynamic-universe.json) 수동 즉시 갱신. TRD.
import { getEmergencyStop } from '../../../state.js';
import {
  runLeaderUniverseDailyRefresh,
  isLeaderUniverseDailyRefreshEnabled,
  loadDynamicUniverse,
} from '../../../screener/dynamicUniverseExpander.js';
import { isLeaderUniverseInjectionEnabled } from '../../../screener/leaderUniverseInjectionAdr0617.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const leaderRefresh: TelegramCommand = {
  name: '/leader_refresh',
  aliases: ['/lr'],
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '주도주 유니버스 캐시 즉시 갱신 (LEADER_SOURCES 3종 강제 fetch — 장중 전용)',
  async execute({ reply }) {
    if (getEmergencyStop()) {
      await reply('🔴 비상 정지 상태 — 캐시 갱신 불가. /reset 으로 해제 후 재시도.');
      return;
    }
    await reply(
      `🔄 <b>주도주 캐시 강제 갱신 트리거</b>\n` +
      `LEADER_SOURCES 3종 (시총·기관순매수·외인근사) KIS 랭킹 fetch 중... (장중에만 유효)`,
    );
    try {
      // 비게이트: flag OFF 여도 운영자 명시 행위이므로 실행. flag 는 read-only 안내용.
      const dailyRefreshEnabled = isLeaderUniverseDailyRefreshEnabled();
      const injectionEnabled = isLeaderUniverseInjectionEnabled();

      // runLeaderUniverseDailyRefresh 는 내부 try/catch 격리 → throw 없이 합산 정수 반환.
      const updated = await runLeaderUniverseDailyRefresh();
      const total = loadDynamicUniverse().length;

      const lines = [
        `✅ <b>주도주 캐시 갱신 완료</b>`,
        `갱신 ${escapeHtml(String(updated))}건 (신규+연장 합산)`,
        `전체 동적 유니버스: ${escapeHtml(String(total))}개`,
        `DAILY_REFRESH flag: ${dailyRefreshEnabled ? 'ON' : 'OFF'} · INJECTION flag: ${injectionEnabled ? 'ON' : 'OFF'}`,
      ];

      if (updated === 0) {
        lines.push(
          `⚠️ 장외이거나 변동 없음 — getRanking 은 장중에만 데이터(ADR-0009). ` +
          `KST 09:00~15:30 에 재시도.`,
        );
      }

      if (!injectionEnabled) {
        lines.push(
          `⚠️ 캐시는 갱신됐으나 후보 풀 반영은 LEADER_UNIVERSE_INJECTION_ENABLED 의존 (현재 OFF).`,
        );
      }

      await reply(lines.join('\n'));
    } catch (e) {
      await reply(
        `❌ <b>주도주 캐시 갱신 실패</b>\n` +
        `${escapeHtml(e instanceof Error ? e.message : String(e))}`,
      );
    }
  },
};

commandRegistry.register(leaderRefresh);

export default leaderRefresh;
