// @responsibility Telegram position display tag taxonomy.

export type PositionModeTag =
  | 'LIVE'
  | 'SHADOW'
  | 'VIRTUAL'
  | 'PAPER';

export type PositionContextTag =
  | 'NORMAL'
  | 'R6_DEFENSE'
  | 'R6_COUNTERFACTUAL'
  | 'RECOVERY_WATCH'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY';

export type PriceSourceTag =
  | 'KIS_PRICE'
  | 'CACHE_PRICE'
  | 'STALE_PRICE'
  | 'MISSING_PRICE';

export type ExecutionTag =
  | 'LIVE_ORDER_SENT'
  | 'NO_LIVE_ORDER'
  | 'EXECUTION_IMPACT_NONE'
  | 'LIVE_POSITION';

export type PositionKind = 'LIVE' | 'SHADOW' | 'VIRTUAL' | 'PAPER';

export type AccountKind =
  | 'KIS_LIVE'
  | 'VIRTUAL_SHADOW'
  | 'PAPER_LEDGER';

export type PositionOrigin =
  | 'KIS_HOLDING'
  | 'SHADOW_POSITION_LEDGER'
  | 'SHADOW_TRADE_REPO'
  | 'PAPER_TRADE_LEDGER'
  | 'VIRTUAL_ACCOUNT';

export type PositionEngineMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';

export type NormalizedPositionPriceSource = 'KIS' | 'CACHE' | 'STALE' | 'MISSING';

export type PnlKind =
  | 'REALIZED_LIVE'
  | 'UNREALIZED_LIVE'
  | 'VIRTUAL_UNREALIZED'
  | 'VIRTUAL_REALIZED';

export type PositionExecutionImpact =
  | 'NONE'
  | 'LIVE_ORDER'
  | 'LIVE_POSITION'
  | 'NEW_BUY_BLOCKED_ONLY';

export interface DualPositionDisplayInfo {
  liveQty: number;
  shadowQty: number;
  warning: string;
}

export interface PositionDisplayTagInput {
  positionKind: PositionKind;
  accountKind: AccountKind;
  origin: PositionOrigin;
  engineMode: PositionEngineMode;
  effectiveRegime: string;
  entrySource?: string;
  liveOrderSent: boolean;
  executionImpact: PositionExecutionImpact;
  dualPosition?: DualPositionDisplayInfo;
}

export interface PositionDisplayTagTarget extends PositionDisplayTagInput {
  stockCode: string;
  qty: number;
  displayTags: string[];
  dualPosition?: DualPositionDisplayInfo;
}

export function normalizePositionContextTag(input: {
  effectiveRegime?: string;
  engineMode?: PositionEngineMode;
  entrySource?: string;
}): PositionContextTag {
  const entrySource = String(input.entrySource ?? '').toUpperCase();
  const regime = String(input.effectiveRegime ?? '').toUpperCase();

  if (entrySource.includes('R6_COUNTERFACTUAL') || regime.includes('R6_COUNTERFACTUAL')) {
    return 'R6_COUNTERFACTUAL';
  }
  if (regime.includes('R6_DEFENSE')) return 'R6_DEFENSE';
  if (regime.includes('RECOVERY_WATCH')) return 'RECOVERY_WATCH';
  if (input.engineMode === 'SELL_ONLY' || regime.includes('SELL_ONLY')) return 'SELL_ONLY';
  if (input.engineMode === 'SHADOW_ONLY' || regime.includes('SHADOW_ONLY')) return 'SHADOW_ONLY';
  return 'NORMAL';
}

function normalizeEffectiveRegimeDisplayTag(effectiveRegime?: string): string | null {
  const regime = String(effectiveRegime ?? '').trim().toUpperCase();
  if (!regime || regime === 'NORMAL') return null;
  const normalized = regime.replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized : null;
}

export function buildPositionDisplayTags(input: PositionDisplayTagInput): string[] {
  if (input.dualPosition) {
    return ['DUAL: LIVE+SHADOW'];
  }

  const tags: string[] = [input.positionKind];
  const effectiveRegimeTag = normalizeEffectiveRegimeDisplayTag(input.effectiveRegime);
  if (effectiveRegimeTag) tags.push(effectiveRegimeTag);
  const context = normalizePositionContextTag(input);
  if (context !== 'NORMAL' && context !== effectiveRegimeTag) tags.push(context);

  if (input.liveOrderSent) {
    tags.push('실주문');
  } else {
    tags.push('실주문없음');
  }

  return Array.from(new Set(tags));
}

