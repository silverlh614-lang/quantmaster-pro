// @responsibility metaCommands 텔레그램 모듈
// @responsibility: Telegram 메타 명령어 (/now /watch /positions /learning /control /admin) 핸들러,
// 인라인 키보드 빌더, callback 파서, Telegram 메뉴 생성 SSOT.

import { getRemainingQty } from '../persistence/shadowTradeRepo.js';
import { getShadowTrades } from '../orchestrator/tradingOrchestrator.js';
import { getLastBuySignalAt, getLastScanSummary } from '../trading/signalScanner.js';
import type { ShadowActivitySnapshot } from '../trading/marketStateResolver.js';
import { resolveRegimeSnapshot } from '../trading/regime/regimeResolver.js';
import {
  formatRegimeTelegramNow,
  normalizeNowRenderOptions,
  NOW_COMPACT_RENDER_OPTIONS,
  NOW_DEBUG_RENDER_OPTIONS,
  type NowRenderOptions,
  type NowRenderOptionsInput,
} from '../trading/regime/regimeTelegramPresenter.js';
import { commandRegistry } from './commandRegistry.js';

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export type MetaReplyFn = (
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
) => Promise<void>;

export interface MetaCommandOptions {
  nowRenderOptions?: NowRenderOptionsInput;
}

interface MetaCommandSpec {
  title: string;
  description: string;
  rows: string[][];
}

const MAX_BUTTONS_PER_ROW = 3;

const META_BUTTON_LABELS: Record<string, string> = {
  '/pos_shadow': 'Shadow 포지션',
  '/pos_live': 'Live 포지션',
  '/pos_all': '전체 포지션',
  '/pnl_shadow': '가상 손익',
  '/pnl_live': '실계좌 손익',
};

function metaButtonText(command: string): string {
  return META_BUTTON_LABELS[command] ?? command;
}

