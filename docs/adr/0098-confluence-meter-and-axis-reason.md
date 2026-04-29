# ADR-0098 — ConfluenceMeter 4축 + 축 결손 사유 + 단방향 결합 (UI Phase D)

**상태**: Accepted (PR-Z11 / Phase D)
**작성일**: 2026-04-29
**관련**: ADR-0094 (UI Language SSOT), ADR-0095 (DataQualityBadge 5-tier), ADR-0096 (IDontKnow + Ribbon),
ADR-0097 (VerdictCard V-E-R + Time-band)

## 배경

사용자 12 아이디어 분석 중 Phase D 의 2 항목 단일 PR 통합:

- **#9 축 결손 자동 표기** (S/C 3.0) — 4 축 중 약한 축에 *왜* 약한지 1줄 사유
- **#10 단방향 결합** (S/C 4.5) — VerdictCard.Evidence 안 자식으로 박힘 + 어디서든 단독 사용 가능

두 항목 모두 ConfluenceMeter 컴포넌트의 핵심 디자인이므로 단일 PR.

### 사용자 분석 직접 인용

#### #9 — 축 결손 자동 표기

> *"4축(Fundamental/Flow/Technical/Macro)의 합치를 표시할 때, 단순 점수 표시가 아니라 '왜 이 축이 약한가'의 한 줄 사유를 동반합니다."*
>
> *"각 축이 약한 이유를 1줄로 노출하면 사용자는 '기다려야 할 것'과 '포기해야 할 것'을 구분할 수 있습니다. DART 발표는 기다리면 해결, Macro 결손은 시간 외 변수라 기다림이 무의미. 이는 시스템이 자기 결론의 한계를 자발적으로 노출하는 디자인이고, Blueprint 원칙 6번 '모름을 표현할 수 있어야 한다'의 가장 정교한 구현입니다."*

#### #10 — 단방향 결합

> *"ConfluenceMeter 는 V-E-R Card 의 Evidence 슬라이스 안에 자식으로 박힙니다. 별도 위젯이 아닙니다. 이 결합 방향이 핵심입니다 — Evidence 가 ConfluenceMeter 를 가지지만, ConfluenceMeter 는 Evidence 를 모릅니다(단방향). 그래서 ConfluenceMeter 는 V-E-R Card 밖에서도 단독 사용 가능 (Screener 페이지의 헤더 KPI 등)."*
>
> *"이 단방향 결합 덕분에 Phase D 가 끝난 후 ConfluenceMeter 를 다른 페이지(Screener, Backtest)에 재사용할 수 있습니다. 천재성은 '어디든 박힐 수 있는 작은 부품으로 만든 것'에 있습니다. 코드베이스의 commandRegistry / SymbolMarketRegistry 같은 SSOT 부품들이 어디든 import 가능한 것과 같은 패턴입니다."*

## 결정

신규 컴포넌트 1개 — Phase A/A-2/B/C SSOT 위에 자연 확장 + 외부 의존성 0.

### `src/components/common/ConfluenceMeter.tsx`

```tsx
<ConfluenceMeter axes={[
  { id: 'FUNDAMENTAL', score: 8.2, reason: 'ROE 17.5% / OCF 양호' },
  { id: 'FLOW', score: 4.1, reason: '외인 5일 -50억' },
  { id: 'TECHNICAL', score: 7.8, reason: 'MA20 돌파 + RSI 62' },
  { id: 'MACRO', score: 3.2, reason: 'VKOSPI 28 (불안)' },
]} />
```

#### 4 축 SSOT

`ConfluenceAxisId` 4값 union: `'FUNDAMENTAL' | 'FLOW' | 'TECHNICAL' | 'MACRO'`. 한국어 라벨은
컴포넌트 내부 `AXIS_LABEL` 상수 — Phase A UI_LANG.confluence 신규 카테고리는 본 PR scope 외
(후속 PR-Phase-A-3 또는 별도 PR 에서 SSOT 정합).

#### 축 점수 분류 SSOT

