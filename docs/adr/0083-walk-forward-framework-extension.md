# ADR-0083 — Walk-Forward Framework 확장 (Rolling Windows + Regime 분리 + Decay)

**상태**: Accepted (2026-04-28)
**배경**: 사용자 P10 진단 — "Walk-forward 검증 구조는 있지만 약함 (단일 시점 1회 평가, Regime 분리 없음, Decay 측정 없음)"

## 기존 시스템

`server/learning/walkForwardValidator.ts` (173줄, ADR 미발행) 가 이미 작동 중:

- 매월 말 1회 실행 (`runWalkForwardValidation()`)
- IS = 90일전 ~ 60일전 / OOS = 최근 30일 단일 윈도우
- IS-OOS 승률 격차 > 15%p → 과최적화 경보 + 가중치 *동결* (`WALK_FORWARD_STATE_FILE`)
- LIVE 학습에 직접 영향 (calibrateSignalWeights 가 freeze 상태 확인)

장점: LIVE 안전망 작동. 단점: 단일 윈도우라 운 / 시점 의존, regime 별 성과 차이 불가시, alpha decay 추적 불가.

## 결정

기존 `walkForwardValidator.ts` 본체 *0줄 수정*. 새 framework `walkForwardFramework.ts` 를
**진단 + 통계 전용** 으로 분리 신설. LIVE 가중치/freeze 정책에 영향 없음.

### 신규 모듈

- **`server/learning/walkForwardFramework.ts`** — Rolling Window orchestrator (순수 함수 + 영속 호출).
- **`server/persistence/walkForwardResultsRepo.ts`** — `data/walk-forward-results.json` 영속 SSOT
  (기존 `WALK_FORWARD_STATE_FILE` freeze 상태와 *별개 파일* — 책임 분리).
- **`server/routes/walkForwardRouter.ts`** — `GET /api/learning/walk-forward` 진단 endpoint.
- **`server/telegram/commands/system/walkForward.cmd.ts`** — `/walk_forward [N]` (alias `/wf`).

### Rolling Window 정책 (default)

- IS (In-Sample) = 60일 / OOS (Out-of-Sample) = 30일 / Step = 7일
- 최소 표본 가드: IS ≥5 + OOS ≥5 (둘 중 하나 부족 시 윈도우 skip)
- 최대 윈도우 수: 24 (FIFO trim — 과거 24개 누적 = 약 6개월 슬라이딩)
- ENV 오버라이드: `WALK_FORWARD_IS_DAYS` / `WALK_FORWARD_OOS_DAYS` / `WALK_FORWARD_STEP_DAYS` /
  `WALK_FORWARD_MAX_WINDOWS`
- ENV 롤백: `WALK_FORWARD_FRAMEWORK_DISABLED=true` 시 framework 진입점 즉시 return (영속 미생성)

### WindowMetrics SSOT

```ts
interface WindowMetrics {
  sampleSize: number;       // closed (WIN+LOSS+EXPIRED) 표본
  winRate: number;          // wins / (wins + losses)  (EXPIRED 제외)
  avgReturn: number;        // 평균 actualReturn (%)
  totalReturn: number;      // 누적 수익률 (복리, %)
  sharpe: number;           // mean / stdev (단순 — 일별 무위험률 미고려)
  maxDrawdown: number;      // 누적 수익률 시계열의 최대 낙폭 (%)
}
```

표본 0건 시 모든 수치 0 + sampleSize=0 (false 판정 차단). NaN/Infinity 안전 fallback.

### Regime 분리 검증 (Phase 1 — 진단만)

`RecommendationRecord.entryRegime?` (PR-G ADR-0024) 사용. 윈도우 별로 entryRegime 그룹화 후
각 regime 의 IS/OOS WindowMetrics 산출. regime 별 표본 ≥3 시에만 노출 (표본 부족 시 'INSUFFICIENT').