export const META_COMMAND_REGISTRY: Record<string, MetaCommandSpec> = {
  '/watch': {
    title: '👀 워치리스트',
    description: '워치리스트 조회·편집 및 Track B 매수 대상 상세를 한 화면에서 처리합니다.',
    rows: [
      ['/watchlist', '/focus'],
      ['/add', '/remove'],
      ['/watchlist_channel'],
    ],
  },
  '/positions': {
    title: '📊 포지션·주문',
    description: '보유·실시간 손익·미체결·수동 매도/취소·장부 reconcile 통합 메뉴입니다.',
    rows: [
      ['/pos_shadow', '/pos_live', '/pos_all'],
      ['/pnl_shadow', '/pnl_live'],
      ['/pending', '/cancel'],
      ['/sell', '/adjust_qty', '/reconcile'],
    ],
  },
  '/learning': {
    title: '🧠 학습·리스크',
    description: '자기학습 이력·포지션 정책·서킷·리스크 예산을 모두 모았습니다.',
    rows: [
      ['/learning_status', '/learning_history'],
      ['/kelly', '/kelly_surface'],
      ['/regime_coverage', '/ledger'],
      ['/counterfactual', '/risk'],
      ['/circuits', '/reset_circuits', '/ai_status'],
      ['/weight_feedback', '/learning_weights_reset'],
    ],
  },
  '/control': {
    title: '🛑 엔진 제어',
    description: '소프트/하드 정지·재개·무결성·토큰·강제 스캔 제어판입니다.',
    rows: [
      ['/pause', '/resume'],
      ['/stop', '/reset'],
      ['/integrity', '/refresh_token'],
      ['/scan', '/krx_scan', '/reconnect_ws'],
    ],
  },
  '/admin': {
    title: '🔧 진단·관리',
    description: '시장 리포트·채널 점검·다이제스트 등 일상 운영용 명령어 모음입니다.',
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

function buttonsExceedRowCap(rows: string[][]): boolean {
  return rows.some((r) => r.length > MAX_BUTTONS_PER_ROW);
}

export function buildMetaInlineKeyboard(
  spec: MetaCommandSpec,
  nonce: string,
): InlineKeyboardMarkup {
  if (buttonsExceedRowCap(spec.rows)) {
    throw new Error(`Inline keyboard row exceeds ${MAX_BUTTONS_PER_ROW} buttons (mobile UX cap)`);
  }
  return {
    inline_keyboard: spec.rows.map((row) =>
      row.map((cmd) => ({
        text: metaButtonText(cmd),
        callback_data: encodeMetaCallback(cmd, nonce),
      })),
    ),
  };
}

export function encodeMetaCallback(targetCmd: string, nonce: string): string {
  const cmd = targetCmd.replace(/^\//, '');
  return `meta:${cmd}:${nonce}`;
}

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


function isOpenShadowStatus(status: unknown): boolean {
  return status === 'PENDING' || status === 'ORDER_SUBMITTED' || status === 'PARTIALLY_FILLED' || status === 'ACTIVE' || status === 'EUPHORIA_PARTIAL';
}

function toKstHmFromIsoOrLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return formatKstHm(new Date(parsed));
  return value;
}

function buildShadowActivitySnapshot(shadows: ReturnType<typeof getShadowTrades>, now: Date, macroFreshness?: string): ShadowActivitySnapshot {
  const summary = getLastScanSummary();
  const today = now.toISOString().slice(0, 10);
  const openShadowPositions = shadows.filter((trade) => isOpenShadowStatus((trade as { status?: string }).status) && getRemainingQty(trade) > 0).length;
  const lastShadowSignalAt = shadows
    .map((trade) => Date.parse(String((trade as { signalTime?: string }).signalTime ?? '')))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const paperFillCount = shadows.filter((trade) => {
    const record = trade as { status?: string; entryTime?: string; signalTime?: string };
    const at = record.entryTime ?? record.signalTime ?? '';
    return isOpenShadowStatus(record.status) && at.startsWith(today);
  }).length;
  const macroHardStale = macroFreshness === 'HARD_STALE' || macroFreshness === 'MISSING';
  const lastBlockReason = macroHardStale
    ? `MACRO_STATE_${macroFreshness}`
    : summary?.macroGateState?.sellOnlyMode
      ? 'SELL_ONLY'
      : summary?.emptyScanReason ?? undefined;
  const candidateScanStatus = macroHardStale
    ? 'SKIPPED'
    : summary?.time
      ? 'RAN'
      : 'NOT_RUN';

  return {
    scanAllowed: true,
    lastScanAt: macroHardStale ? undefined : toKstHmFromIsoOrLabel(summary?.time),
    evaluatedCount: macroHardStale ? 0 : summary?.candidates ?? 0,
    candidateCount: macroHardStale ? 0 : summary?.candidates ?? 0,
    buySignalCount: macroHardStale ? 0 : summary?.entries ?? 0,
    sellCheckCount: openShadowPositions,
    paperFillCount,
    openShadowPositions,
    lastShadowSignalAt: Number.isFinite(lastShadowSignalAt) ? formatKstHm(new Date(lastShadowSignalAt)) : undefined,
    lastBlockReason,
    candidateScanStatus,
    candidateScanTrigger: summary?.candidateScanTrigger ?? (summary?.time ? 'SCHEDULED' : undefined),
    candidateSkipReason: (macroHardStale || (summary?.candidates ?? 0) === 0) ? lastBlockReason : undefined,
    accumulatingCandidates: summary?.r6ShadowEntryPolicy?.accumulatingCandidates,
    r6CounterfactualEntries: summary?.r6ShadowEntryPolicy?.r6CounterfactualEntries,
    noShadowEntryReason: summary?.r6ShadowEntryPolicy?.noShadowEntryReason,
  };
}

const NOW_DEBUG_EMPTY_PAYLOAD_MESSAGE =
  '⚠️ NOW DEBUG render failed: empty payload. Snapshot resolver returned no content.';

export function ensureNowReplyPayload(text: string | null | undefined, options: NowRenderOptions): string {
  if (typeof text === 'string' && text.trim().length > 0) return text;
  if (options.mode === 'DEBUG') {
    console.error(`[TELEGRAM_NOW_DEBUG_EMPTY_PAYLOAD] mode=${options.mode}`);
    return NOW_DEBUG_EMPTY_PAYLOAD_MESSAGE;
  }
  console.error(`[TELEGRAM_NOW_EMPTY_PAYLOAD] mode=${options.mode}`);
  return '⚠️ NOW render failed: empty payload. Snapshot resolver returned no content.';
}

export function composeNowVerdict(now: Date = new Date(), options: NowRenderOptionsInput = NOW_COMPACT_RENDER_OPTIONS): string {
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
  const lastSignalAt = getLastBuySignalAt();
  const lastSignalLabel = lastSignalAt > 0
    ? formatKstHm(new Date(lastSignalAt))
    : '없음';
  const snapshot = resolveRegimeSnapshot({ now });
  const renderOptions = normalizeNowRenderOptions(options);

  console.info(
    '[TELEGRAM_RENDER_MARKET_STATE] ' +
    `snapshotId=${snapshot.snapshotId} ` +
    'template=NOW ' +
    `displayRegime=${snapshot.displayRegime} ` +
    `effectiveRegime=${snapshot.effectiveRegime} ` +
    `riskOverride=${snapshot.riskOverride}`,
  );
  console.info(`[TELEGRAM_NOW_RENDERED] mode=${renderOptions.mode} snapshotId=${snapshot.snapshotId}`);

  return formatRegimeTelegramNow(snapshot, {
    activePositions: active.length,
    maxPositions,
    lastSignalLabel,
    shadowActivity: buildShadowActivitySnapshot(shadows, now, snapshot.marketState.macroState.freshness),
  }, renderOptions);
}

function formatKstHm(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours().toString().padStart(2, '0');
  const mm = kst.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm} KST`;
}

export async function handleMetaCommand(
  name: string,
  reply: MetaReplyFn,
  options: MetaCommandOptions = {},
): Promise<void> {
  if (name === '/now' || name === '/now_debug') {
    const renderOptions = name === '/now_debug'
      ? NOW_DEBUG_RENDER_OPTIONS
      : normalizeNowRenderOptions(options.nowRenderOptions ?? NOW_COMPACT_RENDER_OPTIONS);
    const text = composeNowVerdict(new Date(), renderOptions);
    await reply(ensureNowReplyPayload(text, renderOptions), buildNowKeyboard());
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

export interface HelpTopEntry {
  name: string;
  count: number;
}

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
    `<b>📌 자주 쓰는 메뉴 (9개)</b>\n` +
    `  /status — 시스템 현황 요약\n` +
    `  /now — "지금 매수해도 되나?" 1줄 판단\n` +
    `  /now_debug — NOW raw detail\n` +
    `  /watch — 워치리스트 통합 메뉴\n` +
    `  /positions — 포지션·손익·미체결 통합\n` +
    `  /learning — 학습·포지션 정책·서킷·리스크 통합\n` +
    `  /control — pause/resume/stop/reset 제어판\n` +
    `  /admin — 진단·관리 (숨김 메뉴)\n` +
    `  /help — 이 도움말 다시 보기\n` +
    `\n` +
    `<i>각 메타 메뉴는 인라인 버튼으로 하위 명령어를 펼쳐줍니다.</i>\n` +
    `<i>기존 51개 명령어 (/watchlist /pos /pause 등) 도 직접 입력 가능합니다.</i>\n` +
    `\n` +
    `⏰ <b>자동 리포트</b>\n` +
    `  08:30 — 장전 시장 브리핑\n` +
    `  12:00 — 장중 시장 현황\n` +
    `  15:35 — 장마감 시장 요약\n` +
    `\n` +
    `<i>ADR-0017 Stage 1+2+3 — 메뉴 압축 + 모듈 분해 + 사용량 텔레메트리 적용 중.</i>`
  );
}

export function buildHelpKeyboard(nonce: string = newNonce()): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📊 포지션', callback_data: 'BTN_POSITION' },
        { text: '📈 손익', callback_data: 'BTN_PNL' },
      ],
      [
        { text: '/now', callback_data: encodeMetaCallback('/now', nonce) },
        { text: '/watch', callback_data: encodeMetaCallback('/watch', nonce) },
      ],
      [
        { text: '/control', callback_data: encodeMetaCallback('/control', nonce) },
        { text: '/admin', callback_data: encodeMetaCallback('/admin', nonce) },
      ],
    ],
  };
}

export function buildAdminHelpMessage(topUsage: HelpTopEntry[] = []): string {
  const topSection = topUsage.length > 0
    ? `<b>📊 자주 쓰는 명령 Top ${Math.min(topUsage.length, 5)}</b>\n` +
      topUsage
        .slice(0, 5)
        .map((t, i) => `  ${i + 1}. ${t.name} — ${t.count}회`)
        .join('\n') +
      `\n\n`
    : '<b>📊 자주 쓰는 명령 Top 5</b>\n  아직 집계된 사용량이 없습니다.\n\n';

  return (
    `🔧 <b>QuantMaster Pro 관리자 도움말</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    topSection +
    `<b>기존 주요 명령어</b>\n` +
    `  /pos, /positions — 포지션 조회\n` +
    `  /pnl — 손익 조회\n` +
    `  /status, /now, /watch, /scan, /scan_blockers — 운영 조회\n` +
    `\n` +
    `<b>diagnostic/debug command</b>\n` +
    `  /health, /market, /scheduler, /channel_stats, /alert_history\n` +
    `\n` +
    `<i>command usage stats 는 /admin_help 또는 /admin_stats 에서만 표시됩니다.</i>`
  );
}

