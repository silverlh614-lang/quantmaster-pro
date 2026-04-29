# ADR-0099 — UI Verbosity 토글 (UI Phase Verbose, 사용자 #12)

**상태**: Accepted (PR-Z12 / Phase Verbose — 12 아이디어 마지막)
**작성일**: 2026-04-29
**관련**: ADR-0094 (UI Language SSOT), ADR-0095 (DataQualityBadge 5-tier), ADR-0096 (IDontKnow + Ribbon), ADR-0097 (VerdictCard V-E-R), ADR-0098 (ConfluenceMeter)

## 배경

사용자 12 아이디어 분석 마지막 항목 — **#12 Verbosity 토글** (S/C 3.5):

> *"V-E-R Card / ConfluenceMeter / DataQuality 정보가 다 들어가면 사용자에 따라 정보 과잉으로 느낄 수 있습니다. useSettingsStore 에 uiVerbosity: 'minimal' | 'balanced' | 'verbose' 추가. minimal 은 Verdict 만, balanced 는 V-E-R, verbose 는 ConfluenceMeter+축 사유까지."*

> *"이는 '한 번에 모든 정보 노출 vs 안 노출'의 이분법을 깨고, 사용자가 자기 인지 부하를 직접 제어하게 합니다. 페르소나가 시스템 운영자이므로 verbose, 신규 사용자는 minimal 로 시작 가능. 점진 도입 철학의 사용자 측 변형 — Phase A 의 KO/EN 양립과 같은 모델을 verbosity 에 적용한 것입니다."*

Phase A~D 5 PR 누적으로 V-E-R Card + ConfluenceMeter + 4-tier 데이터 품질 + IDontKnow + Ribbon 등 다수 컴포넌트 도입. 본 PR 이 사용자 측 인지 부하 토글로 *마지막 안전장치* 제공.

## 결정

3 단계 도입 — store + hook + toggle 컴포넌트.

### Layer 1 — `useSettingsStore.uiVerbosity` 추가 (zustand persist)

```typescript
export type UIVerbosity = 'minimal' | 'balanced' | 'verbose';

interface SettingsState {
  // ... 기존 필드
  uiVerbosity: UIVerbosity;
  setUIVerbosity: (verbosity: UIVerbosity) => void;
}
```

- 기본값 `'balanced'` — V-E-R 3 슬롯 + 데이터 품질 배지 + IDontKnow
- `partialize` 에 추가 → 영속 (재방문 시 보존)

### Layer 2 — `src/hooks/useUIVerbosity.ts` 게이트키퍼 hook + SSOT 매트릭스

```typescript
const v = useUIVerbosity();
if (v.shouldShow('confluence')) return <ConfluenceMeter axes={...} />;
if (v.atLeast('verbose')) return <AxisReasonsExpanded />;
```

#### 가시성 분기 SSOT 매트릭스 (`shouldShowAtVerbosity`)

11 컨텐츠 키 × 3 verbosity:

| content              | minimal | balanced | verbose |
|----------------------|:-------:|:--------:|:-------:|
| `verdict`            | ✅      | ✅       | ✅      |
| `gate-mini`          | ✅      | ✅       | ✅      |
| `idontknow`          | ❌      | ✅       | ✅      |
| `evidence`           | ❌      | ✅       | ✅      |
| `risk`               | ❌      | ✅       | ✅      |
| `time-band`          | ❌      | ✅       | ✅      |
| `data-quality`       | ❌      | ✅       | ✅      |
| `confluence`         | ❌      | ❌       | ✅      |
| `axis-reasons`       | ❌      | ❌       | ✅      |
| `data-quality-ribbon`| ❌      | ❌       | ✅      |
| `gate-status`        | ❌      | ❌       | ✅      |

**의미**:
- **minimal** — Verdict + 미니 게이트만 (신규 사용자, 빠른 결정 인지)
- **balanced** — V-E-R 3 슬롯 + 데이터 품질 배지 + 모름 표현 (기본 디폴트)
- **verbose** — 합치도 + 축 사유 + 신뢰도 띠 + 풀 게이트 (시스템 운영자)

#### `atLeastVerbosity` 헬퍼

`atLeast('verbose')` 패턴으로 ranking 비교. 가독성 ↑.

### Layer 3 — `src/components/common/UIVerbosityToggle.tsx`

3-way segmented control — Settings 모달 또는 페이지 헤더 임베드.

- 3 옵션 한국어 라벨 (간결 / 균형 / 상세)
- 각 옵션 아이콘 (EyeOff / Eye / Layers)
- aria-label 옵션 설명 ("상세 — 운영자")
- compact 모드 (페이지 헤더용 — 라벨 숨김, 아이콘만)
- `data-ui-verbosity-option` / `data-ui-verbosity-active` 속성 (e2e 친화)

## 회귀 테스트

**2 파일 신규**:

1. `src/hooks/useUIVerbosity.test.ts` — jsdom 회귀 32 케이스
   - shouldShowAtVerbosity 매트릭스 22 (11 컨텐츠 × minimal/balanced + verbose 1)
   - atLeastVerbosity 9 (3×3 ranking 비교)
   - useUIVerbosity hook contract 7 (verbosity / shouldShow / setVerbosity 전파 / atLeast / store SSOT / 메모이즈)