알려진 regime 7값 (R1_TURBO / R2_BULL / R3_EARLY / R4_NEUTRAL / R5_CAUTION / R6_DEFENSE / UNKNOWN) +
실제 데이터에서 발견된 string 모두 누적.

### Alpha Decay 추적 (Phase 1 — 진단만)

`computeDecayTrend(windows)`:

- 최근 1/3 윈도우 vs 초기 1/3 윈도우 의 평균 OOS winRate 비교
- 격차 ≥ 5%p 악화 → 'DECAYING'
- 격차 ≤ -5%p 개선 → 'IMPROVING'
- 그 외 'STABLE'
- 표본 ≥6 윈도우 시에만 평가 (이하 'INSUFFICIENT')

### 텔레그램 진단 명령 `/walk_forward [N]` (alias `/wf`)

응답 형식 (N=10 기본, 1~24 범위):

```
🔬 Walk-Forward Framework — 최근 10 윈도우

전체:
  windows: 10/24 (slider 6개월)
  avgDegradation: -2.3%p (IS 평균 - OOS 평균)
  overfitFlagged: 1 (>15%p)
  decayTrend: STABLE

최근 윈도우 #20 (2026-04-21 ~ 2026-04-27):
  IS:  WR 64.3% (28건) avg +2.1%
  OOS: WR 60.0% (15건) avg +1.5%
  degradation: 4.3%p ✅

Regime 분리 (마지막 윈도우):
  R2_BULL:  IS 72% (18) → OOS 67% (12) ✅
  R5_CAUTION: IS 50% (8)  → OOS 33% (3) ⚠️
  R6_DEFENSE: 표본 부족
```

표본 부족 / framework 미실행 시 placeholder 메시지 + `/health` 안내.

## 영속 — `WALK_FORWARD_RESULTS_FILE`

`data/walk-forward-results.json`:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-28T...",
  "windows": [ /* WalkForwardWindow[] FIFO 24 */ ],
  "summary": { /* totalWindows, avgDegradation, decayTrend ... */ }
}
```

atomic write (tmp → rename) + 손상 JSON 빈 결과 fallback + 디스크 영속 1회만 (윈도우당 호출 X).

## LIVE 영향

- 기존 `walkForwardValidator.ts` 무수정 → freeze 정책 회귀 위험 0
- 신규 framework 는 *진단 전용*, LIVE weight 영향 0
- Yahoo OHLCV fetch 0건 — 영속 데이터(`recommendationTracker`) 만 사용 (사용자 ADR-0082 정합)
- KIS/KRX 자동매매 quota 0 침범

## 회귀 테스트 ≥30 케이스 신규

- `walkForwardResultsRepo.test.ts` 8 (영속 round-trip / FIFO trim / 손상 JSON fallback / 빈 / atomic / generatedAt)
- `walkForwardFramework.test.ts` 22 (computeWindowMetrics 5 / computeMaxDrawdown 4 /
  computeSharpe 3 / generateRollingWindows 3 / runWalkForwardFramework 4 / regime 분리 2 /
  computeDecayTrend 5)
- `walkForwardRouter.test.ts` 4 (정상 응답 / 빈 결과 / throw 500 / framework 미실행)
- `walkForward.cmd.test.ts` 5 (정상 응답 + N=5 / N=0 fallback / framework 미실행 / decay
  표시 / 빈 결과)

## 후속 PR (scope 외)

- 자동 weight 보정 (decay='DECAYING' 시 가중치 보수화) — 운영 데이터 누적 후
- Regime 별 별도 freeze 정책 (현재 freeze 는 글로벌)
- Yahoo OHLCV 추가 검증 (사용자 ADR-0082 와 충돌 — 별도 결정 필요)

## 참조

- 기존 `server/learning/walkForwardValidator.ts` (173줄, freeze 정책)
- ADR-0024 PR-G (RecommendationRecord.entryRegime)
- ADR-0082 (Yahoo range 정책 — fetch 0건 정합)
- 사용자 P10 진단 (2026-04-26)
