/**
 * channelFormatter.ts — 채널·DM 공통 메시지 포맷 헬퍼
 *
 * 기존 각 모듈이 중복으로 들고 있던 구분선·KST 시각·헤더 블록을 1곳에서 관리한다.
 * 포맷 변경 시 이 파일만 수정하면 전 채널 메시지에 일관 적용된다.
 */

// 모바일 360dp 가로폭에서 2줄 wrap 없이 표시되도록 16 자로 축소 (ADR-0005).
// 기존 20 자는 한글 본문과 섞이면 일부 기기에서 줄넘김이 발생했다.
export const CHANNEL_SEPARATOR = '━━━━━━━━━━━━━━━━';

/** KST "HH:MM" 현재 시각. */
export function kstHHMM(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 3_600_000);
  const hh = kst.getUTCHours().toString().padStart(2, '0');
  const mm = kst.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** KST "MM/DD" 오늘 날짜. */
export function kstMMDD(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 3_600_000);
  const mm = (kst.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = kst.getUTCDate().toString().padStart(2, '0');
  return `${mm}/${dd}`;
}

export interface ChannelHeaderOptions {
  /** 선두 이모지 (예: "📋", "🌙"). */
  icon: string;
  /** 대제목 — [ ] 로 감싸지며 굵게 렌더된다. */
  title: string;
  /** 우측 꼬리 (예: "08:35 KST", "04/20"). 없으면 생략. */
  suffix?: string;
}

/**
 * 표준 채널 헤더 블록을 생성한다.
 * ```
 * 📋 <b>[오늘 스캔 결과] 04/20</b>
 * ━━━━━━━━━━━━━━━━
 * ```
 */
export function channelHeader(opts: ChannelHeaderOptions): string {
  const tail = opts.suffix ? ` ${opts.suffix}` : '';
  return `${opts.icon} <b>[${opts.title}]${tail}</b>\n${CHANNEL_SEPARATOR}`;
}

/**
 * 채널 발송 전역 스위치. CHANNEL_ENABLED='true' 일 때만 채널 쪽 전송을 허용.
 * channelPipeline.ts 가 내부적으로 쓰던 게이트를 공용화하여 신규 브로드캐스트
 * 모듈이 동일 기준을 공유한다.
 */
export function isChannelEnabled(): boolean {
  return process.env.CHANNEL_ENABLED === 'true';
}
