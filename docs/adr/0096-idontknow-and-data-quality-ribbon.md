# ADR-0096 — IDontKnow 4-variant + DataQualityRibbon (UI Phase B)

**상태**: Accepted (PR-Z9 / Phase B)
**작성일**: 2026-04-29
**관련**: ADR-0094 (UI Language SSOT — Phase A 게이트키퍼), ADR-0095 (DataQualityBadge 5-tier 격상 — Phase A-2)

## 배경

사용자 분석 12 아이디어 중 **#4 IDontKnow 4-variant** + **#5 DataQualityRibbon** 두 항목을
단일 PR 로 통합. 두 컴포넌트 모두 Phase A SSOT 위에 자연 확장 — 별도 페이지/위젯 신설 없이
공통 컴포넌트 (`src/components/common/`) 추가.

### #4 — IDontKnow 4-variant (사용자 분석 핵심 통찰)

> *"IDontKnow 를 단일 컴포넌트로 제안했지만, '모름'은 동질이 아닙니다. 4 분류로 나뉩니다 —
> Delayed / Insufficient / Stale / Conflicted. 각 variant 는 다른 아이콘 / 다른 색상 / 다른
> 권고 액션을 가집니다. 사용자가 '왜 모르는지'를 즉시 인지하면 좌절감이 사라지고 대기 가능
> 시간을 정확히 계산할 수 있습니다."*

페르소나 *"Stop-loss is operating cost"* 의 거꾸로 적용 — **모름도 정보다, 정보의 비용이다**.

기존 코드베이스의 분산된 *"모름" 표현*:
- `OffHoursBanner` — 장외 시간 메시지 (≈ STALE)
- `MarketDataStaleBadge` — 데이터 stale 배지 (≈ DELAYED)
- `RecommendationWarningsBanner` — 추천 결손 안내 (≈ INSUFFICIENT)
- `CONFLICTED` 케이스는 *부재* (현재 신호 충돌 표현 컴포넌트 없음)

본 PR 은 **컴포넌트 신설** 만, 기존 3 컴포넌트 흡수는 후속 PR 에서 점진 — 회귀 위험 격리.

### #5 — DataQualityRibbon (사용자 분석 핵심 통찰)

> *"DataQualityBadge 는 개별 필드 단위라 사용자가 '이 페이지 전체의 데이터가 얼마나 믿을 만한지'를
> 한눈에 못 봅니다. 페이지 상단에 얇은 가로 띠를 추가해 페이지에 표시된 모든 필드의 5-tier
> 분포를 누적합니다."*

띠의 색상이 페이지 전체 데이터 신뢰도를 **ambient 하게** 전달 — 사용자가 매번 개별 배지를
안 봐도 페이지 신뢰도를 무의식적으로 감지. Blueprint 원칙 10번 *"시스템 신뢰도를 UI 에서
숨기지 않는다"* 의 가벼운 구현 (CSS 변수 안 건드림, 페이지 상단 띠 1줄만).

## 결정

2 신규 공통 컴포넌트 — Phase A/A-2 SSOT 위에 자연 확장.

### Layer 1 — `src/components/common/IDontKnow.tsx` 4-variant compound

```tsx
<IDontKnow.Delayed message="..." action="..." compact={false} />
<IDontKnow.Insufficient />
<IDontKnow.Stale />
<IDontKnow.Conflicted />
```

각 variant 의 시각 언어 차이 (페르소나 정합 — *"왜 모르는지"* 즉시 인지):

| Variant | 아이콘 | 색상 | 사용자 인지 | 권고 액션 |
|---|---|---|---|---|
| `Delayed` | `Clock` | slate (회색) | "기다리면 해결됨" | "잠시 후 자동 갱신" |
| `Insufficient` | `BarChart3` | zinc (회색) | "지금은 못 함, 시간 흘러야 함" | "데이터 누적 후 활성화" |
| `Stale` | `Moon` | blue (파랑) | "지금은 의미 없음" | "다음 영업일 09:00 갱신" |
| `Conflicted` | `AlertCircle` | amber (황) | "신호들이 서로 모순" | "운영자 검토 필요" |

**메시지 SSOT**: `useUILang().empty(...)` 사용 — UI_LANG.empty 4 sub-variant 정합 (ADR-0094).
`message` prop override 가능. compact 모드 지원 (배지 형태).

### Layer 2 — `src/components/common/DataQualityRibbon.tsx`

```tsx
<DataQualityRibbon counts={recommendations.map(s => classifyDataQuality(s))} height={3} />
```

**입력**: `DataQualityCount[]` 배열 (페이지 표시 필드의 5-tier 카운트).

**출력**: 페이지 상단 가로 띠 — 5 segment 비율 표시 (verified/external/delayed/estimated/manual).
각 segment 는 색상 분리 (emerald/cyan/slate/amber/violet).

**grade 산출** (순수 함수 `computeRibbonRatios`):
- `estimatedPct ≥ 0.50` → `WARN` (운영 위험)
- `estimatedPct ≥ 0.30` → `OK` (경고)
- 그 외 → `GOOD` (양호)

