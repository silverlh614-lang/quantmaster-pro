// @responsibility metaCommands 텔레그램 모듈
// @responsibility: Telegram 메타 명령어 6종 (/now /watch /positions /learning /control /admin) 핸들러 + 인라인 키보드 빌더 + callback 파서.
//
// ADR-0017 Stage 1 — webhookHandler.ts 의 거대 switch 는 그대로 유지하되 사용자 노출
// 명령어를 8개로 압축한다. 각 메타 명령어는 인라인 키보드로 기존 51개 alias 를 카테고리별로
// 펼쳐 보여준다. 본 모듈은 webhookHandler.ts 가 import 하여 case 6개에서 위임 호출한다.
//
// 순환 참조 방지: callback 재호출은 webhookHandler.ts 가 자체 소유 (parseMetaCallback 은
// 순수 파서만 제공). 메타 핸들러 자체도 외부 SSOT (state, shadowTradeRepo, macroState,
// signalScanner) 만 read-only 로 호출하고 부수효과 없음.

import { loadMacroState } from '../persistence/macroStateRepo.js';
import {
  getEmergencyStop,
  getAutoTradePaused,
  getDataIntegrityBlocked,
} from '../state.js';
import { getRemainingQty } from '../persistence/shadowTradeRepo.js';
import { getShadowTrades } from '../orchestrator/tradingOrchestrator.js';
import { getLastBuySignalAt } from '../trading/signalScanner.js';

// ── Telegram inline keyboard 형태 ────────────────────────────────────────────

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/** webhookHandler.ts 의 sendTelegramAlert 를 받아 메시지를 전송한다. */
export type MetaReplyFn = (
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
) => Promise<void>;

// ── 메타 → 하위 명령어 매핑 (ADR-0017 §Stage 1) ───────────────────────────────

interface MetaCommandSpec {
  /** 화면 헤더에 노출되는 한국어 라벨 */
  title: string;
  /** 메시지 본문 (인라인 키보드 위에 노출) */
  description: string;
  /** 키보드 행 배열 — 각 행은 button text 배열 (callback_data 는 자동 생성) */
  rows: string[][];
}

/** Telegram 인라인 키보드 행당 최대 버튼 수. 모바일 가독성 기준 3개 권장. */
const MAX_BUTTONS_PER_ROW = 3;

/**
 * 메타 명령어 정의. 새 메타 추가 시 본 객체에만 항목 추가하면 setMyCommands /
 * /help / handler 가 동기화된다.
 */
export const META_COMMAND_REGISTRY: Record<string, MetaCommandSpec> = {
  '/watch': {
    title: '👀 워치리스트',
    description:
      '워치리스트 조회·편집 및 Track B 매수 대상 상세를 한 화면에서 처리합니다.',
    rows: [
      ['/watchlist', '/focus'],
      ['/add', '/remove'],
      ['/watchlist_channel'],
    ],
  },
  '/positions': {
    title: '📊 포지션·주문',
    description:
      '보유·실시간 손익·미체결·수동 매도/취소·장부 reconcile 통합 메뉴입니다.',
    rows: [
      ['/pos', '/pnl'],
      ['/pending', '/cancel'],
      ['/sell', '/adjust_qty', '/reconcile'],
    ],
  },
  '/learning': {
    title: '🧠 학습·리스크',
    description:
      '자기학습 이력·Kelly·서킷·리스크 예산을 모두 모았습니다.',
    rows: [
      ['/learning_status', '/learning_history'],
      ['/kelly', '/kelly_surface'],
      ['/regime_coverage', '/ledger'],
      ['/counterfactual', '/risk'],
      ['/circuits', '/reset_circuits', '/ai_status'],
    ],
  },
  '/control': {
    title: '🛑 엔진 제어',
    description:
      '소프트/하드 정지·재개·무결성·토큰·강제 스캔 제어판입니다.',
    rows: [
      ['/pause', '/resume'],
      ['/stop', '/reset'],
      ['/integrity', '/refresh_token'],
      ['/scan', '/krx_scan', '/reconnect_ws'],
    ],
  },
  '/admin': {
    title: '🔧 진단·관리',
    description:
      '시장 리포트·채널 점검·다이제스트 등 일상 운영용 명령어 모음입니다.',
    rows: [
      ['/health', '/regime', '/market'],
      ['/scheduler', '/report', '/shadow'],
      ['/dxy', '/todaylog'],
      ['/channel_health', '/channel_stats'],
      ['/alert_history', '/alert_replay'],
      ['/digest_on', '/digest_off', '/digest_status'],
      ['/news_lag', '/buy', '/stage1_audit'],
      ['/channel_test'],
    ],
  },
};

