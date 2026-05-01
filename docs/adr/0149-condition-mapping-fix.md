# ADR-0149: 27 조건 SSOT mismatch 수리 — 클라이언트 ID 의미를 진실의 출처로 정착

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase0-MappingFix (audit findings `_workspace/audit-pr-phase0/findings.md`)
**관련 ADR**:
- ADR-0006 (Composite Key) — 본 PR 이 보호하는 attribution 영속 SSOT
- ADR-0018 (PR-A) — `CHECKLIST_TO_CONDITION_ID` 클라이언트 SSOT 도입
- ADR-0027 (Learning Shadow Model)
- ADR-0114 (DataTrustLayer) — 본 PR 의 의미 정합 정책의 상위 안전망

## 문제

27 조건 학습 시스템의 SSOT 가 *서버* (`server/learning/attributionAnalyzer.ts`) 와 *클라이언트* (`src/services/quant/evolutionEngine.ts` + `checklistToConditionScores.ts`) 두 곳에 분산. PR-Phase0-Audit 검증 결과:

1. 서버 `attributionAnalyzer.CONDITION_NAMES` (1~27) 와 클라이언트 `evolutionEngine.ALL_CONDITIONS` (1~27) 의 **22 ID 가 다른 의미**.
2. 클라이언트 `evolutionEngine.ALL_CONDITIONS` ↔ `CHECKLIST_TO_CONDITION_ID` 는 **27/27 완벽 일치** — 즉 클라이언트 양쪽이 정합한 SSOT.
3. 서버 `CONDITION_TO_SERVER_KEY` 의 6 키 매핑 중 5/6 가 클라이언트 의미와 어긋남 (예: ID=18 서버 의미="모멘텀 순위" → `'momentum'` 매핑이지만 클라 의미 ID=18 = "터틀 돌파").
4. `buildEntryConditionScores` 가 매수 시점에 서버 ID 의미로 영속 저장 → 클라이언트 학습 가중치 SSOT (`CONDITION_SOURCE_MAP`) 에 *잘못된 ID* 로 입력.

영향:
- 매수 시점 영속된 27 조건 점수 벡터의 *21 ID 가 영원히 NEUTRAL=5* (의미 누락률 ~78%)
- 6 키만 HIGH=7 로 승격되지만 그 ID 위치가 *잘못된 클라이언트 의미와 매핑*
- `analyzeAttribution` 가 영속 데이터를 분석할 때 *어긋난 의미로 학습 가중치 입력* 누적
- 운영자 진단 메시지 (예: `/at`) 가 *잘못된 라벨* 노출 (예: ID=18 을 "모멘텀 순위" 로 표기, 실제 클라 의미 = "터틀 돌파")

## 결정

### 1. 클라이언트 SSOT 를 진실의 출처로 정착

`evolutionEngine.ALL_CONDITIONS` + `CHECKLIST_TO_CONDITION_ID` 를 27 조건의 의미 진실로 채택. 이유:
- 27/27 완벽 일치 (자기 정합)
- 학습 가중치 SSOT (`CONDITION_SOURCE_MAP`) 가 이미 클라이언트 의미 사용
- UI 측 (DataQualityBadge / VerdictCard / GateStatusCard) 모두 클라이언트 의미 사용
- ADR-0114 DataTrustLayer 의 *Tier 1 진실* 위치와 정합 (UI 가 사용자 인지 SSOT)

### 2. 서버 attributionAnalyzer SSOT 를 클라이언트 의미로 정정

`server/learning/attributionAnalyzer.ts` 두 SSOT 정정:

#### `CONDITION_NAMES: Record<number, string>` (라인 25-53)
27 ID 모두 클라이언트 의미로 교체. 운영자 메시지 (예: `/at` 명령 응답) 가 *클라이언트 UI 와 정합한 라벨* 노출.

#### `CONDITION_TO_SERVER_KEY: Record<number, ConditionKey | null>` (라인 62-69)
6 키 → 8 키로 확장 + 클라 ID 의미 기준 정정:

```typescript
const CONDITION_TO_SERVER_KEY: Record<number, ConditionKey | null> = {
  // 클라 ID 2 = momentumRanking 모멘텀 ↔ 서버 'momentum' (Gate 2 +2%/RSI 가속)
  2:  'momentum',
  // 클라 ID 4 = supplyInflow 수급 질 ↔ 서버 'supply_confluence' (KIS 기관/외인)
  4:  'supply_confluence',
  // 클라 ID 10 = technicalGoldenCross 정배열 ↔ 서버 'ma_alignment'
  10: 'ma_alignment',
  // 클라 ID 11 = volumeSurgeVerified 거래량 ↔ 서버 'volume_breakout' (5일 평균 2배)
  11: 'volume_breakout',
  // 클라 ID 18 = turtleBreakout 터틀 돌파 ↔ 서버 'turtle_high'
  18: 'turtle_high',
  // 클라 ID 21 = ocfQuality OCF 품질 ↔ 서버 'earnings_quality' (DART OCF)
  21: 'earnings_quality',
  // 클라 ID 24 = relativeStrength 상대강도 ↔ 서버 'relative_strength'
  24: 'relative_strength',
  // 클라 ID 25 = vcpPattern VCP ↔ 서버 'vcp'
  25: 'vcp',
};
```