**ARIA 접근성**: `role="img"` + `aria-label` 5-tier 정합 (UI_LANG.tier 라벨 — "실측 50%, 지연
데이터 25%, AI 추정 25%").

**옵셔널 처리**: `delayed?` / `manual?` 옵셔널 카운트 안전 합산 (ADR-0095 5-tier 정합).
빈 입력 → placeholder (`data-quality-ribbon-empty="true"`).

## 회귀 테스트

**3 파일 신규**:

1. `src/components/common/IDontKnow.test.tsx` — jsdom 컴포넌트 회귀 19 케이스
   - 4 variant export + data-idontknow-variant 속성
   - UI_LANG.empty SSOT 기본 메시지 (4 variant)
   - message/action prop override
   - compact vs 배너 모드
   - ARIA 접근성 (role + aria-label)
   - 4 variant 색상 클래스 차이 (시각 언어 검증)
2. `src/components/common/DataQualityRibbon.test.tsx` — jsdom 회귀 18 케이스
   - `computeRibbonRatios` 순수 함수 8 (빈 입력 / 5-tier 합산 / grade 분기 / 옵셔널 처리 / 비율 합 1.0)
   - Ribbon 컴포넌트 10 (placeholder / grade 속성 / 카운트 0 자동 생략 / 5 segment 표시 / aria-label / height/className)
3. ADR-0096 + ARCHITECTURE.md boundary rule + CLAUDE.md 변경 이력

총 신규 약 37 케이스.

## 비결과 (out-of-scope)

본 PR 은 **컴포넌트 신설 + 1곳 시범 임베드 (옵션)** — 이하 항목은 후속 PR 분리:

- **OffHoursBanner / MarketDataStaleBadge / RecommendationWarningsBanner 흡수**: 본 PR 의
  IDontKnow 4-variant 아래로 통합 흡수는 후속 PR (각 사용처 PR 별도 — 회귀 위험 격리).
- **DataQualityRibbon 다곳 임베드**: MarketOverviewHeader / DiscoverWatchlistPage 등 페이지별
  점진 임베드는 후속 PR. 본 PR 은 *컴포넌트 도입* 만, 사용처 wiring 은 1곳 또는 0곳.
- **5-tier 종합 등급 산출**: 현재 `computeRibbonRatios` grade 는 estimatedPct 기반 — 추가
  지표 (delayed weight 등) 가중 계산은 후속 PR.
- **Conflicted variant 자동 트리거**: 현재 *수동* 사용 — 향후 multi-source mismatch 자동
  감지 (ADR-0071 cross-source validator 와 결합) 시 자동 트리거.

## 운영 효과

- **모름 표현 통일**: 사용자가 "왜 모르는지"를 4 시각 언어로 즉시 인지 → 좌절감 ↓ + 대기
  가능 시간 정확 계산
- **페이지 신뢰도 ambient 노출**: DataQualityRibbon 띠 색상으로 페이지 전체 신뢰도를 무의식
  감지 → 개별 배지 일일이 안 봐도 됨
- **UI_LANG SSOT 활용**: useUILang().empty / .tier 사용으로 향후 KO/EN 토글 시 자동 격상
- **Phase A/A-2 위에 자연 확장**: SSOT (UI_LANG.empty 4 sub-variant) + 5-tier 카운트 (DataQualityCount)
  위에 컴포넌트만 추가 — 백엔드 0건 변경

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 컴포넌트만 도입 (절대 규칙 #2/#3/#4 미위반)
- **기존 컴포넌트 무수정** — OffHoursBanner / MarketDataStaleBadge / RecommendationWarningsBanner
  본체 보존, 흡수는 후속 PR
- **KIS/KRX/Yahoo 호출 0건** — 클라이언트 컴포넌트만
- **회귀 가드** — 신규 37 jsdom 컴포넌트 케이스 + computeRibbonRatios 순수 함수 8 케이스
- **롤백 안전** — 신규 컴포넌트만 도입, 기존 사용처 0건 (시범 임베드도 1곳 또는 0곳)

## 후속 PR 후보

- **PR-Phase-B-2**: OffHoursBanner / MarketDataStaleBadge / RecommendationWarningsBanner 를
  IDontKnow 4-variant 로 흡수 (각 사용처 PR 별도)
- **PR-Phase-B-3**: DataQualityRibbon 을 MarketOverviewHeader / DiscoverWatchlistPage 등
  페이지별 점진 임베드
- **PR-Phase-B-4**: Conflicted variant 자동 트리거 (ADR-0071 cross-source validator 결합)
- **PR-Phase-C**: V-E-R Card + Stop-loss First + Time-band 띠 (#6, #7, #8)
- **PR-Phase-D**: ConfluenceMeter 4축 + 축 결손 사유 (#9, #10)

## Stack PR 메타

본 PR 의 base = `claude/ui-phase-a-2-data-quality-5tier-TVTMY` (PR #421). PR #421 머지 시
base 자동 main 으로 변경. PR #420 (Phase A SSOT) → PR #421 (Phase A-2 5-tier) → PR-Z9 (본
PR — Phase B IDontKnow + Ribbon) **3중 stack**.
