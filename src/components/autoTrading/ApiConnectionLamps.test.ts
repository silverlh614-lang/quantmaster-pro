/**
 * @responsibility deriveTelegram 단위 테스트 — PR-P
 */
import { describe, it, expect } from 'vitest';
import { deriveTelegram } from './ApiConnectionLamps';

describe('deriveTelegram — PR-P', () => {
  it('health=null → unknown', () => {
    const r = deriveTelegram(null);
    expect(r.label).toBe('Telegram');
    expect(r.state).toBe('unknown');
  });

  it('telegramConfigured=true → ok', () => {
    const r = deriveTelegram({ telegramConfigured: true });
    expect(r.state).toBe('ok');
    expect(r.detail).toContain('설정됨');
  });

  it('telegramBotTokenOnly=true → warn (CHAT_ID 미설정)', () => {
    const r = deriveTelegram({ telegramBotTokenOnly: true });
    expect(r.state).toBe('warn');
    expect(r.detail).toContain('CHAT_ID');
  });

  it('telegramChatIdOnly=true → warn (BOT_TOKEN 미설정)', () => {
    const r = deriveTelegram({ telegramChatIdOnly: true });
    expect(r.state).toBe('warn');
    expect(r.detail).toContain('BOT_TOKEN');
  });

  it('모든 필드 false → down (둘 다 미설정)', () => {
    const r = deriveTelegram({
      telegramConfigured: false,
      telegramBotTokenOnly: false,
      telegramChatIdOnly: false,
    });
    expect(r.state).toBe('down');
    expect(r.detail).toContain('둘 다');
  });

  it('빈 객체 → down (모든 필드 undefined)', () => {
    const r = deriveTelegram({});
    expect(r.state).toBe('down');
  });
});
