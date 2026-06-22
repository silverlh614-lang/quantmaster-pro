# ADR-0642 — DXY 교차검증 `CONTRADICTED` 분류 — "DXY 단독 신호가 환율·EWY 에 의해 반박됨" 을 UNCLEAR 에서 분리

@responsibility DXY 예비 경보의 `determineFlowBias` 가 DXY 함의 방향(강세→외국인 이탈 / 약세→복귀)을 교차지표(USD/KRW·EWY)가 **둘 다 정면 반박**하는 상태를 단순 `UNCLEAR`("관찰 후 판단")로 뭉뚱그리던 것을 신규 `CONTRADICTED` 분류로 분리해, "DXY 단독 신호 반박 — 추종 신뢰도 낮음" 으로 운영자에게 정직하게 표기하는 경보-taxonomy 경계 ADR (advisory 전용·LIVE 주문 경로 0줄).

- **Status:** Proposed (architect: 경계·taxonomy·ADR·INDEX. dxyMonitor 본문·타입 유니온·UI 전파·테스트는 engine-dev / dashboard-dev 인계.)
- **Date:** 2026-06-21
- **Branch:** claude/dxy-preliminary-alert-3m03v6
- **Supersedes / Extends:** ADR-0034(macro-intelligence)·ADR-0035(attribution·correlation)·ADR-0059(safePctChange)·ADR-0146(byte-equivalent·wiring vs 인프라)·ADR-0530(Patch Scope Guard)
- **Patch vs ADR:** ADR (신규 분류 = flowBias taxonomy 경계 확장·교차 경계 타입 계약 변경). INDEX.md 0642→0643 갱신 의무.

---

## Context — "교차 검증 불일치" 가 두 가지를 한 통에 담고 있었다

`server/alerts/dxyMonitor.ts` 의 외국인 수급 선행 경보는 DXY 1d/5d 변화율이 임계를 넘으면
USD/KRW·EWY 1d 변화율로 교차 검증해 `flowBias` 를 산출한다. 기존 3분류:

- `FOREIGN_OUTFLOW` — DXY↑ & KRW↑ & EWY↓ (세 지표 동시 일치)
- `FOREIGN_INFLOW` — DXY↓ & KRW↓ & EWY↑ (세 지표 동시 일치)
- `UNCLEAR` — 그 외 전부 → "단독 시그널 — 타 지표 동조 여부 관찰 후 판단"

문제: `UNCLEAR` 가 **성격이 다른 두 상태**를 한 통에 담는다.

1. **부분 일치/혼조** — 교차지표 중 하나만 DXY 를 지지 (진짜 "아직 불분명, 관찰").
2. **정면 반박** — 교차지표 **둘 다** DXY 함의의 *반대* 방향 (DXY 단독 신호가 환율·EWY 에 의해 *반박*됨).

실측 트리거 (2026-06-21):

```
▲ DXY 100.85 | 1d +0.76% · 5d +0.99%   (1d 0.6% 임계 돌파 → 예비)
USD/KRW 1d -0.50%   (원화 강세 = 유입 표)
EWY 1d +6.89%       (한국물 강한 유입 = 유입 표)
```

DXY 강세는 "외국인 이탈" 을 함의하지만 KRW·EWY 두 지표 모두 **유입** 을 가리킨다 →
DXY 단독 신호가 반박된 상태. 그런데 현행 메시지는 "관찰 후 판단" 으로, 마치 교차지표가
*아직 동조하지 않았을 뿐* 인 것처럼 표기 → 운영자가 DXY 강세 신호를 과대평가할 위험.

## Decision

### D1 — `flowBias` 에 `CONTRADICTED` 신설 (표결 모델)

DXY 함의 방향을 교차지표 2표(KRW·EWY)가 몇 표 **지지/반박**하는지 센다.

- DXY↑ (함의=이탈): 지지표 = `KRW↑`(원약세)·`EWY↓`(한국 매도). 반박표 = `KRW↓`·`EWY↑`.
- DXY↓ (함의=복귀): 지지표 = `KRW↓`·`EWY↑`. 반박표 = `KRW↑`·`EWY↓`.

| 표결 | 분류 |
|------|------|
| 2지지 | `FOREIGN_OUTFLOW`(↑) / `FOREIGN_INFLOW`(↓) — **기존 조건식 byte-identical 보존** |
| 2반박 | **`CONTRADICTED`** (신규) |
| 1지지·1반박, 또는 KRW/EWY null | `UNCLEAR` (기존) |