export function attachDualPositionDisplay<T extends PositionDisplayTagTarget>(positions: T[]): T[] {
  const byCode = new Map<string, { liveQty: number; shadowQty: number }>();

  for (const position of positions) {
    const bucket = byCode.get(position.stockCode) ?? { liveQty: 0, shadowQty: 0 };
    if (position.positionKind === 'LIVE') {
      bucket.liveQty += position.qty;
    } else if (position.positionKind === 'SHADOW' || position.positionKind === 'VIRTUAL' || position.positionKind === 'PAPER') {
      bucket.shadowQty += position.qty;
    }
    byCode.set(position.stockCode, bucket);
  }

  return positions.map((position) => {
    const bucket = byCode.get(position.stockCode);
    if (!bucket || bucket.liveQty <= 0 || bucket.shadowQty <= 0) {
      return {
        ...position,
        displayTags: buildPositionDisplayTags(position),
      };
    }

    const dualPosition: DualPositionDisplayInfo = {
      liveQty: bucket.liveQty,
      shadowQty: bucket.shadowQty,
      warning: '동일 종목이 실계좌와 Shadow에 모두 존재합니다.',
    };
    return {
      ...position,
      dualPosition,
      displayTags: buildPositionDisplayTags({ ...position, dualPosition }),
    };
  });
}

export function formatPositionTagHeader(tags: readonly string[]): string {
  return `[${tags.join(' · ')}]`;
}

export function toPriceSourceTag(source: NormalizedPositionPriceSource): PriceSourceTag {
  if (source === 'KIS') return 'KIS_PRICE';
  if (source === 'CACHE') return 'CACHE_PRICE';
  if (source === 'STALE') return 'STALE_PRICE';
  return 'MISSING_PRICE';
}

export function formatPriceSourceTag(source: NormalizedPositionPriceSource, ageSeconds?: number): string {
  const tag = toPriceSourceTag(source);
  if ((source === 'CACHE' || source === 'STALE') && typeof ageSeconds === 'number' && Number.isFinite(ageSeconds)) {
    return `${tag}, ${Math.max(0, Math.round(ageSeconds)).toLocaleString('ko-KR')}초 전`;
  }
  return tag;
}

export function stalePriceWarning(source: NormalizedPositionPriceSource): string | null {
  return source === 'STALE'
    ? '⚠ 현재가 지연 가능. 손익은 참고용입니다.'
    : null;
}

export function formatAccountKind(accountKind: AccountKind): string {
  if (accountKind === 'KIS_LIVE') return 'KIS Live';
  if (accountKind === 'PAPER_LEDGER') return 'Paper Ledger';
  return 'Virtual Shadow';
}

export function formatPnlKindLabel(pnlKind: PnlKind): string {
  if (pnlKind === 'REALIZED_LIVE' || pnlKind === 'UNREALIZED_LIVE') return '실손익';
  return '가상손익';
}

export function formatShadowBuyAlertTitle(entrySource?: string): string {
  if (String(entrySource ?? '').toUpperCase().includes('R6_COUNTERFACTUAL')) {
    return '🧪 <b>[R6 Shadow 관찰매수]</b>';
  }
  return '🧪 <b>[SHADOW 가상매수]</b>';
}

export function formatShadowBuyExecutionNotice(entrySource?: string): string {
  if (String(entrySource ?? '').toUpperCase().includes('R6_COUNTERFACTUAL')) {
    return 'R6_DEFENSE 상태의 반사실 학습용 가상매수\n실주문 아님 / liveOrderSent=false / executionImpact=NONE / sizingSource=LIVE_SIZING_MIRROR';
  }
  return '실주문 아님 / liveOrderSent=false / executionImpact=NONE / sizingSource=LIVE_SIZING_MIRROR';
}

export function formatLiveBuyExecutionNotice(): string {
  return 'KIS 실주문 / liveOrderSent=true / executionImpact=LIVE_ORDER';
}