- **`classifyAxisScore(score)`** 3 분기:
  - `STRONG` (≥7) — emerald
  - `NEUTRAL` (5~7) — amber
  - `WEAK` (<5) — red
- NaN/Infinity 안전 fallback → WEAK (보수적)

#### 축 결손 사유 자동 표기 (#9)

- **`shouldShowReason(score)`** SSOT — `score < 5` 시 true
- WEAK 축만 reason 노출 (STRONG/NEUTRAL 축은 미노출 — 사용자 시각 부담 ↓)
- reason 부재 시 "데이터 미수집" placeholder
- `data-confluence-axis-reason` 속성 (e2e 친화) — 결손 사유 영역만 정확히 카운트 가능

#### 종합 등급 SSOT

`classifyConfluence(axes)` 4 분기 — STRONG 축 카운트 기반:

| STRONG 카운트 | 종합 등급 | 라벨 |
|---|---|---|
| ≥3 | CONVICTION | 🔥 강한 합치 |
| 2 | CONFIDENT | ✅ 확신 |
| 1 | MIXED | 🟡 혼재 |
| 0 | DIVERGENT | ⚠️ 신호 충돌 |

#### 단방향 결합 (#10)

**ConfluenceMeter 는 VerdictCard 를 import 하지 않는다** — props 만 받음. 외부 의존성 0.

- VerdictCard.Evidence slot 안 자식으로 박힘:
  ```tsx
  <VerdictCard variant="verdict">
    <VerdictCard.Verdict ... />
    <VerdictCard.Evidence>
      <ConfluenceMeter axes={...} />  {/* Evidence 가 ConfluenceMeter 를 가짐 */}
    </VerdictCard.Evidence>
    <VerdictCard.Risk ... />
  </VerdictCard>
  ```
- 어디서든 단독 사용 가능:
  ```tsx
  <ConfluenceMeter axes={...} />  // Screener 헤더 KPI / Backtest 결과 카드 / DiscoverPage Top
  ```

회귀 테스트가 *VerdictCard 외부 단독 렌더 시 vcard 마커 부재* 검증 — 단방향 보장.

#### compact vs full 모드

- **compact**: 4 막대만 가로 배열 (라벨/사유 미노출, title attribute 에 점수 hover). Screener 카드 헤더 KPI 등 좁은 공간용.
- **full** (기본): 4 라인 + 라벨 + 점수 + progressbar + 결손 사유. VerdictCard.Evidence 안 메인 사용.

#### ARIA 접근성

- full: `role="region"` + aria-label 종합 등급
- 각 축: `role="progressbar"` + aria-valuenow 점수 비율
- compact: `role="img"` + aria-label

## 회귀 테스트

**1 파일 신규**:

`src/components/common/ConfluenceMeter.test.tsx` — jsdom 회귀 36 케이스
- `classifyAxisScore` 8 (STRONG/NEUTRAL/WEAK 경계값 + NaN/Infinity)
- `shouldShowReason` 3 (≥5 false / <5 true / NaN true 보수적)
- `classifyConfluence` 5 (CONVICTION 4·3 / CONFIDENT 2 / MIXED 1 / DIVERGENT 0)
- 4 축 라벨 + 점수 + data-confluence-axis 속성 + axis-tier 4
- #9 결손 사유 표기 4 (WEAK 만 표시 / STRONG/NEUTRAL 미표시 / reason 부재 placeholder / 정확 카운트)
- 종합 등급 라벨 3 (CONFIDENT / CONVICTION / DIVERGENT)
- compact 모드 2 (4 막대만 / title hover)
- 안전 가드 2 (빈 배열 placeholder / NaN 점수 WEAK)
- ARIA 2 (role=region + aria-label / progressbar aria-valuenow)
- **#10 단방향 결합 2** (VerdictCard.Evidence 안 자식 / VerdictCard 외부 단독)
- 페르소나 정합 1 (WEAK FLOW + WEAK MACRO 동시 노출)

## 비결과 (out-of-scope)

