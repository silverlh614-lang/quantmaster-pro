# ADR-0412 — Frozen Quote Detector + Holiday-Aware R3 Streak Guard

- **Status**: Accepted
- **Date**: 2026-05-06
- **Authors**: engine-dev (사용자 명시 후속 PR — Defensive Cascade Failure 입력 데이터 layer 차단)
- **Series**: ADR-0401 (R3 Sanity Violation State Machine) 직속 후속

## 배경

ADR-0401 가 R3 sanity 의 *발동 조건 단계형 격상* (5단계 union + 5종 guard + 24h decay) 을 정착시킨 직후에도, 사용자 보고 *"상승장에서 매수 0건"* 시나리오가 반복되었다. Audit 결과 단일 결함이 아니라 다음 7개 보수 게이트 동시 발동이 가능했다:

1. Yahoo OHLCV `regularMarketPrice == previousClose == 같은 값` (frozen quote — 거래정지/관리종목/장외 시간대/제공자 stale)
2. 휴장일 직후 시간축 불일치 (5/1/5/5/12/25 cluster)
3. sectorEnergy DEGRADED (ADR-0396)
4. R3_EARLY GATE1_PASS_ZERO 단일 발생 → ADR-0401 SHADOW_ONLY pre-scan 차단
5. volumeClock false (점심·장외 시간대)
6. R3 streak 누적 (휴장일·blocked-day 도 +1 누적)
7. SHADOW_ONLY ephemeral 무한 진입 (decay 안 지나면 영구 차단처럼 동작)

**핵심 통찰** (사용자 명시) — *"가격 데이터가 얼어 있으면 시스템 결함이 아니라 데이터 품질 문제로 분류한다."*

본 ADR 은 ADR-0401 의 *의사결정 layer* 를 수정하지 않고, R3 가 *잘못된 입력 데이터를 먹지 않도록* 입력 데이터 oxidation 감지 + Holiday-aware streak skip 인프라만 추가한다.

## 결정

### 1. Frozen Quote Detector (입력 데이터 품질 SSOT)

신규 모듈 `server/trading/signalScanner/frozenQuoteDetector.ts` 신설.

#### 분류 결정 트리 (사용자 명시 절대 변경 금지)

```
입력: { symbol, currentPrice, previousClose, volume }[]

1. comparable count = currentPrice/previousClose 모두 양수 + 유한한 종목 수
2. comparable < 10 (MIN_COMPARABLE) → 'SUSPECT' + reason='INSUFFICIENT_COMPARABLE_QUOTES'
3. frozen 카운트 (volume>0 + |Δ|/prev ≤ EPSILON_PCT)
   - volume === 0 또는 거래량 미형성 → 보수적: frozen 카운트 제외 (volumeClock 거래량 0 종목 frozen 과잉 판정 회피)
4. frozenRatio = frozen / comparable
5. frozenRatio ≥ 0.3 (STALE_RATIO) → 'STALE'
6. frozenRatio ≥ 0.1 (SUSPECT_RATIO) → 'SUSPECT'
7. 그 외 → 'OK'
```

#### 임계값 SSOT (사용자 명시 절대 변경 금지)

| 상수 | 값 | 의미 |
| --- | --- | --- |
| `MIN_COMPARABLE` | 10 | 최소 비교 가능 종목 수 (이하 SUSPECT) |
| `SUSPECT_RATIO` | 0.1 | 10% 이상 frozen 시 SUSPECT |
| `STALE_RATIO` | 0.3 | 30% 이상 frozen 시 STALE |
| `EPSILON_PCT` | 0.0001 | currentPrice == previousClose 판정 허용 오차 (0.01%) |

#### 출력 (`FrozenQuoteResult`)

```typescript
{
  dataQuality: 'OK' | 'SUSPECT' | 'STALE',
  frozenCount: number,
  comparableCount: number,
  frozenRatio: number,        // 0~1
  reason: string,             // 진단 메시지
  symbols?: string[],         // frozen 종목 코드 (Top N, 진단용)
}
```

### 2. R3 State Machine Guard 확장 (옵션 A)

ADR-0401 `evaluateGuards` 의 5종 OR 체인에 `frozenQuoteDataQuality` 1종 추가. **결정 트리 본체 + 5단계 union + 24h decay 무수정**.

#### 평가 정책

```
guards.frozenQuoteDataQuality === 'STALE'   → hardBlockAllowed=false + reasons.push('FROZEN_QUOTE_STALE')
guards.frozenQuoteDataQuality === 'SUSPECT' → hardBlockAllowed=false + reasons.push('FROZEN_QUOTE_SUSPECT')
                                              (보수적: SUSPECT 도 hard block 금지)
guards.frozenQuoteDataQuality === 'OK' or undefined → 영향 없음 (ADR-0401 기존 5종 guard 만 평가)
```

