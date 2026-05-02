# ADR-0171 — `[Sizing-ExposureBudget]` 진단 로그 10 필드 SSOT formatter (사용자 §4 권장)

**상태**: Accepted
**날짜**: 2026-05-02
**관련 PR**: PR-Sizing-ExposureBudget-VerboseLog
**의존성**: ADR-0166 (레짐 노출 예산 7 매트릭스), ADR-0167 (currentEquityExposure 정확 산출), ADR-0170 (R1_DEFENSIVE 자동 격상)
**관련 audit/사용자 요청**: 사용자 §4 — *"진단 로그 10 필드 출력 (현재 4 필드 / 6 필드 미출력)"*

## 1. 문제

ADR-0166 §3 의 `applyExposureBudgetCap` 통합 진입점은 `PortfolioExposureBudget` (10+ 필드) 와 `ApplyPortfolioExposureCapResult` (cappedByExposureBudget 등) 를 모두 산출하지만, 4 호출 site (buyListLoop 3 + intradayLoop 1) 의 `[Sizing-ExposureBudget]` `console.log` 는 *4 필드만* 출력 (code/name/qty/raw/blockReason — 메인 buyList 만 regime 포함).

사용자 명시 §4 권장 10 필드 중 **6 필드 미출력**:

1. `targetEquityExposurePct` — 레짐별 목표 노출 비중 (정책 SSOT)
2. `maxEquityExposurePct` — 절대 한도
3. `currentExposurePct` — 현재 보유 비중
4. `remainingBuyBudgetToTarget` — 목표까지 매수 가능 금액
5. `remainingBuyBudgetToMax` — 한도까지 매수 가능 금액
6. `cappedByExposureBudget` — cap 활성 여부 (운영자 즉시 인지 핵심 신호)

진단 시 `data/peak-equity.json` + `applyExposureBudgetCap` 결과 객체 직접 조회 필요 — Railway 로그만으로 *왜* cap 됐는지 추적 불가능.

또한 4 site 모두 inline 문자열 합성 — drift 위험 (한 site 만 형식 변경 시 grep 실패).

## 2. 결정

### 2.1 SSOT formatter — `formatExposureBudgetLog(input)`

`server/trading/sizing/regimeExposurePolicy.ts` 에 4 호출 site 공통 SSOT formatter 도입. 본 함수는 *문자열만 합성* — `console.log` 발행 책임은 호출자.

**우선순위 SSOT** (3 분기):

1. **budget 부재** (ENV OFF / INPUT_MISSING) → 경량 한 줄: `code name (path) → qty=N (raw=M) blockReason`. regime 포함 안 함 (budget 없으니 산출 불가).
2. **budget 존재 + verbose OFF** (default) → 4 필드 byte-equivalent: `code name (path) → regime=R3 qty=N (raw=M) blockReason`. 기존 4 site 동작 100% 보존.
3. **budget 존재 + verbose ON** (사용자 §4 권장) → 10 필드: `code name (path) → regime=R3 targetPct=45% maxPct=50% currentPct=40.00% toTarget=4500000원 toMax=5000000원 cappedByBudget=true qty=N (raw=M) blockReason`.

`pathLabel` 옵셔널 (4 path 분류: `PRE_BREAKOUT_FOLLOWTHROUGH` / `PRE_BREAKOUT 30%` / `INTRADAY_STRONG` / 메인=undefined).
`verboseOverride` 옵셔널 — ENV 무관 강제 활성/비활성 (테스트 + 운영자 일회 진단).

### 2.2 ENV gate — `SIZING_EXPOSURE_BUDGET_VERBOSE_LOG`

```ts
export function isExposureBudgetVerboseLogEnabled(): boolean {
  return process.env.SIZING_EXPOSURE_BUDGET_VERBOSE_LOG === 'true';
}
```

**default OFF** — 본 PR 머지 직후 *기존 동작 100% 보존* (4 필드만 출력, Railway 로그 비용 변화 0).

운영자 진단 시점에만 ENV `=true` 활성화 — 종목당 약 80~100 byte 추가 로그 (verbose ON 시).

### 2.3 4 호출 site wiring (drift 차단)

