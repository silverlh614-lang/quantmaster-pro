# ADR-0086 — Shadow Walk-Forward Framework (Rejection + Twin IS/OOS 분할)

**상태**: Accepted (2026-04-28)
**배경**: 사용자 분석 — Shadow 학습 다음 단계 #4 *"Shadow 데이터도 in-sample / out-of-sample
로 나눠야 함. 그렇게 해야 Shadow 학습도 과최적화를 피할 수 있음."*

## 문제

PR-A (ADR-0083) `walkForwardFramework` 가 LIVE `recommendationTracker` records 만
IS/OOS 분할. 그러나 PR-L `rejectionShadowTracker` (Gate 14~17 near-miss 거절 종목
사후 추적) + PR-M `counterfactualTwinPortfolio` (AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT
3 Twin) 의 Shadow 영속 데이터는 IS/OOS 분할 검증 미진행.

→ Shadow 학습이 *데이터 수집* 단계에서 *Decision Integration* 단계로 진입하려면 시간 분할
검증이 필수. Shadow 데이터도 단일 시점 운에 의존 안 하도록 Rolling window + Decay 추적.

## 결정

`walkForwardFramework.ts` 본체 *0줄 수정*. 신규 framework `shadowWalkForwardFramework.ts`
**진단 + 통계 전용** 으로 분리. LIVE 가중치/freeze/sizing 정책 영향 없음.

### 신규 모듈

- **`server/learning/shadowWalkForwardFramework.ts`** — Rolling Window orchestrator
  + adapter (`rejectionToWindowRecord` / `twinToWindowRecord`) + 통계 산출
- **`server/persistence/shadowWalkForwardResultsRepo.ts`** — 별도 영속
  (`data/walk-forward-shadow-results.json`) — `WALK_FORWARD_RESULTS_FILE` (LIVE) 와 책임 분리
- **`server/routes/learningRouter.ts`** — `GET /api/learning/shadow-walk-forward` +
  `POST /shadow-walk-forward/run?source=REJECTION|TWIN|ALL`
- **`server/telegram/commands/system/shadowWalkForward.cmd.ts`** —
  `/shadow_walk_forward [N]` (alias `/swf`)

### Adapter 설계

Shadow 두 source 의 record 를 walk-forward 산출 가능한 공통 형태(`ShadowWindowRecord`)로 변환:

```ts
interface ShadowWindowRecord {
  closedAt: string;         // signalDate (시간 분할 기준)
  returnPct: number;        // currentReturnPct
  status: 'CLOSED' | 'PENDING' | 'OPEN';
  isWin: boolean;
  source: 'REJECTION' | 'TWIN';
  twin?: TwinKey;           // TwinEntry 만
}
```

- **Rejection**: `currentReturnPct ≥ 5%` (REJECTION_FALSE_NEG_THRESHOLD_PCT) 시 *isWin=true*
  (alpha 누락 = false negative). 해석: "거절했지만 +5% 이상 갔다 = 우리가 너무 엄격했다".
- **Twin**: `currentReturnPct > 0` 시 *isWin=true*. 해석: "이 Twin 정책이 양수 수익률".

### Rolling Window 정책 (default — `walkForwardFramework` 정합)

- IS 60일 / OOS 30일 / Step 7일 / maxWindows 24 (FIFO)
- 표본 가드: IS ≥5 + OOS ≥5
- Overfit 임계 15%p (degradation > 15) — 동일
- Decay 임계 5%p (최근 1/3 vs 초기 1/3)
- ENV 오버라이드: `SHADOW_WALK_FORWARD_IS_DAYS` / `SHADOW_WALK_FORWARD_OOS_DAYS` /
  `SHADOW_WALK_FORWARD_STEP_DAYS` / `SHADOW_WALK_FORWARD_MAX_WINDOWS`
- ENV 롤백 `SHADOW_WALK_FORWARD_DISABLED=true` → 진입점 즉시 return

### `windowId` prefix 분리

