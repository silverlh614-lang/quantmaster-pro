# ADR-0130 — Cumulative Reflection Context for Self-Learning

- Status: Accepted
- Date: 2026-04-30
- Related: ADR-0007 (Learning Feedback Loop Policy), ADR-0027 (Learning Shadow Model), ADR-0046 (F2W Drift Detector), ADR-0047 (Reflection Module Half-Life)

## Context

사용자 4/30 진단 (스크린샷 + 코드 audit 결합) 으로 자기학습 시스템이 *stateless* 임이 확정됐다.

### 7 가지 코드 레벨 증거

1. **`/learning_status` "내일 학습 포인트" = 어제 narrative 첫 문장 그대로 복사** — 누적 학습 부재의 직접적 시각 증거 (사용자 스크린샷 Image 1).
2. **7일 연속 RECENCY 1.00 / HERDING 0.99~1.00 / FOMO 0.80~1.00** — 매일 같은 입력에 같은 출력만 내는 stateless 함수 (스크린샷 Image 2).
3. **`MainReflectionInputs` 인터페이스 (mainReflection.ts:25) 에 `recentReflections` 필드 부재** — Gemini 가 매일 백지 상태에서 오늘만 본다.
4. **`failurePatternDB` 모듈은 존재 (`server/learning/failurePatternDB.ts` 190줄, TTL 180일)** 하지만 `nightlyReflectionEngine.ts` 가 호출 0건. 누적 패턴 DB 를 옆에 두고도 안 본다.
5. **`loadRecentReflections(3)` 은 `nightlyReflectionEngine.ts:496` 1곳에서만 사용** — 만성 참회 조건 감지 (텍스트 알림 전용). Gemini 의 narrative/learning point 생성 단계에는 0% 활용.
6. **`reflectionImpactRecorder.ts:9-10` 자기 코멘트 명시** — *"본 PR (Phase 1) 은 측정만 — 실제 silent/deprecated 가드 wiring 은 Phase 2 후속 PR"*. Phase 2 미실현.
7. **biasHeatmap 모든 점수 함수 stateless** — `scoreHerding`/`scoreRecency`/`scoreFomo` 가 *오늘 입력값 → 점수* 의 1회성 변환. 어제 점수와 비교/학습 0.

### 시스템 자기 인식

코드베이스가 자기 결함을 *알고 있다* — `reflectionImpactRecorder.ts` 헤더 자기 코멘트가 *"Phase 2 가 아직 안 왔다"* 명시. 본 ADR 은 *Phase 2 의 첫 단계인 입력 채널 활성화* 를 정착시킨다.

## Decision

3 Track 정책 SSOT 신설 (옵션 B — 회귀 위험 격리):

### Track 1 — PR-Diag (`/learning_loop_health` Telegram 명령)

자기학습 루프의 stateless 정도를 7개 지표로 정량화하는 진단 명령. 본 PR 의 Track 2/3 수정 후 *실제로 누적 학습이 되는지* 검증하는 도구이자, 향후 Phase 2 wiring (PR-Fix-3/4) 진입 의사결정 데이터.

**7 지표:**
1. **narrativeSimilarity7d** — 직전 7일 reflection narrative 의 Jaccard 유사도 평균 (외부 의존성 0). 0.7+ 면 STATELESS 의심.
2. **biasScoreVariance7d** — 7일간 각 BiasType score 의 분산. variance == 0 인 BiasType 카운트 노출 (0이면 stateless 확정).
3. **failurePatternIngestion** — `loadFailurePatterns().length` 활성 패턴 수 + nightlyReflection 가 ingestion 했는지 (Track 3 wiring 후 true).
4. **reflectionImpactPhase** — Phase 1 active=true, Phase 2 active=false (영구) + reason 텍스트 (코드 헤더 자기 코멘트 인용).
5. **tomorrowVsNarrativeOverlap7d** — *"내일 학습 포인트" == 어제 narrative 첫 문장* 일치 비율. 0.7+ 면 COPY_PASTE.
6. **signalScannerWeightLastUpdate** — `hasReflectionDriven=false` (영구 — `saveEvolutionWeights` 가 클라이언트 측에 있고 reflection 직접 호출 채널 부재) + reason 텍스트.
7. **silentVerdictRatio7d** — `dailyVerdict='SILENT'` 비율. 0.5+ 면 거래 fill 부재 = signalScanner ↔ autoTradeEngine 단절 의심.

