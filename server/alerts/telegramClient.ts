/**
 * Telegram Bot API — setMyCommands로 봇 메뉴에 명령어 목록 등록
 * 서버 기동 시 1회 호출하면 Telegram 앱에서 '/' 입력 시 자동완성 메뉴가 표시된다.
 */
export async function setTelegramBotCommands(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const commands = [
    { command: 'help',      description: '명령어 목록 보기' },
    { command: 'status',    description: '시스템 현황 요약' },
    { command: 'market',    description: '시장상황 요약 레포트' },
    { command: 'watchlist', description: '워치리스트 조회' },
    { command: 'shadow',    description: 'Shadow 성과 현황' },
    { command: 'pending',   description: '미체결 주문 조회' },
    { command: 'report',    description: '일일 리포트 생성' },
    { command: 'buy',       description: '수동 매수 신호 (예: /buy 005930)' },
    { command: 'stop',      description: '비상 정지 발동' },
    { command: 'reset',     description: '비상 정지 해제' },
  ];

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[Telegram] setMyCommands 실패:', err.slice(0, 200));
    } else {
      console.log('[Telegram] 봇 명령어 메뉴 등록 완료 (10개)');
    }
  } catch (e: unknown) {
    console.error('[Telegram] setMyCommands 오류:', e instanceof Error ? e.message : e);
  }
}

/**
 * Telegram Bot API를 통해 즉시 모바일 알림 전송
 * Railway 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
export async function sendTelegramAlert(message: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // 미설정 시 조용히 패스

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[Telegram] 전송 실패:', err.slice(0, 200));
    }
  } catch (e: unknown) {
    console.error('[Telegram] 오류:', e instanceof Error ? e.message : e);
  }
}