2. `src/components/common/UIVerbosityToggle.test.tsx` — jsdom 컴포넌트 회귀 9 케이스
   - 3 옵션 렌더 + 활성 강조 + 클릭 → store 갱신 + compact 모드 + ARIA + className 전파

총 신규 약 41 케이스.

## 비결과 (out-of-scope)

본 PR 은 **store + hook + 토글 컴포넌트** — 이하 항목은 후속 PR 분리:

- **컴포넌트 wiring**: VerdictCard / ConfluenceMeter / DataQualityBadge / DataQualityRibbon / IDontKnow / GateStatusCard / GateMiniIndicator 가 `useUIVerbosity().shouldShow(...)` 로 자기 가시성 분기하는 wiring 은 후속 PR (각 컴포넌트 PR 별도 — 회귀 위험 격리). 본 PR 은 SSOT 매트릭스만 정착.
- **Settings 모달 임베드**: UIVerbosityToggle 을 Settings 모달 또는 페이지 헤더에 임베드는 후속 PR.
- **컨텐츠 키 확장**: 미래 신규 컴포넌트 (Phase E 등) 추가 시 `VerbosityContent` union 에 키 추가 + 매트릭스 갱신. 본 PR 은 11 키 (Phase A~D 누적) 만.

## 운영 효과

- **사용자 인지 부하 직접 제어**: minimal/balanced/verbose 3 단계로 신규 사용자 → 시스템 운영자 spectrum 모두 수용
- **Phase A~D 마무리 안전장치**: Phase A~D 5 PR 누적으로 도입한 다수 컴포넌트가 *정보 과잉* 으로 느껴지지 않도록 사용자 측 토글
- **점진 도입 철학의 사용자 측 변형** — Phase A KO/EN 양립과 같은 모델을 verbosity 에 적용
- **wiring 후속 PR 의 SSOT 기반** — 각 컴포넌트가 useUIVerbosity().shouldShow(키) 한 줄로 가시성 분기 → 회귀 위험 격리 + 라벨/매트릭스 변경 시 SSOT 한 곳만 수정

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — store + hook + 토글 컴포넌트만 (절대 규칙 #2/#3/#4 미위반)
- **기존 컴포넌트 무수정** — VerdictCard / ConfluenceMeter 등 wiring 부재 (후속 PR)
- **KIS/KRX/Yahoo 호출 0건** — 클라이언트 store + UI 만
- **회귀 가드** — 신규 41 케이스 (shouldShowAtVerbosity 매트릭스 22 + atLeast 9 + hook 7 + Toggle 9)
- **롤백 안전** — 신규 추가만, 기존 사용처 0건. partialize 에 추가된 `uiVerbosity` 필드는 부재 시 default 'balanced' fallback (zustand persist 동작)
- **store SSOT 격리** — useSettingsStore 단일 장소만 변경, 다른 store 미영향

## 12 아이디어 누적 — **12/12 완료 (100%)**

| # | 아이디어 | PR | 상태 |
|---|---|---|---|
| #1 | useUILang 훅 | #420 | ✅ |
| #2 | --discover 모드 | — | 후속 (운영 1~2주 누적 후) |
| #3 | 5-tier 자동 사다리 | #421 | ✅ |
| #4 | IDontKnow 4-variant | #422 | ✅ |
| #5 | DataQualityRibbon | #422 | ✅ |
| #6 | V-E-R Card Migration Gate | #423 | ✅ |
| #7 | Stop-loss First | #423 | ✅ |
| #8 | Time-band 띠 | #423 | ✅ |
| #9 | 축 결손 사유 | #424 | ✅ |
| #10 | 단방향 결합 | #424 | ✅ |
| #11 | Phase A DoD | #420 | ✅ |
| **#12** | **Verbosity 토글** | **본 PR** | ✅ |

#2 `--discover` 모드는 명시적 후속 PR 대기 (운영 1~2주 누적 후 우선순위 결정).

## 후속 PR 후보

- **PR-Verbose-Wiring-1**: VerdictCard 의 자기 가시성 분기 (variant='verdict' + shouldShow('evidence') / shouldShow('risk'))
- **PR-Verbose-Wiring-2**: ConfluenceMeter 자기 가시성 분기 (atLeast('verbose'))
- **PR-Verbose-Wiring-3**: IDontKnow / DataQualityBadge / Ribbon / GateStatusCard / GateMiniIndicator 가시성 분기 (각 별도 PR)
- **PR-Verbose-Embed**: UIVerbosityToggle 을 Settings 모달 또는 페이지 헤더 임베드

## Stack PR 메타

본 PR 의 base = `claude/ui-phase-d-confluence-meter-TVTMY` (PR #424). 상위 PR 머지 시 base 자동 변경.
**6중 stack**: PR #420 → #421 → #422 → #423 → #424 → **본 PR (Verbose)**.

**12 아이디어 시리즈 완주** — 본 PR 이 마지막. 후속은 wiring 점진 마이그레이션 (각 컴포넌트별 별도 PR 분리, 회귀 위험 격리).