// ── 인라인 키보드 빌더 ───────────────────────────────────────────────────────

function buttonsExceedRowCap(rows: string[][]): boolean {
  return rows.some((r) => r.length > MAX_BUTTONS_PER_ROW);
}

/**
 * 메타 명령어 spec → Telegram InlineKeyboardMarkup 으로 변환.
 *
 * - callback_data = `meta:<targetCmd>:<nonce>` (nonce 로 5분 후 stale 식별 가능)
 * - 행당 버튼 수가 MAX_BUTTONS_PER_ROW 를 초과하면 빌드 실패 (테스트로 차단)
 */
export function buildMetaInlineKeyboard(
  spec: MetaCommandSpec,
  nonce: string,
): InlineKeyboardMarkup {
  if (buttonsExceedRowCap(spec.rows)) {
    throw new Error(
      `Inline keyboard row exceeds ${MAX_BUTTONS_PER_ROW} buttons (mobile UX cap)`,
    );
  }
  return {
    inline_keyboard: spec.rows.map((row) =>
      row.map((cmd) => ({
        text: cmd,
        callback_data: encodeMetaCallback(cmd, nonce),
      })),
    ),
  };
}

/** callback_data 인코더 — webhookHandler 가 parseMetaCallback 으로 디코드. */
export function encodeMetaCallback(targetCmd: string, nonce: string): string {
  const cmd = targetCmd.replace(/^\//, '');
  return `meta:${cmd}:${nonce}`;
}

/**
 * callback_data 파서. webhookHandler 의 callback_query 라우터가 4번째 핸들러로
 * 호출한다. 본 함수는 부수효과 없고 매칭 실패 시 null 반환.
 */
export function parseMetaCallback(
  data: string,
): { targetCmd: string; nonce: string } | null {
  if (!data.startsWith('meta:')) return null;
  const parts = data.split(':');
  if (parts.length < 3) return null;
  const cmd = parts[1];
  const nonce = parts.slice(2).join(':');
  if (!/^[a-z0-9_]+$/.test(cmd)) return null;
  return { targetCmd: '/' + cmd, nonce };
}

// ── /now — 1줄 의사결정 합성 ─────────────────────────────────────────────────

/**
 * /now 응답 본문을 합성한다. KIS 호출 0건, 메모리 read-only.
 *
 * 우선순위 (위에서 아래로 평가, 첫 매칭이 최종 verdict):
 * 1. 비상정지 ON → 🔴 STOP
 * 2. 데이터 무결성 차단 → 🔴 BLOCK
 * 3. 소프트 일시정지 → 🟡 PAUSE
 * 4. R6_DEFENSE 레짐 → 🟡 HOLD
 * 5. 그 외 → 🟢 OK
 */
export function composeNowVerdict(now: Date = new Date()): string {
  const macro = loadMacroState();
  const regime = macro?.regime ?? 'N/A';
  const mhs = macro?.mhs;

  const shadows = getShadowTrades();
  const active = shadows.filter((s) => {
    const status = (s as { status?: string }).status;
    if (
      status !== 'PENDING' &&
      status !== 'ORDER_SUBMITTED' &&
      status !== 'PARTIALLY_FILLED' &&
      status !== 'ACTIVE' &&
      status !== 'EUPHORIA_PARTIAL'
    ) {
      return false;
    }
    return getRemainingQty(s) > 0;
  });

  const maxPositions = Number(process.env.MAX_CONVICTION_POSITIONS ?? '8');
  // signalScanner.getLastBuySignalAt() 는 미설정 시 0 반환 — 0 은 "신호 없음".
  const lastSignalAt = getLastBuySignalAt();
  const lastSignalLabel = lastSignalAt > 0
    ? formatKstHm(new Date(lastSignalAt))
    : '없음';

  let verdict: string;
  if (getEmergencyStop()) {
    verdict = '🔴 STOP — 비상정지 ON';
  } else if (getDataIntegrityBlocked()) {
    verdict = '🔴 BLOCK — 데이터 무결성 차단';
  } else if (getAutoTradePaused()) {
    verdict = '🟡 PAUSE — 소프트 일시정지';
  } else if (regime === 'R6_DEFENSE') {
    verdict = '🟡 HOLD — R6 방어 모드';
  } else {
    verdict = '🟢 OK';
  }

  const mhsLabel = typeof mhs === 'number' ? mhs.toFixed(0) : 'N/A';

  void now; // 본 시그니처는 테스트 결정성을 위한 옵션. 실제 macro/shadow 는 자체 시각.
  return (
    `${verdict}\n` +
    `레짐: ${regime} (MHS ${mhsLabel}) | ` +
    `활성 ${active.length}/${maxPositions} | ` +
    `마지막 신호 ${lastSignalLabel}`
  );
}

function formatKstHm(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours().toString().padStart(2, '0');
  const mm = kst.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm} KST`;
}

// ── 메타 명령어 실행 (webhookHandler.ts case 위임 대상) ──────────────────────

/**
 * 메타 명령어 실행 진입점. webhookHandler.ts 의 case 가 한 줄로 위임한다.
 *
 * @param name `/watch` `/positions` `/learning` `/control` `/admin` `/now` 중 하나
 * @param reply webhookHandler 의 sendTelegramAlert 래퍼
 */
export async function handleMetaCommand(
  name: string,
  reply: MetaReplyFn,
): Promise<void> {
  if (name === '/now') {
    await reply(`⚡ <b>[NOW]</b>\n${composeNowVerdict()}`, buildNowKeyboard());
    return;
  }

  const spec = META_COMMAND_REGISTRY[name];
  if (!spec) {
    await reply(`❓ 알 수 없는 메타 명령: ${name}`);
    return;
  }

  const nonce = newNonce();
  const body =
    `<b>${spec.title}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${spec.description}\n` +
    `\n<i>아래 버튼을 탭하면 해당 명령이 실행됩니다.</i>`;
  await reply(body, buildMetaInlineKeyboard(spec, nonce));
}

/** /now 응답에 첨부되는 단축 키보드 (status / positions / control 진입). */
export function buildNowKeyboard(nonce: string = newNonce()): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '/status', callback_data: encodeMetaCallback('/status', nonce) },
        { text: '/positions', callback_data: encodeMetaCallback('/positions', nonce) },
        { text: '/control', callback_data: encodeMetaCallback('/control', nonce) },
      ],
    ],
  };
}

function newNonce(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── /help 본문 (메타 우선 안내 + 개인화 Top 5) ─────────────────────────────

/** ADR-0017 §Stage 3 — /help 첫 줄 개인 Top 5 표시용 입력 포맷. */
export interface HelpTopEntry {
  name: string;
  count: number;
}

/**
 * 신규 사용자에게 메타 메뉴를 우선 노출하고 파워유저용 alias 51개는 접힘 안내로
 * 처리한 /help 본문을 반환한다.
 *
 * @param topUsage 옵셔널 — commandUsageRepo.getTopUsage(5) 결과를 그대로 전달하면
 *                 "📊 자주 쓰는 명령 Top 5" 섹션이 메타 메뉴 위에 노출된다.
 *                 빈 배열 / undefined 면 미노출.
 */
export function buildHelpMessage(topUsage?: HelpTopEntry[]): string {
  const topSection =
    topUsage && topUsage.length > 0
      ? `<b>📊 자주 쓰는 명령 Top ${Math.min(topUsage.length, 5)}</b>\n` +
        topUsage
          .slice(0, 5)
          .map((t, i) => `  ${i + 1}. ${t.name} — ${t.count}회`)
          .join('\n') +
        `\n\n`
      : '';
  return (
    `🤖 <b>QuantMaster Pro 봇</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    topSection +
    `<b>📌 자주 쓰는 메뉴 (8개)</b>\n` +
    `  /status — 시스템 현황 요약\n` +
    `  /now — "지금 매수해도 되나?" 1줄 판단\n` +
    `  /watch — 워치리스트 통합 메뉴\n` +
    `  /positions — 포지션·손익·미체결 통합\n` +
    `  /learning — 학습·Kelly·서킷·리스크 통합\n` +
    `  /control — pause/resume/stop/reset 제어판\n` +
    `  /admin — 진단·관리 (숨김 메뉴)\n` +
    `  /help — 이 도움말 다시 보기\n` +
    `\n` +
    `<i>각 메타 메뉴는 인라인 버튼으로 하위 명령어를 펼쳐줍니다.</i>\n` +
    `<i>기존 51개 명령어 (/watchlist /pos /pause 등) 도 직접 입력 가능합니다.</i>\n` +
    `\n` +
    `⏰ <b>자동 레포트</b>\n` +
    `  08:30 — 장전 시장 브리핑\n` +
    `  12:00 — 장중 시장 현황\n` +
    `  15:35 — 장마감 시장 요약\n` +
    `\n` +
    `<i>ADR-0017 Stage 1+2+3 — 메뉴 압축 + 모듈 분해 + 사용량 텔레메트리 적용 중.</i>`
  );
}