export interface BotMenuCommand {
  command: string;
  description: string;
}

const FIXED_BOT_MENU_PRELUDE: readonly BotMenuCommand[] = [
  { command: 'help', description: '도움말 — 자주 쓰는 8개 메뉴 안내' },
  { command: 'status', description: '시스템 현황 요약 (모드/MHS/포지션/오늘 결산)' },
  { command: 'now', description: '"지금 매수해도 되나?" 1줄 의사결정 + 단축 메뉴' },
];

const META_MENU_DESCRIPTIONS: Record<string, string> = {
  '/watch': '워치리스트 통합 메뉴 (조회/Focus/추가/제거)',
  '/positions': '포지션·손익·미체결·매도/취소·reconcile 통합',
  '/learning': '학습·포지션 정책·서킷·리스크·AI 상태 통합',
  '/control': 'pause/resume/stop/reset/integrity 제어판',
  '/admin': '진단·관리 (시장 리포트/채널/다이제스트/...)',
};

export function buildBotMenuCommands(): BotMenuCommand[] {
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

const TELEGRAM_MAX_COMMANDS = 100;
export const TELEGRAM_MENU_SOFT_CAP = 90;

const MENU_ALWAYS_INCLUDE = new Set([
  'ai_status',
  'buy',
  'cancel',
  'circuits',
  'cron_status',
  'ghost_inspect',
  'governance',
  'health',
  'health_loop',
  'fresh_data_status',
  'exec',
  'gate',
  'learning_pulse',
  'learning_status',
  'learning',
  'learning_weights_reset',
  'market',
  'pending',
  'pnl',
  'pos',
  'program_market',
  'program_today',
  'regime',
  'report',
  'scan',
  'scan_blockers',
  'scan_blockers_gate0',
  'scan_blockers_gate1',
  'scan_blockers_gate2',
  'scan_blockers_gate3',
  'scheduler',
  'sell',
  'shadow',
  'signal_status',
  'status',
  'strategy',
  'supply_health',
  'watchlist',
  'weight_feedback',
]);

const MENU_LOW_VALUE_PATTERNS = [
  /(?:^|_)backfill(?:_|$)/,
  /(?:^|_)bulk(?:_|$)/,
  /(?:^|_)clear(?:_|$)/,
  /(?:^|_)debug(?:_|$)/,
  /(?:^|_)diag(?:_|$)/,
  /(?:^|_)force(?:_|$)/,
  /(?:^|_)probe(?:_|$)/,
  /(?:^|_)raw(?:_|$)/,
  /(?:^|_)seed(?:_|$)/,
  /(?:^|_)template(?:_|$)/,
] as const;

function inferMenuPriority(command: string, category: string, riskLevel: number): number {
  if (MENU_ALWAYS_INCLUDE.has(command)) return 0;
  const categoryBase: Record<string, number> = {
    TRD: 100,
    POS: 140,
    WL: 180,
    SYS: 220,
    MKT: 260,
    LRN: 320,
    ALR: 420,
    EMR: 520,
  };
  const lowValuePenalty = MENU_LOW_VALUE_PATTERNS.some((pattern) => pattern.test(command)) ? 600 : 0;
  const riskPenalty = riskLevel >= 2 ? 40 : riskLevel >= 1 ? 20 : 0;
  return (categoryBase[category] ?? 900) + lowValuePenalty + riskPenalty;
}

export function buildBotMenuCommandsExtended(): BotMenuCommand[] {
  const base = buildBotMenuCommands();
  const seen = new Set(base.map((e) => e.command));
  const categoryOrder: Record<string, number> = {
    SYS: 0,
    MKT: 1,
    WL: 2,
    POS: 3,
    TRD: 4,
    LRN: 5,
    ALR: 6,
    EMR: 7,
  };

  const registryEntries = commandRegistry
    .all()
    .filter((cmd) => cmd.showInMenu !== false)
    .map((cmd) => {
      const command = cmd.name.replace(/^\//, '').toLowerCase();
      if (!/^[a-z0-9_]{1,32}$/.test(command)) return null;
      const desc = (cmd.description ?? '').slice(0, 256).trim();
      const description = desc.length > 0 ? desc : `[${cmd.category}] 명령`;
      const menuPriority = cmd.menuPriority ?? inferMenuPriority(command, cmd.category, cmd.riskLevel);
      return {
        command,
        description,
        menuPriority,
        sortKey: (categoryOrder[cmd.category] ?? 99) * 1000,
      };
    })
    .filter((e): e is { command: string; description: string; menuPriority: number; sortKey: number } => e !== null)
    .filter((e) => !seen.has(e.command))
    .sort((a, b) => a.menuPriority - b.menuPriority || a.sortKey - b.sortKey || a.command.localeCompare(b.command))
    .map(({ command, description }) => ({ command, description }));

  const menuCap = Math.min(TELEGRAM_MENU_SOFT_CAP, TELEGRAM_MAX_COMMANDS);
  const registryLimit = Math.max(0, menuCap - base.length);
  const visibleRegistryEntries = registryEntries.slice(0, registryLimit);
  const merged: BotMenuCommand[] = [...base, ...visibleRegistryEntries];

  if (registryEntries.length > visibleRegistryEntries.length) {
    console.info(
      `[TELEGRAM_COMMAND_MENU_CAPPED] visible=${menuCap} ` +
      `hidden=${registryEntries.length - visibleRegistryEntries.length} ` +
      `availableViaHelp=true severity=INFO executionImpact=NONE`,
    );
  }

  return merged;
}