**이전 매핑 (잘못됨)**:
| ID | 이전 서버 키 | 의미 (정정 후 해석) | 결함 |
|----|----|----|----|
| 9  | `'ma_alignment'` | notPreviousLeader (신규 주도주) ↔ ma_alignment | ❌ 의미 mismatch |
| 10 | `'volume_breakout'` | technicalGoldenCross ↔ volume_breakout | ❌ |
| 17 | `'relative_strength'` | psychologicalObjectivity ↔ relative_strength | ❌ |
| 18 | `'momentum'` | turtleBreakout ↔ momentum | ❌ |
| 20 | `'turtle_high'` | elliottWaveVerified ↔ turtle_high | ❌ |
| 25 | `'vcp'` | vcpPattern ↔ vcp | ✅ 유일 일치 |

### 3. 영속 데이터 마이그레이션 정책 — *보존 + 자연 회복*

사용자 명시 정책 (4/30) *"강제 마이그레이션 금지"* 정합:
- `data/attribution.json` / `data/shadow-trades.json` 의 기존 영속 데이터 *그대로 유지*
- 신규 매수 시점부터 정정된 매핑 사용 → 30 일 누적 후 자연 회복
- attribution 가중치 입력은 시간 가중 — 기존 오염 데이터의 영향이 *시간 경과로 자연 희석*
- 깊은 진단/마이그레이션 도구는 후속 PR (의도된 분리)

### 4. ENV 우회 — 본 PR 미도입

매핑 정정은 *드리프트 차단* 의무 작업. 클라이언트 SSOT 가 진실인 결정은 의문 없음. ENV 우회 패턴은 `evolutionEngine.ALL_CONDITIONS` 자체가 변경 가능한 SSOT 가 아니므로 (ADR-0018 PR-A 이후 27/27 안정) 우회 불필요.

만약 향후 클라이언트 SSOT 변경 시 본 ADR 갱신 + 회귀 테스트 자동 fail 로 drift 차단.

## 호출자 영향

### `serverConditionKey(conditionId)` 호출자 8개

모두 *추상화 conditionId* 만 사용 — 매핑 함수 내부 정정으로 자동 정합. 호출자 코드 변경 0:

1. `incrementalCalibrator.ts:62, 115` — 학습 가중치 보정
2. `signalCalibrator.ts:56` — 학습 가중치 보정
3. `phaseMapCalibrator.ts:94` — phase 별 학습
4. `weeklySharpeMonitor.ts:46` — 주간 Sharpe 모니터
5. `conditionBoostHints.ts:30` — 부스트 힌트
6. `failureToWeight.ts:227` — 실패 패턴 학습
7. `routes/systemRouter.ts:384` — HTTP `/api/learning/attribution`
8. `signalScanner/__tests__/conditionScoresWiring.test.ts:34` — 회귀 테스트 (서버 키 매핑 fallback 분기 검증, 정정 후 정합)

### `conditionIdFromServerKey(serverKey)` 호출자 1개

1. `entryConditionScores.ts:27` (`buildEntryConditionScores`) — 매수 시점 영속 핵심. 매핑 자동 정합으로 동작 변경 0줄.

### 동작 변화 시나리오

매수 시점 `conditionKeys = ['momentum', 'volume_breakout', 'turtle_high', 'vcp']` 입력:

**이전 매핑** (잘못됨):
- `'momentum' → ID=18` (서버 의미: 모멘텀 순위 — 클라 의미 ID=18=터틀 돌파, **mismatch**)
- `'volume_breakout' → ID=10` (서버 의미: 거래량 — 클라 ID=10=정배열, **mismatch**)
- `'turtle_high' → ID=20` (서버 의미: 터틀 돌파 — 클라 ID=20=엘리엇, **mismatch**)
- `'vcp' → ID=25` (✅ 유일 정합)

**정정 후**:
- `'momentum' → ID=2` (✅ 클라 의미 = 모멘텀 = 서버 의미)
- `'volume_breakout' → ID=11` (✅ 클라 의미 = 거래량)
- `'turtle_high' → ID=18` (✅ 클라 의미 = 터틀 돌파)
- `'vcp' → ID=25` (✅ 그대로)

→ 신규 영속 데이터부터 *27 ID 모두 클라 의미로 정합*. 학습 가중치 입력이 정확한 ID 에 누적.

## 회귀 테스트

`server/learning/conditionMappingFix.test.ts` (신규):

1. **27 ID drift 차단** — `CONDITION_NAMES[id]` 가 클라 SSOT (`evolutionEngine.ALL_CONDITIONS` 사본 또는 회귀 단언) 와 의미 정합
2. **CONDITION_TO_SERVER_KEY 8 키 정합** — 8 키 매핑이 클라 ID 의미 기준 (정정 후 매핑) 그대로
3. **buildEntryConditionScores 자동 정합** — `['momentum', 'volume_breakout', 'turtle_high', 'vcp']` 입력 시 결과 ID = 2, 11, 18, 25 (클라 의미)
4. **이전 매핑 회귀 차단** — `serverConditionKey(18) !== 'momentum'` (서버 의미 회귀)
5. **호출자 자동 정합** — 8 호출자가 변경 없이 정합 동작 (정적 grep 가드)

## 잔여 (PR-Phase0-MappingFix scope 외)

- **영속 데이터 진단 도구**: `/attribution_audit` 명령 — 기존 오염 데이터 비율 측정 후 운영자 마이그레이션 결정 입력
- **schemaVersion 격상** (선택): attribution v2 → v3 — 의미 분기 시 기존 데이터 보호
- **운영자 안내 텔레그램**: PR-Phase0 머지 직후 1회 발송 — *"본 PR 이전 attribution 데이터는 ID 의미 mismatch — 30 일 신규 데이터 누적 시 정합"*
- **Phase 1 (DART 마무리)**: PR-Phase0 머지 후 즉시 진입 — `performanceReality` (#15) + `economicMoatVerified` (#8) 격상 ~50 LoC
