# ADR 0048 — Learning Coverage Heatmap — F2W 데이터 밀도 게이트 (PR-Y4)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0007 (Learning Feedback Loop Policy), ADR-0024 (Regime Memory Bank), ADR-0046 (F2W Drift Detector)

## 배경

사용자 4 아이디어 중 4번 (가벼운 마무리 버전):

> 학습은 데이터가 있는 곳에서만 작동한다. 27조건 × 6레짐 × 4섹터 그룹 = 648개 셀의
> 학습 데이터 밀도 히트맵. 어떤 셀은 200건, 어떤 셀은 0~3건. 데이터가 희소한 셀에서
> 가중치를 보정하면 **노이즈를 학습하는 것**. F2W가 거래 ≥30건 셀에서만 작동하도록
> 게이트. 페르소나의 "불확실성 높으면 관망" 의 학습 영역 적용.

PR-Y1 (drift detector) 가 σ 변화의 변화를 감시하지만, 더 근본적인 문제는 **데이터
희소 셀의 노이즈가 가중치 보정의 입력**이 된다는 점. F2W 가 30거래 누적되면 자동
보정을 시작하는데, 그 30거래가 단일 레짐 (예: BULL_NORMAL) 에 집중되어 있으면 R5
레짐의 조건 22 가중치를 보정할 데이터가 0건이지만 평등하게 ±10% 가 적용된다.

ADR-0024 Regime Memory Bank 가 레짐별 가중치를 분리 저장하지만, 입력 trade 가
3건 뿐인 셀에서도 가중치를 갱신한다 — 노이즈 학습 위험.

## 결정

**Learning Coverage Gate** 신설 — F2W 가 (조건 × 레짐) 셀별 trade 수를
카운트하고, 어떤 셀도 30건 미만이면 *해당 조건 가중치 보정 스킵*.

### 1. 셀 정의 (사용자 원안에서 가벼운 단순화)

- 원안: 27 × 6 × 4섹터 = 648 셀
- 본 PR: **27 × 7 = 189 셀** (조건 × 레짐, 섹터 축은 후속 PR)
- 7 레짐 = `RECOVERY` `EXPANSION` `SLOWDOWN` `RECESSION` `RANGE_BOUND` `UNCERTAIN` `CRISIS` (ADR-0024 ALL_REGIMES SSOT 재사용)

### 2. 게이트 임계 (사용자 원안)

```ts
const COVERAGE_THRESHOLD = 30; // 거래 수
```

- 조건 i 의 relevant trades 를 entryRegime 별 그룹화
- 가장 많은 셀의 trade 수 < 30 → 해당 조건 가중치 보정 스킵
- ≥ 30 → 정상 보정 (현재 동작 유지)

표본 가드: 조건의 relevant trade < `MIN_CONDITION_TRADES` (5건) 시 기존 fallback
(PR-A 부터 존재) 우선 — 본 게이트는 그 위에 추가 안전망.

### 3. 영속 데이터

본 PR 은 영속 데이터 신규 도입 *없음* — 이미 `TradeRecord.entryRegime` (PR-G,
ADR-0024) 로 저장 중. 셀 카운트는 evaluateFeedbackLoop 호출 시점에 매번 계산
(메모리 only, 가볍다).

### 4. 가드 wiring

`feedbackLoopEngine.evaluateFeedbackLoop` 진입부, 조건별 relevant trades
필터링 직후:

```ts
const cellCounts = countTradesByRegime(relevant);
const maxCellCount = Math.max(...cellCounts.values(), 0);
if (maxCellCount < COVERAGE_THRESHOLD) {
  coverageGated.push({
    conditionId: id,
    maxCellCount,
    reason: 'INSUFFICIENT_COVERAGE',
  });
  continue; // 가중치 보정 스킵
}
```

### 5. 결과 객체 확장

`FeedbackLoopResult.coverageGated?` 옵셔널 필드 추가:

```ts
coverageGated?: Array<{
  conditionId: ConditionId;
  maxCellCount: number;
  reason: 'INSUFFICIENT_COVERAGE';
}>;
```

운영자가 어떤 조건이 데이터 부족으로 보정 스킵됐는지 즉시 확인 가능.

### 6. 운영자 진단 endpoint

`GET /api/learning/coverage` — 189 셀 카운트 매트릭스 + 게이트 상태 일괄 반환.

요청: 클라이언트가 closed trades 를 body 로 POST 하면 서버가 카운트 — 또는
*read-only* 로 클라이언트 측 store 에서 직접 조회. 본 PR 은 *read-only*
endpoint 를 제공하지 않고, 클라이언트 store 에서 직접 `computeCoverage()` 호출.

(클라이언트 측 데이터라 서버 endpoint 부재. F2W drift 와 달리 텔레그램 알림
불필요 — 통계 진단은 UI 후속 PR.)

### 7. ENV 롤백

`LEARNING_COVERAGE_GATE_DISABLED=true` → 게이트 무력화 (현재 동작 유지).

## 후방호환

- 첫 도입 시점에 trade 30건 미만이면 calibrationActive=false → 기존 진입 차단 그대로
- entryRegime 부재 v1 레코드 → 'UNCERTAIN' fallback 그룹화 (셀 누락 방지)
- 게이트가 trade 30건 누적 직후 활성화돼도 단일 레짐 30건이면 정상 보정 (보수적)
- 환경변수 즉시 회로 무력화

## 사용자 한 줄

**학습은 데이터가 있는 곳에서만 작동한다.** 페르소나의 "불확실성 높으면 관망" 을
학습 영역에도 적용한다.
