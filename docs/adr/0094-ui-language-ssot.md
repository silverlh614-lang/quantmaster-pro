# ADR-0094 — UI Language SSOT + useUILang 훅 게이트키퍼

**상태**: Accepted (PR-Z7 / Phase A)
**작성일**: 2026-04-29
**관련**: ADR-0028 (UI 재설계 P0 — DataQualityBadge 시리즈), ADR-0049 (AutoTradeContextualLayout)
**번호 충돌 회피**: 사용자 분석 원안은 "ADR-0029" 였으나 0029 가 이미 3개 사용 중
(condition-source-tier / counterfactual-twin / stockScreener-decomposition) — 시퀀셜 안전을
위해 0094 재할당.

## 배경

UI 카피 (라벨/메시지/배지/버튼 텍스트) 가 현재 50+ 컴포넌트에 직접 string literal
형태로 분산되어 있어 다음 문제가 누적:

1. **표현 불일치** — 같은 의미("강매수 후보" vs "강력 추천" vs "STRONG_BUY 후보") 가
   카드/페이지마다 다르게 표기 → 사용자 인지 부담 ↑
2. **금지 표현 회귀** — 페르소나 철학("Data-driven, no emotion") 위반 표현 ("완벽한 신호",
   "강력한 추천", "AI 가 분석한") 이 신규 PR 마다 재발 가능
3. **국제화 (KO/EN 토글) 차단** — 영문 사용자 / A/B 테스트 / 사용자별 라벨 커스터마이징
   불가능
4. **UI 재설계 PR 부담 ↑** — Phase B/C/D (DataQuality / V-E-R Card / ConfluenceMeter)
   가 "어떤 라벨을 사용할지" 마다 50+ 파일 grep + 수정