기존 OUTFLOW/INFLOW 조건(`change1d>0 && krwChange>0 && ewyChange<0` 등)은 글자 그대로
보존되며, 신규 `CONTRADICTED` 는 *이전에 UNCLEAR 였던 부분집합* 만 흡수한다 (회귀 0).

### D2 — 메시지 분기 (telegram + 대시보드)

- biasLine: `🟡 DXY 단독 신호 반박 (USD/KRW·EWY 정면 역행)`
- action(방향 인지):
  - DXY↑ 반박 → "DXY 강세 비반영 — 원화 강세·EWY 유입 우세, 이탈 신호 신뢰도 낮음 (DXY 단독 추종 금지)"
  - DXY↓ 반박 → "DXY 약세 비반영 — 원화 약세·EWY 이탈 우세, 복귀 신호 신뢰도 낮음 (DXY 단독 추종 금지)"
- 대시보드 `GlobalSignalsPanel` 라벨 "DXY 단독·역행" / Badge variant `warning`(yellow).

### D3 — `logToNewsSupply` 가드 명시화 (학습 DB 정합)

기존 가드 `severity!=='CONFIRMED' || flowBias==='UNCLEAR'` 는 `CONFIRMED` 인데 `CONTRADICTED`
인 케이스(1d·5d 둘 다 임계 돌파 + 교차 반박)를 흘려보내 headline ternary 의 else 분기로
**"외국인 복귀"** 로 오기록할 수 있다. 가드를 **`flowBias` 가 OUTFLOW 또는 INFLOW 일 때만 기록**
으로 좁힌다. 기존 분류 효과는 byte-identical(이전 UNCLEAR=비기록 / 지금 CONTRADICTED=비기록).

## Consequences

- **운영자**: DXY 단독 강세를 환율·EWY 가 반박하는 false-alarm 을 "관찰" 이 아닌 "반박·추종 금지"
  로 정직하게 인지. 과대평가 위험 감소.
- **타입 계약**: `DxyAlertReport.flowBias`(server) + `GlobalSignalsResponse['dxy'].flowBias`
  (`src/api/autoTradeClient.ts`) 유니온에 `'CONTRADICTED'` 추가. UI 는 미처리 시 default 로
  graceful fallback 되나 본 PR 에서 명시 분기 추가.

## Patch Scope Guard (ADR-530)

- **targetDomain**: alerts/macro-dxy (1) + 타입계약·UI 전파(얇음) — 3 도메인 이내.
- **allowedFiles**: `server/alerts/dxyMonitor.ts` · `server/alerts/dxyMonitor.test.ts`(신규) ·
  `src/api/autoTradeClient.ts`(flowBias 유니온 1줄) · `src/components/autoTrading/GlobalSignalsPanel.tsx`
  (biasLabel/biasVariant) · 본 ADR · `docs/adr/INDEX.md`(0642→0643) · `docs/ai/10-patch-history-index.md`(1줄).
- **forbiddenFiles**: autoTradeEngine · kisClient · SourceSnapshot 생성기 · Gate scorer · 주문 경로 · `.env*`.
- **expectedBehaviorChange**: 2반박 케이스가 UNCLEAR→CONTRADICTED 로 재분류되고 전용 문구로 발송.
- **sourceSnapshotImpact**: 없음 (SourceSnapshot 무접촉·불변식 #3/#9 보존).
- **executionImpact**: **NONE** — flowBias 는 주문을 게이팅하지 않는다 (텔레그램·대시보드·학습로그 advisory 전용·LIVE 본체 0줄·KIS/KRX quota 0).
- **shadowLearningImpact**: 없음 (logToNewsSupply 효과 byte-identical·불변식 #2 보존).
- **telegramImpact**: CONTRADICTED 전용 biasLine/action 신설.
- **providerImpact**: 없음 (fetchCloses 입력만 소비·불변식 #6 providerIssue≠bearish 무관).
- **testsRequired**: determineFlowBias 진리표(OUTFLOW/INFLOW/CONTRADICTED↑↓/UNCLEAR/null) + formatAlert 문자열.
- **rollbackPlan**: 단일 커밋 revert (LIVE 영향 0·즉시 baseline).

계보 0034/0035/0059/0146/0530. INDEX 0642 등재(다음 0642→0643 갱신).
