/**
 * @responsibility UI_LANG SSOT 게이트키퍼 훅 — 컴포넌트가 한 줄 패턴으로 SSOT 진입.
 *
 * 사용:
 *   const t = useUILang();
 *   <span>{t.nav('DISCOVER')}</span>
 *   <span>{t.tier('VERIFIED')}</span>
 *   <span>{t.regime('R6_DEFENSE')}</span>
 *
 * 직접 SSOT 접근은 `t.raw` 사용 (배열 매핑 / Object.entries 등 케이스).
 *
 * 향후 KO/EN 토글 / A/B 테스트 / 사용자별 라벨 커스터마이징은 본 훅 내부만 수정 →
 * 50+ 컴포넌트 무수정. (예: useSettingsStore.uiLocale 추가 후 분기)
 *
 * 관련 ADR: 0094 (Phase A 게이트키퍼)
 */

import { useMemo } from 'react';
import { UI_LANG, type UILangKeys } from '../config/uiLanguage';

export interface UILang {
  /** 사이드바 / 탭 / 페이지 라벨 */
  nav: (k: keyof UILangKeys['nav']) => string;
  /** 종목 카드 / 추천 카드 라벨 */
  card: (k: keyof UILangKeys['card']) => string;
  /** 데이터 품질 5-tier 라벨 */
  tier: (k: keyof UILangKeys['tier']) => string;
  /** 6 RegimeLevel (R1~R6) 라벨 */
  regime: (k: keyof UILangKeys['regime']) => string;
  /** 4단계 Gate (0/1/2/3) 라벨 */
  gate: (k: keyof UILangKeys['gate']) => string;
  /** 빈 상태 메시지 (4 sub-variant) */
  empty: (k: keyof UILangKeys['empty']) => string;
  /** 버튼 / 액션 라벨 */
  action: (k: keyof UILangKeys['action']) => string;
  /** 직접 SSOT 접근 (배열 매핑 / Object.entries 등 케이스) */
  raw: typeof UI_LANG;
}

export function useUILang(): UILang {
  return useMemo(
    () => ({
      nav: (k) => UI_LANG.nav[k],
      card: (k) => UI_LANG.card[k],
      tier: (k) => UI_LANG.tier[k],
      regime: (k) => UI_LANG.regime[k],
      gate: (k) => UI_LANG.gate[k],
      empty: (k) => UI_LANG.empty[k],
      action: (k) => UI_LANG.action[k],
      raw: UI_LANG,
    }),
    [],
  );
}
