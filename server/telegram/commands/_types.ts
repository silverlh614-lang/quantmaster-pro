// @responsibility _types 텔레그램 모듈
// @responsibility: TelegramCommand 인터페이스·CommandContext·카테고리 enum 정의 (Stage 2 Phase A SSOT).
//
// ADR-0017 §Stage 2 — webhookHandler.ts 거대 switch 를 명령어별 파일로 분해하기 위한
// 표준 인터페이스. 본 파일은 타입만 정의하고 부수효과(파일 import) 가 없다.

import type { InlineKeyboardMarkup } from '../metaCommands.js';

/** 명령어 분류 라벨. ADR-0017 §Stage 2 의 디렉토리 구조와 동기화. */
export type CommandCategory =
  | 'SYS'  // 시스템 현황 (status/health/regime)
  | 'MKT'  // 시장 (market/dxy/news_lag)
  | 'WL'   // 워치리스트 (watchlist/focus/add/remove)
  | 'POS'  // 포지션 (pos/pnl/pending)
  | 'TRD'  // 매매 (buy/sell/scan/cancel/reconcile)
  | 'LRN'  // 학습 (learning_*/kelly/ledger/counterfactual/risk)
  | 'ALR'  // 알림·채널 (channel_*/alert_*/digest_*/todaylog)
  | 'EMR'; // 비상·제어 (pause/resume/stop/reset/integrity/refresh_token/reconnect_ws)

/**
 * Telegram setMyCommands 노출 정책.
 * - MENU: 메타 메뉴 8개에 직접 노출 (Stage 1 메뉴 압축으로 사실상 8개만 사용).
 * - ADMIN: 인라인 키보드 admin 메뉴에 포함.
 * - HIDDEN: 직접 입력만 가능 (메뉴/키보드 노출 없음).
 */
export type CommandVisibility = 'MENU' | 'ADMIN' | 'HIDDEN';

/**
 * 위험도 — 0: read-only, 1: 가벼운 mutate (예: digest_on), 2: 매매·돈 흐름.
 * Stage 2 Phase A 는 0 만 이전한다.
 */
export type CommandRiskLevel = 0 | 1 | 2;

/** webhookHandler 의 reply 헬퍼와 동일 시그니처. */
export type CommandReplyFn = (
  message: string,
  replyMarkup?: InlineKeyboardMarkup,
) => Promise<void>;

/** 명령어 실행 컨텍스트. webhookHandler 가 case 진입 시 채워서 전달. */
export interface CommandContext {
  /** 텍스트의 첫 토큰을 제외한 잔여 인자 (split(/\s+/) 기준). */
  args: string[];
  /** 응답 전송. 인라인 키보드 옵션 동일. */
  reply: CommandReplyFn;
}

/**
 * 명령어 정의. 한 파일 = 한 명령어 = 단일 책임.
 * commandRegistry 가 name + aliases 모두를 키로 등록한다.
 */
export interface TelegramCommand {
  /** 정식 명령 (예: '/status'). 슬래시 포함. lowercase. */
  name: string;
  /** 추가 별칭 (예: ['/schedule'] for '/scheduler'). */
  aliases?: string[];
  category: CommandCategory;
  visibility: CommandVisibility;
  /** 0 = read-only, 1 = light mutate, 2 = trade/money. */
  riskLevel: CommandRiskLevel;
  /** setMyCommands 또는 /help 표시용 한 줄 설명. ≤ 100자. */
  description: string;
  /** 사용 형식 안내 (예: '/add <code>'). 옵셔널. */
  usage?: string;
  /** 본 명령 실행 본체. 예외는 webhookHandler 가 catch 한다. */
  execute(ctx: CommandContext): Promise<void>;
}
