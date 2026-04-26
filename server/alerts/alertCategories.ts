// @responsibility alertCategories 알림 카테고리 + 채널 시멘틱 별칭 SSOT
export enum AlertCategory {
  TRADE = 'TRADE',
  ANALYSIS = 'ANALYSIS',
  INFO = 'INFO',
  SYSTEM = 'SYSTEM',
}

/**
 * 채널 시멘틱 별칭 (ADR-0032 §1) — 사용자 의도 기반 명칭과 enum 값 매핑.
 * 신규 코드는 ChannelSemantic.EXECUTION/SIGNAL/REGIME/JOURNAL 사용 권장.
 *   CH1 EXECUTION = TRADE   (매매 절대 채널 — 체결/손절/비상정지)
 *   CH2 SIGNAL    = ANALYSIS (오늘 사냥감 — 워치리스트/픽)
 *   CH3 REGIME    = INFO    (매크로 사령탑 — 레짐/글로벌)
 *   CH4 JOURNAL   = SYSTEM  (메타 학습 — 성과/주간 리포트)
 */
export const ChannelSemantic = {
  EXECUTION: AlertCategory.TRADE,
  SIGNAL: AlertCategory.ANALYSIS,
  REGIME: AlertCategory.INFO,
  JOURNAL: AlertCategory.SYSTEM,
} as const;

export type ChannelSemanticName = keyof typeof ChannelSemantic;

export type AlertCategoryMap = Partial<Record<AlertCategory, string>>;

export function parseChannelMap(raw: string | undefined): AlertCategoryMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map: AlertCategoryMap = {};
    for (const category of Object.values(AlertCategory)) {
      const value = parsed[category];
      if (typeof value === 'string' && value.trim()) {
        map[category] = value.trim();
      }
    }
    return map;
  } catch {
    console.warn('[AlertRouter] CHANNEL_MAP parse failed. Expected JSON object.');
    return {};
  }
}

function parseBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return value === 'true';
}

export function isCategoryEnabled(category: AlertCategory): boolean {
  const specific = parseBooleanEnv(`${category}_CHANNEL_ENABLED`);
  if (specific !== undefined) return specific;
  return process.env.CHANNEL_ENABLED === 'true';
}