// ── setMyCommands 자동 동기화 (drift 차단) ───────────────────────────────────

/** Telegram setMyCommands payload 한 항목. command 는 슬래시 없이 lowercase. */
export interface BotMenuCommand {
  command: string;     // ≤ 32자, lowercase / 숫자 / _
  description: string; // ≤ 256자
}

/**
 * 메뉴에 고정 노출되는 일반 명령어. 메타가 아닌 단일 책임 명령 (/help /status /now).
 * /now 는 META_COMMAND_REGISTRY 에 없는 별도 메타지만 메뉴에는 노출 (composeNowVerdict 진입점).
 */
const FIXED_BOT_MENU_PRELUDE: readonly BotMenuCommand[] = [
  { command: 'help',   description: '도움말 — 자주 쓰는 8개 메뉴 안내' },
  { command: 'status', description: '시스템 현황 요약 (모드/MHS/포지션/오늘 결산)' },
  { command: 'now',    description: '"지금 매수해도 되나?" 1줄 의사결정 + 단축 메뉴' },
];

/**
 * 메타 명령어별 메뉴 description SSOT. META_COMMAND_REGISTRY 의 spec.title 은
 * 모바일 화면 헤더용이라 "👀 워치리스트" 처럼 이모지를 포함 — Telegram 메뉴는
 * 이모지를 description 에 두면 가독성↓ 이라 별도 짧은 텍스트로 분리.
 *
 * **drift 차단**: 본 매핑의 키와 META_COMMAND_REGISTRY 키가 일치해야 한다.
 * `buildBotMenuCommands()` 호출 시 자동 검증 (누락 키는 throw).
 */
