// @responsibility dxy.cmd 텔레그램 모듈
// @responsibility: /dxy /dxy_intraday — DXY 인트라데이 스냅샷 (Yahoo 5m 우선 + Alpha Vantage fallback).
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const dxy: TelegramCommand = {
  name: '/dxy',
  aliases: ['/dxy_intraday'],
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'DXY 인트라데이 스냅샷 (Yahoo + Alpha Vantage fallback)',
  async execute({ reply }) {
    const { getDxyIntradaySnapshot } = await import('../../../alerts/dxyMonitor.js');
    const snap = await getDxyIntradaySnapshot();
    if (!snap) {
      await reply(
        '💱 <b>[DXY 인트라데이]</b>\n' +
        '데이터 소스 모두 실패 — Yahoo Finance 와 Alpha Vantage 모두 응답 없음.\n' +
        '<i>ALPHA_VANTAGE_API_KEY 환경변수를 설정하면 fallback 이 활성화됩니다.</i>',
      );
      return;
    }
    const sign = snap.changePct >= 0 ? '+' : '';
    const arrow = snap.changePct >= 0 ? '▲' : '▼';
    const stale =
      snap.source === 'YAHOO'
        ? `최신 봉: ${new Date(snap.asOf).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}`
        : `Alpha Vantage 단일 스냅샷 (변화율 비교 불가)`;
    await reply(
      `💱 <b>[DXY 인트라데이]</b> 소스: ${snap.source}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${arrow} DXY ${snap.last.toFixed(2)} | ${snap.windowMinutes}분 윈도우 ${sign}${snap.changePct.toFixed(2)}%\n` +
      `${stale}\n\n` +
      `<i>임계 ±${process.env.DXY_INTRADAY_THRESHOLD ?? '0.4'}% 돌파 시 자동 ANALYSIS 채널 + 개인 채팅 발송</i>`,
    );
  },
};

commandRegistry.register(dxy);

export default dxy;