- **UI_LANG.confluence 카테고리 추가**: 4 축 라벨을 UI_LANG SSOT 로 격상 — 후속 PR (Phase A SSOT 확장)
- **VerdictCard.Evidence 시범 임베드**: DiscoverWatchlistPage Top 3 카드의 V-E-R Evidence 안 ConfluenceMeter 임베드는 후속 PR (PR-Phase-C-3 와 동시 진행)
- **Screener / Backtest 페이지 단독 사용**: 다른 페이지 헤더 KPI 임베드는 후속 PR
- **백엔드 4 축 score 산출**: 현재는 props 직접 받음 — 백엔드가 Gate 평가 결과를 4 축으로 매핑하는 wiring 은 후속 PR (`enrichment.ts` 또는 `confluenceEngine.ts` 신설)
- **결손 사유 자동 생성**: 현재는 props 로 받음 — 백엔드가 데이터 출처 + 결손 패턴 자동 매핑 (예: "DART 사업보고서 결측" / "외인 N일 누적 -X억") 은 후속 PR

## 운영 효과

- **시스템 한계 자발적 노출**: 약한 축의 결손 사유로 사용자가 *시스템이 모르는 것* 을 즉시 인지 → 페르소나 *"불확실성이 높으면 관망을 정답으로"* 강화
- **기다림 가능 vs 불가능 구분**: DART 발표 대기 vs Macro 결손 같은 결손 종류 구분으로 *대기 비용* 정확 계산
- **단방향 부품 패턴**: ConfluenceMeter 가 어디든 박힐 수 있는 작은 부품 — VerdictCard / Screener / Backtest 모두 재사용
- **4 축 합치도 한눈 인지**: 종합 등급 (CONVICTION/CONFIDENT/MIXED/DIVERGENT) 으로 사용자가 매수 결정 신뢰도 즉시 판단

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 컴포넌트만 도입 (절대 규칙 #2/#3/#4 미위반)
- **외부 의존성 0** — VerdictCard / 백엔드 / 다른 컴포넌트 import 0건 (props 만 받음)
- **KIS/KRX/Yahoo 호출 0건** — 클라이언트 컴포넌트만
- **회귀 가드** — 신규 36 jsdom 케이스 + 순수 함수 16 케이스 (classifyAxisScore 8 + classifyConfluence 5 + shouldShowReason 3)
- **롤백 안전** — 신규 컴포넌트만 도입, 기존 사용처 0건 (시범 임베드도 본 PR 미포함)
- **단방향 결합 검증** — 회귀 테스트가 VerdictCard 외부 단독 렌더 시 vcard 마커 부재 자동 검증

## 후속 PR 후보

- **PR-Phase-D-2**: VerdictCard.Evidence 안 ConfluenceMeter 시범 임베드 (DiscoverWatchlistPage Top 3)
- **PR-Phase-D-3**: 백엔드 4 축 score 산출 wiring (`confluenceEngine.ts` 신설)
- **PR-Phase-D-4**: 결손 사유 자동 생성 (백엔드 데이터 출처 + 결손 패턴 매핑)
- **PR-Phase-A-3**: UI_LANG.confluence 카테고리 추가 (4 축 라벨 SSOT 격상)
- **PR-Verbose**: useSettingsStore uiVerbosity 토글 (#12) — minimal/balanced/verbose 분기

## Stack PR 메타

본 PR 의 base = `claude/ui-phase-c-verdict-card-TVTMY` (PR #423). 상위 PR 머지 시 base 자동 변경.
**5중 stack**: PR #420 (Phase A SSOT) → PR #421 (Phase A-2 5-tier) → PR #422 (Phase B IDontKnow + Ribbon) → PR #423 (Phase C VerdictCard) → **본 PR (Phase D ConfluenceMeter)**.

12 아이디어 누적 진행도 — **본 PR 후 11/12 완료** (#1, #3, #4, #5, #6, #7, #8, #9, #10, #11). 잔여 1 항목 (#12 Verbosity 토글) 만 후속.