const META_MENU_DESCRIPTIONS: Record<string, string> = {
  '/watch':     '워치리스트 통합 메뉴 (조회/Focus/추가/제거)',
  '/positions': '포지션·손익·미체결·매도/취소·reconcile 통합',
  '/learning':  '학습·Kelly·서킷·리스크·AI 상태 통합',
  '/control':   'pause/resume/stop/reset/integrity 제어판',
  '/admin':     '진단·관리 (시장 리포트/채널/다이제스트/...)',
};

/**
 * Telegram `setMyCommands` 호출에 사용할 메뉴 페이로드를 자동 생성한다.
 *
 * SSOT: META_COMMAND_REGISTRY 키 + FIXED_BOT_MENU_PRELUDE.
 * 새 메타 메뉴 추가 시 META_COMMAND_REGISTRY 와 META_MENU_DESCRIPTIONS 양쪽에
 * 항목을 추가해야 한다 (drift 차단 가드 — 본 함수가 검증).
 *
 * Telegram 제약 검증:
 *   - command ≤ 32자, `/^[a-z0-9_]+$/` 매치
 *   - description ≤ 256자
 *   - description 비어있지 않음
 *
 * @throws META_COMMAND_REGISTRY 키와 META_MENU_DESCRIPTIONS 키 불일치 시
 *         또는 Telegram 제약 위반 시.
 */
export function buildBotMenuCommands(): BotMenuCommand[] {
  // ── drift 가드: META_COMMAND_REGISTRY ↔ META_MENU_DESCRIPTIONS ──
  const metaKeys = Object.keys(META_COMMAND_REGISTRY).sort();
  const descKeys = Object.keys(META_MENU_DESCRIPTIONS).sort();
  if (metaKeys.length !== descKeys.length || metaKeys.some((k, i) => k !== descKeys[i])) {
    const missing = metaKeys.filter((k) => !descKeys.includes(k));
    const extra = descKeys.filter((k) => !metaKeys.includes(k));
    throw new Error(
      `[buildBotMenuCommands] META_MENU_DESCRIPTIONS drift — ` +
      `missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
    );
  }

  const entries: BotMenuCommand[] = [
    ...FIXED_BOT_MENU_PRELUDE,
    ...metaKeys.map((name) => ({
      command: name.replace(/^\//, ''),
      description: META_MENU_DESCRIPTIONS[name],
    })),
  ];

  // ── Telegram 제약 검증 ──
  for (const e of entries) {
    if (!/^[a-z0-9_]{1,32}$/.test(e.command)) {
      throw new Error(`[buildBotMenuCommands] invalid command "${e.command}" — must match /^[a-z0-9_]{1,32}$/`);
    }
    if (e.description.length === 0 || e.description.length > 256) {
      throw new Error(`[buildBotMenuCommands] invalid description for /${e.command} — length ${e.description.length}`);
    }
  }

  return entries;
}
