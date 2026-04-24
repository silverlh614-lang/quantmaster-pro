# ADR-0006: AttributionRepo 복합키 (tradeId, fillId) 전환 — 부분매도별 조건 가중치 학습

- 상태: 채택
- 날짜: 2026-04-24
- 작성: QuantMaster Harness (architect)
- 선행: ADR-0005 (STRONG_BUY/Telegram trim), PR-15~18 (fill SSOT 리포트 전환)

## 배경

PR-15~18 로 리포트·학습 narrative·대시보드 API 가 fill SSOT 로 정렬되었으나,
**조건별 가중치 학습** (`attributionRepo` → `attributionAnalyzer` →
`signalCalibrator`) 경로는 여전히 **전량 청산 단위 1개 레코드** 만 수용한다.

구체적 제약:
- `appendAttributionRecord` 가 `tradeId` 를 유니크 키로 쓴다 (line 92):
  `records.filter((r) => r.tradeId !== versioned.tradeId)`.
- 부분매도로 실현된 이익의 조건 기여도가 학습에 반영되지 않음.
- 사용자 케이스: 현대제철 전량 손절 + 포스코인터 부분익절 → attribution DB 에는
  현대제철 손실 1건만 기록. 포스코인터가 기여한 조건들은 가중치 업데이트에서 누락.

## 결정

### 1. 스키마 v1 → v2

`ServerAttributionRecord` 에 3개 옵셔널 필드 추가:
- `fillId?: string` — PARTIAL 레코드의 유일성 확보. FULL_CLOSE 에는 선택.
- `attributionType?: 'FULL_CLOSE' | 'PARTIAL'` — 기본 FULL_CLOSE. 부분매도 레코드는 PARTIAL.
- `qtyRatio?: number` (0~1) — 이 레코드가 반영하는 포지션 비중. 집계 가중치.

`CURRENT_ATTRIBUTION_SCHEMA_VERSION = 2`.

### 2. 복합키 dedup

```
isSameKey(a, b):
  - tradeId 다르면 false
  - 둘 다 fillId 없으면 true (FULL_CLOSE dedupe — 기존 동작)
  - 둘 다 fillId 있으면 fillId 일치 여부
  - 하나만 있으면 false (FULL_CLOSE 와 PARTIAL 병존 허용)
```

결과: 동일 trade 의 FULL_CLOSE 1건 + PARTIAL N건이 병존 가능.

### 3. 마이그레이션 v1 → v2

기존 v1 레코드에 자동 주입:
- `attributionType = 'FULL_CLOSE'`
- `qtyRatio = 1.0`

`migrateAttributionRecords()` 가 부팅 시점에 1회 실행 (`maintenanceJobs.ts`).

### 4. qtyRatio 가중 집계

`computeAttributionStats()` 를 가중 평균/가중 승률로 재작성:
- `weightedWinPct = Σ(qtyRatio | returnPct > 0) / Σ(qtyRatio)`
- `weightedAvg = Σ(returnPct × qtyRatio) / Σ(qtyRatio)`
- `totalTrades = round(Σ qtyRatio)` — 가중 trade 수 (반올림).

의미:
- 전량 청산 1건 = weight 1.0 (기존과 동일한 기여도).
- 50% 부분매도 1건 + 50% 후속 청산 1건 = weight 0.5 + 0.5 = 1.0 (최대 1.0 초과 불가).
- 부분매도가 여러 trade 에 걸쳐 있어도 각 trade 총 qtyRatio ≤ 1.0 가정이 성립하면
  가중 통계가 왜곡 없이 수렴.

### 5. 생산자 (emitter) 옵셔널 헬퍼

`emitPartialAttribution(input)` — 기존 FULL_CLOSE 레코드의 `conditionScores` 를
자동 승계해 PARTIAL 레코드를 기록. 호출자가 `conditionScoresOverride` 로 직접
제공할 수도 있음. baseline 없으면 null 반환 (noop — 학습 오염 방지).

**생산자 측 실제 wiring** (exitEngine 에서 partial SELL fill commit 직후 호출)
은 별도 PR 로 진행. 본 ADR 은 저장소·집계 레이어의 스키마 유연성만 확립한다.

## 소비자 영향 분석

- `attributionAnalyzer.ts` — 레코드 배열을 받아 평균/승률 계산. 레코드 수가
  늘어나면 자연스럽게 기여도가 증가. 단, `.returns.push(...)` 같은 단순 배열
  수집은 qtyRatio 를 무시 → 이 ADR 의 scope 에서는 `computeAttributionStats`
  만 가중화했고, `analyzeAttribution` 는 후속 PR.
- `signalCalibrator` / `incrementalCalibrator.onAttributionRecorded` — 단일
  레코드 전달 인터페이스. 부분매도 레코드도 동일하게 소비됨 (기여도가 증가하는
  효과). 알고리즘 자체는 레코드 한 건당 학습 스텝을 수행하므로 의도한 효과.
- `nightlyReflectionEngine.attributionToday` — 오늘 `closedAt` 을 기준으로
  필터. 부분매도의 `closedAt` 은 fill.confirmedAt 이므로 자동으로 포함됨.
- 텔레그램 `conditionConfession` / `weeklyConditionScorecard` / `stopLossTransparencyReport`
  — `loadAttributionRecords()` 를 소비. 레코드가 많아져도 각 레코드 독립 데이터
  포인트로 취급되므로 정상 동작.

## 하위 호환

- 파일(`data/attribution-records.json`) 은 JSON 배열 그대로 유지 — 필드만 추가.
- 외부 POST `/attribution/record` 는 v1 body 도 계속 수용 (fillId/type/qtyRatio
  미전달 시 FULL_CLOSE + qtyRatio=1.0 자동 주입).
- 기존 v1 레코드는 첫 부팅 시 마이그레이션으로 자동 승격.

## 롤백

- `CURRENT_ATTRIBUTION_SCHEMA_VERSION = 1` 로 되돌리고 `isSameKey` 를 이전
  `r.tradeId !== versioned.tradeId` 한 줄로 복구.
- v2 신규 PARTIAL 레코드는 v1 필터에서 자동 제외 (schemaVersion 불일치).
- 파일 포맷 파괴 없음 — 추가된 필드는 JSON 파서가 무시 가능.

## 검증

- 신규 테스트 `attributionRepoPartial.test.ts` 8 케이스:
  - FULL_CLOSE dedup by tradeId (기존 동작 유지)
  - PARTIAL — 동일 tradeId + 다른 fillId 병존
  - FULL_CLOSE ∥ PARTIAL 병존
  - v1→v2 마이그레이션 — attributionType/qtyRatio 주입
  - computeAttributionStats qtyRatio 가중 반영
  - emitPartialAttribution 부모 승계 / override / 부모 없음 null

- 기존 28 케이스 유지 (shadowTradeRepo / todayRealizations / todayBuyEvents /
  reflectionPartialRealization / aggregateFillStats) 모두 pass.

## 후속 과제

1. **exitEngine wiring**: partial SELL fill commit 직후 `emitPartialAttribution`
   호출. 단, conditionScores baseline 이 없는 trade (처음 부분매도가 전량 청산
   레코드보다 먼저 발생) 는 noop 이므로 **진입 시점에 conditionScores 를
   shadow trade 에 캡처** 하는 사전 작업 필요 — 별도 PR.
2. **attributionAnalyzer.analyzeAttribution** 의 배열 집계도 qtyRatio 가중화.
3. **UI 귀인 대시보드**: 전량/부분 구분 표시.