LIVE walk-forward (`walkForwardFramework`) 의 `windowId` 와 충돌 차단을 위해 Shadow 결과는
`'shadow_'` prefix. 영속 파일도 별도 (`WALK_FORWARD_SHADOW_RESULTS_FILE`).

### 텔레그램 진단 명령 `/shadow_walk_forward [N]` (alias `/swf`)

응답 형식 (N=10 기본):

```
🌑 Shadow Walk-Forward — 최근 10/24 윈도우 (Rejection + Twin)

📊 전체 요약:
  • avgDegradation: -2.3%p (IS - OOS)
  • medianDegradation: -1.5%p
  • overfitFlagged: 1 (>15%p)
  • decayTrend: 🟡 STABLE

📌 최근 윈도우 (2026-04-21 ~ 2026-04-27):
  • IS:  WR 32.5% (28건) avg +1.8% / total +12.4%
  • OOS: WR 28.0% (15건) avg +1.2% / total +5.1%
  • degradation: 4.5%p ✅

📁 windowId prefix='shadow_' (LIVE 결과는 /walk_forward 별도)
```

표본 부족 / framework 미실행 시 placeholder.

## LIVE 영향

- `walkForwardFramework.ts` (LIVE) 본체 무수정 → freeze 정책 회귀 위험 0
- 신규 framework 는 *진단 전용*, LIVE weight 영향 0
- Yahoo OHLCV fetch 0건 (영속 Shadow records 만 사용 — ADR-0082 정합)
- KIS/KRX 자동매매 quota 0 침범

## 회귀 테스트 ≥30 케이스 (실제 44)

- `shadowWalkForwardResultsRepo.test.ts` 7 (영속 round-trip / FIFO trim / 손상 fallback /
  schema 호환 / clear / append idempotent / 빈 결과)
- `shadowWalkForwardFramework.test.ts` 24 (adapter 8 + windowMetrics 2 + summary 3 +
  진입점 7 (DISABLED / NO_RECORDS / 합산 / source REJECTION 한정 / source TWIN 한정 /
  ENV / fallback) + threshold 4)
- `shadowWalkForwardRouter.test.ts` 8 (GET 정상/빈/disabled/throw 500 + POST 정상/source
  propagate/skipped/throw 500)
- `shadowWalkForward.cmd.test.ts` 9 (formatShadowWalkForwardMessage 5 분기 + cmd execute 4)

## ENV 롤백 5종

| ENV | Default | 효과 |
|-----|---------|------|
| `SHADOW_WALK_FORWARD_DISABLED` | false | true 시 진입점 return |
| `SHADOW_WALK_FORWARD_IS_DAYS` | 60 | IS 윈도우 일수 오버라이드 |
| `SHADOW_WALK_FORWARD_OOS_DAYS` | 30 | OOS 윈도우 일수 |
| `SHADOW_WALK_FORWARD_STEP_DAYS` | 7 | 슬라이딩 step |
| `SHADOW_WALK_FORWARD_MAX_WINDOWS` | 24 | FIFO 한계 |

## 후속 PR (사용자 분석 Shadow 학습 다음 단계 #1~#3)

- PR-E (#1+#2 가시화) — 텔레그램 `/rejected` + `/twins` Leaderboard + 일일 리포트 라인
- PR-F (#3 Shadow → Condition Attribution) — `rejectionShadowTracker` schema 확장
  (conditionScores 저장) + Over-Strict / Good Defense 분류 SSOT
- PR-G UI Dashboard — Shadow Learning 5종 카드 (Missed Alpha / Good Rejection /
  Twin Ranking / Over-Strict / Good Defense)

## 참조

- ADR-0083 walkForwardFramework (LIVE recommendations)
- PR-L (rejectionShadowTracker, Gate 14~17 near-miss 5영업일 추적)
- PR-M (counterfactualTwinPortfolio, AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT 30일 추적)
- ADR-0082 (Yahoo range 정책 — fetch 0건 정합)
- 사용자 분석 (2026-04-28 Shadow 학습 다음 단계 #4)
