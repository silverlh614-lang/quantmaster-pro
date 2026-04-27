# ADR 0047 — Reflection Module Half-Life — 자기학습 반성 모듈 자연선택 (PR-Y2)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0007 (Learning Feedback Loop Policy), ADR-0046 (F2W Drift Detector), ADR-0041 (Weekly Self-Critique)

## 배경

사용자 4 아이디어 중 2번:

> 13개의 reflection 모듈이 모두 평등하게 가치 있을까? 각 모듈이 생산한 권고 중
> "실제 가중치/포지션에 영향을 준 비율" 을 6개월 추적. 영향률 5% 미만 모듈은
> 자동 격리(silent), 1% 미만이면 deprecated 플래그. **반성도 비용이다.** CH4
> JOURNAL 노이즈를 줄이는 동시에 모듈의 자연선택 메커니즘.

(사용자 원안의 "18 모듈" 은 추정치 — 실제 audit 결과 13개 reflection 모듈)

`nightlyReflectionEngine.ts` 가 매일 KST 19:00 13개 모듈을 일괄 호출:

| # | 모듈 | 출력 |
|---|------|------|
| 1 | mainReflection | dailyVerdict + keyLessons + questionableDecisions + tomorrowAdjustments |
| 2 | reflectionGemini | (mainReflection 의 Gemini 호출 헬퍼) |
| 3 | personaRoundTable | personaReview |
| 4 | fiveWhy | fiveWhy[] (HIT_STOP 거래) |
| 5 | counterfactual | reflections[] |
| 6 | conditionConfession | confession[] |
| 7 | regretQuantifier | regret |
| 8 | biasHeatmap | biasScores |
| 9 | experimentProposal | proposals[] |
| 10 | narrativeGenerator | narrative |
| 11 | manualExitReview | manualExits[] |
| 12 | metaDecisionJournal | journal |
| 13 | weeklyReflectionAudit | weeklyAudit (주간) |

13개 모두 평등하게 매일 실행 — Gemini 호출 비용 + CH4 노이즈 누적. 어떤 모듈이
실제로 시스템 가치에 기여하는지 측정 부재.

## 결정

**Reflection Module Half-Life** 신설 — 각 모듈의 *영향률* 을 영속 추적하고,
임계 미달 시 자동 silent / deprecated 분기.

### 1. "영향(Impact)" 정의

**meaningful=true**: 모듈이 호출되어 실제 권고/heatmap/narrative 를 생성했을 때.

| 모듈 | meaningful 판정 |
|------|----------------|
| mainReflection | `result != null && (keyLessons.length > 0 \|\| questionableDecisions.length > 0)` |
| personaRoundTable | `result != null` |
| fiveWhy | `results.length > 0` |
| counterfactual | `reflections.length > 0` |
| conditionConfession | `confession.length > 0` |
| regretQuantifier | `result != null` |
| biasHeatmap | `Object.values(scores).some(s => s >= 0.5)` |
| experimentProposal | `proposals.length > 0` |
| narrativeGenerator | `result != null && result.length > 0` |
| manualExitReview | `manualExits.length > 0` |
| metaDecisionJournal | `journal != null && journal.entries.length > 0` |
| weeklyReflectionAudit | (주간만, 별도 카운트) |

빈 배열 / null / undefined / 임계 미달은 `meaningful=false` (silent run).

### 2. 영속 SSOT — `server/persistence/reflectionImpactRepo.ts`

```ts
interface ReflectionImpactRecord {
  date: string;          // YYYY-MM-DD KST
  module: string;        // 'mainReflection' / 'biasHeatmap' / ...
  meaningful: boolean;
  capturedAt: string;    // ISO
}
```

- 파일: `data/reflection-impact.json`
- atomic write (tmp → rename)
- 1년 (365일) ring buffer trim
- API:
  - `recordReflectionImpact(module, date, meaningful, now?)`
  - `loadReflectionImpactRecords(): ReflectionImpactRecord[]`
  - `getModuleStats(module, days?, now?): { runs, meaningfulRuns, impactRate, firstSeenAt }`

### 3. 정책 SSOT — `server/learning/reflectionImpactPolicy.ts`

```ts
type ModuleStatus = 'normal' | 'grace' | 'silent' | 'deprecated';

function getModuleStatus(
  module: string,
  now?: Date,
  opts?: { windowDays?: number; gracePeriodDays?: number }
): ModuleStatus;
```

기본 임계 (사용자 원안):

| Status | 조건 | 효과 |
|--------|------|------|
| `grace` | firstSeenAt < 30일 전 | 평가 대상 외 (정상 실행) |
| `deprecated` | 영향률 < 1% (180일 윈도우) | 실행 자체 스킵 |
| `silent` | 영향률 < 5% (180일 윈도우) | 실행은 하되 CH4 출력 억제 |
| `normal` | 영향률 ≥ 5% | 정상 실행 + 출력 |

표본 가드: 윈도우 내 runs < 20건이면 status='grace' (false positive 차단).

ENV 롤백: `LEARNING_REFLECTION_HALFLIFE_DISABLED=true` → 모든 모듈 'normal'
강제 (회로 무력화).

### 4. 정책 적용 지점 (`nightlyReflectionEngine` wiring)

각 모듈 호출 위치마다:

```ts
// 1. 정책 조회
const status = getModuleStatus('mainReflection');

// 2. deprecated 면 스킵
if (status === 'deprecated') {
  recordReflectionImpact('mainReflection', date, false);
  // 실행 자체 안 함
} else {
  // 3. 정상 실행
  const result = await generateMainReflection(...);
  const meaningful = result != null && (result.keyLessons?.length > 0 || ...);
  recordReflectionImpact('mainReflection', date, meaningful);

  // 4. silent 면 report 에 채우지 않음 (CH4 출력 억제)
  if (status !== 'silent' && meaningful) {
    report.dailyVerdict = result.dailyVerdict;
    // ...
  }
}
```

### 5. 운영자 진단 endpoint

`GET /api/learning/reflection-impact` — 모든 모듈의 status + impactRate +
runs / meaningfulRuns 반환. 후속 PR 에서 텔레그램 명령 (`/reflection_impact`)
및 silent/deprecated 모듈 운영자 수동 unpin 명령 (`/reflection_pin <module>`).

### 6. 명시적 비결정

- 모듈 *부활* 메커니즘 (deprecated → normal 자동 복귀): 영향률이 6개월 후 다시
  올라가면 자동 normal 복귀 — 정책 SSOT 가 매번 새로 계산하므로 영속 flag 불필요
- 운영자 수동 override (`/reflection_pin <module>` 명령): 후속 PR
- silent 모듈의 CH4 출력 억제 형태: 본 PR 은 report 객체에 채우지 않는 단순 방식,
  완전 제거(필드 자체 미존재) 또는 ⏸️ 표식 후속 결정

## 후방호환

- 첫 도입 시점에 영향 데이터 0건 → 모든 모듈 'grace' status → 기존 동작 유지
- 30일 grace period + 20건 표본 가드로 점진 적용
- `LEARNING_REFLECTION_HALFLIFE_DISABLED=true` 환경변수 즉시 회로 무력화
- 영속 파일 손상 시 빈 배열 fallback (시스템 무중단)

## 사용자 한 줄

**반성도 비용이다.** 모든 반성이 평등하게 가치 있는 게 아니라면, 자연선택은
시스템에도 적용되어야 한다.