- `server/trading/signalScanner/perSymbol/buyListLoop.ts` 3 곳 (PRE_BREAKOUT_FOLLOWTHROUGH 라인 ~401 + PRE_BREAKOUT 30% 라인 ~615 + 메인 buyList 라인 ~1158)
- `server/trading/signalScanner/perSymbol/intradayLoop.ts` 1 곳 (INTRADAY_STRONG 라인 ~157)

모두 `formatExposureBudgetLog({ stockCode, stockName, pathLabel?, rawQuantity, finalQuantity, budget, capResult })` 1줄로 교체. inline 문자열 합성 패턴 영구 차단.

### 2.4 default OFF 결정 사유

- **로그 비용**: verbose ON 시 종목당 약 80~100 byte 추가. 1 cron tick 당 평균 5~10 cap 알림 → 24h 약 5~10 KB. Railway 로그 quota 미세하지만 *상시 활성화 가치 vs 비용* 운영자 결정.
- **사용자 인지 부하**: 메시지 길이 ↑ → 모바일 텔레그램 가독성 ↓ (단, `[Sizing-ExposureBudget]` 은 stdout only 라 텔레그램 발송 안 함 — Railway 로그 전용).
- **회귀 위험**: ENV OFF default 시 기존 4 필드 byte-equivalent → 외부 모니터링 도구 (로그 파싱 grep) 회귀 0.

## 3. 결과

- 운영자가 ENV 1줄 (`SIZING_EXPOSURE_BUDGET_VERBOSE_LOG=true`) 으로 즉시 진단 모드 진입 → cap 발동 시 *왜 cap 됐는지* (현재 노출 % vs 목표/한도) 즉시 인지.
- 4 호출 site SSOT 통합 → 향후 형식 변경 시 1 위치 수정 (drift 차단).
- 정적 grep 가드 6 케이스 (호출 수 / 인라인 합성 부재 / pathLabel 정확 / ADR 추적 주석) — 회귀 영구 차단.
- LIVE 매매 영향 0 — `console.log` 형식 변경만, sizing 결정/quantity/주문 본체 무수정.

## 4. 잘못된 해결 방법 영구 차단

1. **호출자 측 4 site 직접 격상** 거부 — drift 위험 + ENV gate 분산 + SSOT 위반.
2. **ENV default ON** 거부 — 로그 비용 운영자 결정 위임 (회귀 위험 격리).
3. **`PortfolioExposureBudget` schema 변경** 거부 — 본 PR 은 *출력 layer* 만, 데이터 layer 무변경.
4. **텔레그램 알림으로 격상** 거부 — 4 cron tick × 5~10 cap 발동 = 텔레그램 폭주. Railway 로그 stdout 만 사용 (`/scan_blockers` 같은 진단 명령에서 별도 출력 검토).

## 5. 검증

- 회귀 테스트 25 케이스 (`exposureBudgetLogFormatAdr0171.test.ts`) — ENV 분기 4 + 분기 1 (budget 부재) 3 + 분기 2 (default 4 필드) 3 + 분기 3 (verbose 10 필드) 7 + 호출자 정합 정적 가드 6 + 통합 시나리오 2.
- 호출자 정합 정적 가드 — buyListLoop 3 호출 + intradayLoop 1 호출 + inline 문자열 부재 + ADR 주석 추적성.
- 인접 무회귀 — server/trading/sizing 10 files 238/238 + signalScanner 36 files 380/380 모두 pass.

## 6. 운영자 활성화 절차

1. 본 PR 머지 직후 — default OFF, 기존 동작 100% 보존.
2. 진단 필요 시 `SIZING_EXPOSURE_BUDGET_VERBOSE_LOG=true` ENV 추가 → Railway 재배포 또는 자동 hot-reload.
3. cap 발동 종목의 `targetPct/currentPct/cappedByBudget` 즉시 인지 → `data/peak-equity.json` 수동 조회 부담 ↓.
4. 진단 종료 시 ENV 제거 → default 4 필드 자동 복원.

## 7. 후속 PR (scope 외)

- `cappedByBudget=true` 발동 빈도 누적 텔레메트리 (별도 영속 + `/scheduler` 진단 명령) — 운영 데이터 누적 후 결정.
- `PortfolioExposureBudget.label` (한국어 레짐 라벨) 노출 추가 — UI 측 정합 후 결정.
- ADR-0167 currentPriceMap (KIS 시가 평가) wiring 후 `currentExposurePct` 정확도 격상 — 별도 PR.