**종합 verdict 4분기:** HEALTHY / DEGRADED / STATELESS / INSUFFICIENT_DATA. 사용자/운영자 1초 인지.

### Track 2 — PR-Fix-1 (recentReflections 주입)

`MainReflectionInputs` 인터페이스에 옵셔널 `recentReflections?: RecentReflectionContext[]` 추가. `nightlyReflectionEngine` 의 `mainInput` 빌드 시 `loadRecentReflections(7)` 호출 + 직전 7일 컨텍스트 propagate.

**RecentReflectionContext 시그니처:**
```ts
export interface RecentReflectionContext {
  date: string;                     // YYYY-MM-DD KST (오래된 → 최신 순)
  verdict: DailyVerdict;            // GOOD_DAY/MIXED/BAD_DAY/SILENT
  keyLessonsCount: number;
  tomorrowAdjustments: string[];    // text 필드만 추출 (sourceIds 제외 — 토큰 절약)
  biasTop3: Array<{ bias: BiasType; score: number }>;  // 점수 내림차순 Top 3
  narrativeFirstSentence?: string;  // narrative 첫 문장 (200자 상한)
}
```

**`mainReflection.formatNarrativeInput` 확장:**
- 신규 섹션 1: `📅 직전 7일 자기반성 누적 컨텍스트:` (날짜별 한 줄 요약 — verdict 이모지 + tomorrowAdjustments[0] + bias TOP3)
- 신규 섹션 2: `❓ 어제 너는 다음과 같이 조정한다고 했다: <어제 tomorrowAdjustments[0..2]>. 그것이 적용되었는가? 오늘 narrative 에서 *어제 약속의 결과* 도 함께 평가하라.`

**ENV 우회:** `LEARNING_RECENT_REFLECTIONS_DISABLED=true` (default false — 정책 적용)

**윈도우 정책 (7일):** 5거래일 + 주말 2일 자동 처리. `loadRecentReflections(days)` 가 부재 일자 자동 skip 하므로 신규 사용자 환경 graceful fallback (빈 배열 → narrative 섹션 미렌더).

### Track 3 — PR-Fix-2 (activeFailurePatterns 주입)

`failurePatternDB` 의 활성 패턴 (TTL 180일, 자동 필터) 을 nightlyReflection 의 mainInput 에 주입. *누적 실패 패턴이 active 중* 임을 Gemini 가 매일 인지.

**ActiveFailurePatternSummary 시그니처:**
```ts
export interface ActiveFailurePatternSummary {
  id: string;
  stockName: string;
  stockCode: string;
  exitDate: string;          // YYYY-MM-DD
  returnPct: number;         // 음수
  gate2PassCount?: number | null;
  marketRegime?: string | null;
  sector?: string | null;
}
```

**`mainReflection.formatNarrativeInput` 확장 (섹션 3):**
- `🚨 누적 실패 패턴 N건 active (최근 180일):` + Top 5 (exitDate 내림차순)
- 각 라인: `- [패턴:{id}] {stockName}({stockCode}) {returnPct}% @ {exitDate} {sector?} {marketRegime?}`

**Top-N 정책:** 5개 (exitDate 내림차순 — 최근 패턴 우선). 코사인 유사도 기반 매칭은 *오늘 candidate 가 있을 때만 의미가 있는 입력* 이라 본 PR scope 외 (`failurePatternDB.checkFailurePattern` 호출자는 signalScanner 본체 — 본 PR 무수정).

**ENV 우회:** `LEARNING_FAILURE_PATTERN_INPUT_DISABLED=true` (default false)

## Consequences

### 양성

