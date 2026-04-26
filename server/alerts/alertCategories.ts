// @responsibility alertCategories 알림 모듈
export enum AlertCategory {
  TRADE = 'TRADE',
  ANALYSIS = 'ANALYSIS',
  INFO = 'INFO',
  SYSTEM = 'SYSTEM',
}

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