본 ADR 의 핵심 invariant — 데이터 오염 상태에서는 **HARD_BLOCK_LATCH 격상 금지** (절대 원칙 #5).

### 3. Streak Increment Skip 정책 (Holiday-Aware)

`updateR3ViolationStreak` 호출자 측 (state machine 진입 직전) 에서 다음 조건 충족 시 *streak 증가 0* (`streakIncrementAllowed=false`):

| skipReason | 조건 | 정책 근거 |
| --- | --- | --- |
| `KRX_NON_TRADING_DAY` | `!isKrxTradingDay(today)` | KRX 휴장일/주말 — GATE1_PASS_ZERO 자연 발생 (절대 원칙 #6) |
| `VOLUME_CLOCK_CLOSED` | `volumeClockAllowsEntry === false` | 점심·장외 시간대 — 후보 평가 자체 부적합 (절대 원칙 #7) |
| `SELL_ONLY_MODE` | `sellOnlyMode \|\| manualBlockNewBuy \|\| manualManageOnly` | 운영자 정책 차단 — R3 결함 아님 |
| `BLOCKED_DAY_SCAN` | `R6_DEFENSE \|\| FOMC_BLOCK \|\| VIX_SPIKE` | 거시 게이트 차단 — 후보 평가 자체 미실시 |
| `FROZEN_QUOTE_STALE` | `frozenQuoteDataQuality === 'STALE'` | 입력 데이터 오염 — R3 진단 입력 부적합 |

skip 시:
- `consecutiveCount` 그대로 보존 (증가 0)
- `lastSeenAt` 갱신 0 (24h decay 정상 작동 보존)
- violation 자체는 진단으로 남기되 영속 streak 무영향
- ScanSummary 에 `r3StreakSkipped: { skipped: true, reason }` 옵셔널 영속

### 4. ScanSummary 옵셔널 필드 (후방호환)

`server/trading/signalScanner/scanDiagnostics.ts ScanSummary` 에 다음 옵셔널 추가:

```typescript
{
  // ...기존 필드
  frozenQuote?: FrozenQuoteResult;
  r3StreakSkipped?: { skipped: boolean; reason?: string };
}
```

`/scan_blockers` 메시지에 표시:
- `frozenQuote.dataQuality === 'STALE'` → 🔴 "Frozen Quote: STALE (35%, 7/20)"
- `frozenQuote.dataQuality === 'SUSPECT'` → 🟠 "Frozen Quote: SUSPECT (15%, 3/20)"
- `r3StreakSkipped.skipped === true` → ⏸ "R3 Streak: 누적 제외 — KRX_NON_TRADING_DAY"

UI 문구 정책 (사용자 명시):
- "매수 차단" 표현 **금지** (frozen quote 는 매수 차단이 아니라 데이터 품질 진단)
- "R3 hard block 누적 제외" 표현 사용

## 안전 invariant (절대 원칙 10종)

1. R3 Sanity 자체 유지 — `r3SanityCheck.ts` 본체 무수정.
2. **ADR-0401 상태머신 정책 변경 금지** — 5단계 union / 5종 guard 본체 / 결정 트리 / 24h decay 본체 무수정. 본 PR 은 guard 6번째 OR 추가만.
3. Frozen Quote Detector 는 *입력 데이터 오염 감지용* — 매수 직접 차단 0건. 신호는 R3 guard + streak skip 에 합성.
4. frozen quote 감지 시 *시스템 결함이 아니라 데이터 품질 문제* 로 분류 — 운영자 메시지에 "결함" / "에러" 표현 0건.
5. 데이터 오염 상태에서 R3 streak hard block 누적 0건 — guard `hardBlockAllowed=false`.
6. 휴장일/장외/volumeClock 비허용 GATE1_PASS_ZERO 시스템 결함 누적 0건 — streak increment skip.
7. Shadow learning 가능 — `recordBlockedDayShadowScan` 호출 보존.
8. **LIVE 주문 함수 / KIS 주문 함수 / order executor 수정 0줄** (절대 규칙 #2/#3/#4).
9. ENV 우회 최소화 — 본 PR 신규 ENV 0종 (회로 활성/비활성 ENV 미도입). 회귀 발견 시 코드베이스 자체 롤백 (PR revert) 또는 ADR-0401 의 `R3_VIOLATION_STREAK_DECAY_HOURS=0.001` ENV 활용.
10. 새 fallback 추가 0건 — 기존 데이터의 *품질 판정* 만 (Yahoo/KIS 새 호출 0건).

## 잘못된 해결 방법 영구 차단 (6종)

1. ❌ Frozen Quote 감지 시 매수 직접 차단 — 절대 원칙 #3 위반.
2. ❌ R3 5단계 union 확장 (FROZEN_QUOTE 신규 state) — 절대 원칙 #2 위반.
3. ❌ 24h decay 본체 변경 (예: frozen quote 시 1h decay) — 절대 원칙 #2 위반.
4. ❌ Streak increment skip 시 `lastSeenAt` 갱신 — 24h decay 자연 회복 차단.
5. ❌ Frozen quote 임계 ENV 화 — 사용자 명시 SSOT 변경 금지.
6. ❌ Yahoo/KIS 새 fallback 호출 — 절대 원칙 #10 위반.

## 회귀 테스트 (≥18 + 정적 가드 9 = 27 케이스)

### FrozenQuoteDetector 단위 (1~7)

1. 모든 가격 정상 (comparable=20, frozenCount=0) → OK
2. frozenRatio=0.15 → SUSPECT
3. frozenRatio=0.35 → STALE
4. comparable < 10 → SUSPECT + INSUFFICIENT (STALE 아님)
5. currentPrice/previousClose 누락 → comparable 제외
6. volume>0 + currentPrice===previousClose → frozen 카운트
7. EPSILON_PCT 이내 동일 → frozen 카운트

### R3 연동 (8~10)

8. frozenQuote STALE + GATE1_PASS_ZERO + R3_EARLY count=5 → hardBlockAllowed=false / HARD_BLOCK 격상 금지 / SHADOW_ONLY cap
9. frozenQuote SUSPECT + GATE1_PASS_ZERO → hardBlockAllowed=false / ELEVATED 이하
10. frozenQuote OK → ADR-0401 정책 100% 보존

### Holiday/blocked-day Streak (11~16)

11. volumeClockAllowsEntry=false → streak 증가 0
12. KRX 비거래일 → streak 증가 0
13. sellOnly mode → streak 증가 0
14. manual block / manage only → streak 증가 0
15. blocked-day shadow learning scan → shadow learning 유지 / streak 증가 0
16. 정상 거래일 + volumeClock open + frozenQuote OK → ADR-0401 streak 증가 정상

### scanDiagnostics 표시 (17~18)

17. frozenQuote STALE 표시 — frozenRatio + reason
18. r3StreakSkipped 표시 — skip reason

### 정적 grep 가드 (19~27)

19. frozenQuoteDetector.ts 가 KIS 주문 함수 5종 import 0건
20. frozenQuoteDetector.ts 가 autoTradeEngine import 0건
21. frozenQuoteDetector.ts 가 외부 API 직접 호출 0건 (fetch/axios/node-fetch 0건)
22. KIS 주문 경로 / order executor 수정 0건 (kisClient/orders.ts / orchestrator/autoTradeEngine 본체 git diff 0줄)
23. Weighted Violation Score 구현 부재 (사용자 명시 제외)
24. Cold Start Probe 구현 부재 (사용자 명시 제외)
25. Gate Voting Quorum 구현 부재 (사용자 명시 제외)
26. Counterfactual Shadow 연결 부재 (사용자 명시 제외)
27. Half-Open 자동 해제 구현 부재 (사용자 명시 제외)

## 후속 작업 (scope 외)

- **Cascade Detection** — 7개 보수 게이트 중 N개 이상 동시 발동 시 *Cascade Mode* 전환 + 운영자 텔레그램 통합 진단 (Cascade ID 부착).
- **Shadow Mode Relaxation** — SHADOW only 운영 시 R3 hard block latch 자동 비활성화 (학습 데이터 보존 우선) — 별도 ENV / ADR.
- **Market Gap Meta-Signal** — 휴장 직후 첫 거래일 frozen quote 발생률이 평소 대비 높음을 사전 감지하여 SUSPECT 임계 자동 완화.
- **Cold Start Probe** — 부팅 직후 macroState/sectorEnergy 미수집 상태에서 R3 sanity 평가 자체 skip (별도 ADR).
- **Source Heterogeneity** — Yahoo/KIS/KRX 다중 출처 비교로 frozen 판정 정확도 격상.
- **Quorum** — Gate1~3 통과 분포의 다수결 voting 도입.

## 호환성

- ADR-0120 — `r3SanityBlockRepo` 영속 latch 본체 무수정. 운영자 명시 확인 정책 보존.
- ADR-0195 — `/r3_unblock` 명령 본체 무수정.
- ADR-0401 — state machine 결정 트리 / 5단계 union / 24h decay / Profile SSOT 모두 무수정. Guard 5종 → 6종 OR 확장 1줄만.
- ADR-0146 PR 자가 review 5 카테고리 모두 PASS.
- ADR-0148 4 정적 검증 baseline 무회귀.
- ADR-0157 정확 비교 의무 (본 PR ENV 미도입이라 무관, 후속 ENV 추가 시 정합 의무).