- **stateless 결함 영구 차단** — Gemini 가 매일 *"어제 내가 한 약속" + "누적 실패 패턴"* 을 narrative input 으로 받음. 첫 문장 그대로 복사 영구 종결.
- **/learning_loop_health 진단 도구 정착** — 본 PR 후속 PR (PR-Fix-3/4 행동 변경 채널) 진입 시 *"수정 후 정말 누적 학습이 되는가"* 자동 검증.
- **failurePatternDB 활용도 격상** — TTL 180일 자동 필터 정책이 처음으로 학습 narrative 에 직접 활용.
- **Gemini 토큰 비용 미미** — recentReflections 7일 (각 ~200자) + activeFailurePatterns 5개 (각 ~80자) ≈ 추가 1.8KB / 호출. 1일 1회 cron 이라 부담 0.

### 음성

- **본 PR 은 *입력 채널만* — 행동 변경 0** — Gemini 의 narrative/keyLessons/tomorrowAdjustments 가 *과거를 인지* 해 다양해질 뿐, signalScanner 가중치 / Kelly multiplier / Gate 임계가 자동 조정되지 않는다. 사용자 행동 변화 채널은 *Phase 2 후속 PR (PR-Fix-3/4)* 에서.
- **biasHeatmap stateless 미해소** — 점수 함수 자체는 본 PR 에서 무수정 (행동 변경 채널 분리 정책). 후속 PR-Fix-4 가 stateful (7일 추세 + 페널티 적용 후 감소율) 로 격상.
- **reflectionImpactRecorder Phase 2 미활성** — 본 PR 은 측정만 (recordReflectionImpact). 실제 silent/deprecated 가드 wiring 은 후속 PR-Fix-3.

### 회귀 위험 격리

- 모든 신규 입력 옵셔널 (`recentReflections?` / `activeFailurePatterns?`) — 후방호환 보장
- ENV 우회 2종 — 운영 환경에서 즉시 롤백 가능
- LIVE 매매 본체 0줄 변경 (kisClient/orchestrator/signalScanner/autoTradeEngine 무수정)
- KIS/KRX 자동매매 quota 0 침범 (외부 호출 0건 — 영속 데이터 read-only 만)

## Non-Scope (후속 PR 분리)

- **PR-Fix-3** — `reflectionImpactRecorder` Phase 2 wiring (silent/deprecated 가드 → 실행 스킵 / 출력 억제). 행동 변경 채널.
- **PR-Fix-4** — `biasHeatmap` stateful 격상 (7일 추세 + 감소율 + 페널티). 점수 함수 수학 변경.
- signalScanner 가중치 자동 조정 (가장 위험 — 사용자 명시 검토 후 별도 ADR)
- Kelly multiplier 학습 결과 자동 반영
- Gate 임계 동적 조정

## Rollback Plan

- ENV `LEARNING_RECENT_REFLECTIONS_DISABLED=true` 설정 → Track 2 즉시 비활성 (narrative 섹션 1+2 미주입)
- ENV `LEARNING_FAILURE_PATTERN_INPUT_DISABLED=true` 설정 → Track 3 즉시 비활성 (narrative 섹션 3 미주입)
- `/learning_loop_health` 명령 자체는 read-only 진단 — 비활성화 불필요

## Validation

- 회귀 테스트 ≥ 30 케이스 (Diag 명령 7+ / Fix-1 15+ / Fix-2 8+) + ENV 우회 분기 + 기존 nightlyReflection 무회귀
- vitest server/learning + server/persistence + server/telegram
- lint(client + server tsc) + validate:all 12종 + ALLOW_DEPLOY_WINDOW=1 precommit

## References

- 사용자 4/30 진단 ("자기학습 시스템 진단 — 누적 실패 확정")
- 스크린샷 1: `/learning_status` narrative ≈ tomorrow's learning point (시각 증거)
- 스크린샷 2: `/learning_history` 7일 RECENCY 1.00 (stateless 시각 증거)
- 코드: `server/learning/reflectionModules/mainReflection.ts:25-39`, `server/learning/nightlyReflectionEngine.ts:429-437,496`, `server/learning/reflectionImpactRecorder.ts:9-10`, `server/learning/failurePatternDB.ts`