사용자 원안 분석 (12 아이디어 중 #1·#2·#11): "Phase A 강화 — 언어 SSOT 게이트키퍼"
— SSOT 가 있어도 컴포넌트마다 `import { UI_LANG } from '../config/uiLanguage'` 매번
쓰는 건 마찰이 큽니다. 마찰이 큰 SSOT 는 우회됩니다.

## 결정

3 단계 게이트키퍼 신설 (Phase A 단독 PR):

### Layer 1 — `src/config/uiLanguage.ts` (UI_LANG SSOT)

전체 UI 카피의 단일 출처. 카테고리별 분리:

```typescript
export const UI_LANG = {
  nav: {
    DISCOVER: '발견',
    AUTO_TRADE: '자동매매',
    POSITIONS: '보유 종목',
    // ...
  },
  card: {
    STRONG_BUY: '강매수 후보',
    BUY: '매수 후보',
    HOLD: '관망',
    // ...
  },
  tier: {
    VERIFIED: '실측',      // 결정적 가격/지표
    EXTERNAL: 'API 수신',  // KIS/DART/Yahoo
    DELAYED: '지연 데이터', // 시장 외/캐시
    ESTIMATED: 'AI 추정',   // Gemini 추론
    MANUAL: '수동 입력',    // 사용자 입력
  },
  regime: {
    R1_TURBO: '🔥 가속 강세',
    R2_BULL: '🟢 안정 강세',
    R3_EARLY: '🌱 초기 강세',
    R4_NEUTRAL: '🟠 중립',
    R5_CAUTION: '🟡 경계',
    R6_DEFENSE: '🛑 방어',
  },
  gate: {
    GATE_0: '시장 게이트',
    GATE_1: '필수 조건',
    GATE_2: '강화 조건',
    GATE_3: '확신 조건',
  },
  empty: {
    DELAYED: '데이터 동기화 중 — 잠시 후 표시됩니다',
    INSUFFICIENT: '표본 부족 — 거래 30건 누적 후 활성화',
    STALE: '시장 외 시간 — 다음 영업일 09:00 갱신',
    CONFLICTED: '신호 충돌 감지 — 검토 필요',
  },
  action: {
    APPROVE: '승인',
    REJECT: '거부',
    SKIP: '건너뜀',
    REFRESH: '새로고침',
  },
} as const;

export type UILangKeys = typeof UI_LANG;
```

**금지 표현 정책** (내부 주석 + check_ui_language.js 자동 차단):
- "완벽한", "강력한", "확실한" — 페르소나 철학 위반 (확률 사고)
- "AI 가 분석한", "AI 추천" — 출처 모호 (AI ESTIMATE 라벨 사용)
- "보장", "확실히" — 금융 표현 위험
- "최고의", "베스트" — 사용자 기대 인플레이션

### Layer 2 — `src/hooks/useUILang.ts` (게이트키퍼 훅)

```typescript
import { useMemo } from 'react';
import { UI_LANG, type UILangKeys } from '../config/uiLanguage';

export interface UILang {
  nav: (k: keyof UILangKeys['nav']) => string;
  card: (k: keyof UILangKeys['card']) => string;
  tier: (k: keyof UILangKeys['tier']) => string;
  regime: (k: keyof UILangKeys['regime']) => string;
  gate: (k: keyof UILangKeys['gate']) => string;
  empty: (k: keyof UILangKeys['empty']) => string;
  action: (k: keyof UILangKeys['action']) => string;
  /** 직접 SSOT 접근 (배열 매핑 등 케이스용) */
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
```

이 훅 도입으로 컴포넌트는 `const t = useUILang(); ... <span>{t.nav('DISCOVER')}</span>`
한 줄 패턴으로 진입. 향후 KO/EN 토글, A/B 테스트, 사용자별 라벨 커스터마이징은
**훅 내부만 수정** 하면 50+ 컴포넌트 무수정.

코드베이스의 `useDebugWatchers` / `useGlobalShortcuts` / `useMarketMode` 같은 hook-first
철학 정합.

### Layer 3 — `scripts/check_ui_language.js` (정적 검증 게이트)

`scripts/check_yahoo_range.js` 패턴 차용. `src/` 전수 검사 + 금지 표현 감지:

- **금지 표현 4 카테고리** (대분류):
  - 절대 표현 (`완벽한`/`강력한`/`확실한`/`보장`/`확실히`/`최고의`/`베스트`)
  - 출처 모호 (`AI 가 분석한`/`AI 추천`)
  - 감정 표현 (`놀라운`/`엄청난`/`대박`/`가장 좋은`)
  - 약속 표현 (`반드시`/`무조건`/`승률 100%`)
- 매칭은 **string literal 안에서만** (식별자/주석 제외)
- 화이트리스트: `src/config/uiLanguage.ts` (정책 정의 자기 자신) + `scripts/check_ui_language.js`
  + `*.test.ts` (회귀 테스트)
- ENV 무관 — 정적 검증 항상 실행
- `--changed` 모드 (precommit 용 — staged 신규 코드만 강제)

**정책 분리**:
- `validate:all` → **full 모드** (`node scripts/check_ui_language.js`) — 운영자 진단용,
  baseline 19건 위반 (기존 50+ 컴포넌트 한국어 라벨 부채) 표면화. CI/manual 진단으로 사용.
- `precommit` → **`--changed` 모드** (`node scripts/check_ui_language.js --changed`) —
  staged 파일 한정 강제. 신규 도입 차단 + 기존 부채는 후속 마이그레이션 PR 에서 점진 청소.

### Layer 4 — Phase A DoD 회귀 테스트 묶음 (#11 아이디어)

`src/__tests__/uiLanguagePhaseA-DoD.test.ts` 신설 — Phase A 가 *진짜로 끝났는지*
자동 확인:

1. UI_LANG SSOT 7 카테고리 모두 export
2. useUILang() 훅 contract (7 메서드 + raw)
3. 모든 카테고리 키가 비어있지 않은 string
4. tier 5-tier (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL) 정합
5. regime 6 RegimeLevel (R1~R6) 정합
6. gate 4 단계 (0~3) 정합
7. empty 4 sub-variant (#4 IDontKnow 의 사전 등록)
8. check_ui_language.js 베이스라인 통과 (위반 0건)
9. 금지 표현이 src/ 전체에 0건 (현재 베이스라인 확인)

이 DoD 가 green 이면 Phase A 종료 선언.

## 회귀 테스트

**3 파일 신설**:

1. `src/config/uiLanguage.test.ts` — UI_LANG SSOT 키 카운트 / 카테고리 정합 / 금지 표현
   본 SSOT 안 부재 검증 (메타) — 약 8 케이스
2. `src/hooks/useUILang.test.ts` — 훅 호출 / 7 메서드 / raw 접근 / 메서드 결과 일관성 —
   약 10 케이스
3. `scripts/check_ui_language.test.js` — `check_yahoo_range.test.js` 동일 패턴 — 베이스라인
   통과 / 금지 표현 4 카테고리 분기 / 화이트리스트 / 한 줄·블록 주석 무시 / `--changed`
   모드 — 약 15 케이스
4. `src/__tests__/uiLanguagePhaseA-DoD.test.ts` — Phase A 종료 선언 묶음 — 약 9 케이스

총 약 42 신규 케이스.

## 비결과 (out-of-scope)

본 PR 은 **Phase A 단독** — 이하 항목은 후속 PR 분리:

- **#3 DataQualityBadge 5-tier 자동 사다리** (Phase A 강화 후속) — `src/utils/dataQualityClassifier.ts`
  의 3-tier → 5-tier 격상은 ADR-0028 PR-A 후속 PR
- **#2 check_ui_language.js --discover 모드** — 신규 표현 자동 큐레이션은 후속 PR
  (운영 1~2주 누적 후 우선순위 결정)
- **#4 IDontKnow 4-variant 컴포넌트** — Phase B 별도 PR
- **#5 DataQualityRibbon** — Phase B 별도 PR
- **V-E-R Card / ConfluenceMeter** — Phase C/D 별도 PR
- **#12 Verbosity 토글** — 모든 Phase 완성 후 메타 PR
- **기존 컴포넌트 마이그레이션** — 본 PR 은 SSOT 도입만, 50+ 컴포넌트가 useUILang 으로
  점진 전환 (각 컴포넌트 PR 별도 — 회귀 위험 격리). check_ui_language.js 가 신규 코드만
  강제 (--changed 모드).

## 운영 효과

- **인지 부담 ↓**: 50+ 컴포넌트의 표현 일관성 → 사용자가 같은 의미를 같은 단어로 인지
- **금지 표현 회귀 영구 차단**: 신규 PR 에서 "완벽한 신호" 같은 표현 자동 fail
- **국제화 준비 완료**: KO 기본값 + 향후 EN 토글 시 useUILang() 훅만 수정
- **Phase B/C/D 부담 ↓**: 후속 UI PR 들이 라벨 결정으로 시간 낭비 안 함 — SSOT 추가만

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 인프라 + 검증 스크립트만 (절대 규칙 #2/#3/#4 미위반)
- **기존 컴포넌트 무수정** — 본 PR 은 SSOT 도입만, 컴포넌트 마이그레이션 후속 PR
- **KIS/KRX/Yahoo 호출 0건** — 정적 분석 + 클라이언트 훅 + 빌드 시 검증
- **회귀 가드** — Phase A DoD 9 케이스 + check_ui_language.js 정적 차단 (precommit)
- **롤백 안전** — 본 PR 의 신규 파일 4개 삭제 + package.json 1줄 revert 시 베이스라인
  복구 (마이그레이션 미발생)

## 후속 PR 후보

- **PR-Phase-A-2**: DataQualityBadge 3-tier → 5-tier 격상 (#3 자동 사다리)
- **PR-Phase-A-3**: check_ui_language.js --discover 모드 (#2 발견 모드)
- **PR-Phase-B**: IDontKnow 4-variant + DataQualityRibbon (#4, #5)
- **PR-Phase-C**: V-E-R Card + Stop-loss First + Time-band 띠 (#6, #7, #8)
- **PR-Phase-D**: ConfluenceMeter 4축 + 축 결손 사유 (#9, #10)
- **PR-Verbose**: useSettingsStore 의 uiVerbosity 토글 (#12)
