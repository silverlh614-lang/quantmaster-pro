# Gate 1 Threshold 진단 (통과율 저하 원인 분석)

> **상태: 진단 전용 (DIAGNOSIS ONLY).** 코드 무변경. `requiredScore = 70` 미변경.
> 운영자 실측 후 수정 여부 판단. 본 문서는 점수식 기반 *구조적* 진단이며 실측 분포가 아니다.
> 작성일 2026-05-27 · 브랜치 `claude/gate1-threshold-review-x1qfH`

---

## TL;DR

종목이 Gate 1을 잘 통과하지 못하는 **지배적 원인은 임계값 70 자체가 아니라, provider(수급/투자자) 데이터가
UNKNOWN/UNAVAILABLE일 때 점수 천장이 108 → 92로 붕괴하는 것**이다.

- 임계값 70은 **16점(SUPPLY_CONFLUENCE 8 + INVESTOR_FLOW 8)을 포함한 108 천장** 기준으로 고정돼 있다.
- provider가 흔들리면 이 16점은 "포기된 positive"로 증발한다 (음수 페널티 아님 — 불변식 #6 정합, 0점 처리).
- 그러면 70을 넘으려면 남은 92점 중 **76%**를 기술적 컴포넌트만으로 채워야 하고, 멀쩡한(약세 아님) 종목도
  60점대에 몰려 탈락한다.

즉 `04-gate-system.md`가 분류한 **SUPPLY_PROVIDER_UNKNOWN_PENALTY** 계열이다. **TRUE_GATE1_REJECTION(진짜 약한
신호)도, 임계값이 본질적으로 과도하게 빡센 것도 아니다.**

---

## 점수 구조 (server/trading/signalScanner/minimumSignalScoreTrace.ts:688–952)

| 컴포넌트 | 최대 점수 | provider/수급 UNKNOWN 시 |
|---------|----------|---------------------------|
| PRICE_MOMENTUM | 20 | 영향 없음 |
| TECHNICAL_TREND | 14 | 영향 없음 |
| VOLUME_LIQUIDITY | 12 | 영향 없음 |
| RELATIVE_STRENGTH | 10 | 영향 없음 |
| WATCHLIST_UPSTREAM_SCORE | 10 | 영향 없음 |
| BREAKOUT_STRUCTURE | 10 | 영향 없음 |
| WATCHLIST_PRIORITY | 8 | 영향 없음 |
| MARKET_REGIME | 6 | -6 (emergency stop 시) |
| **SUPPLY_CONFLUENCE** | **8** | **+8 → 0** (불변식 #6: bearish 변환 금지, 0점. `:810`) |
| **INVESTOR_FLOW** | **8** | **+8 → 0** (불변식 #4: supply와 dedup, 0점. `:669`) |
| SECTOR_ENERGY | 2 | -2 (diagnostic) |
| SESSION_STATUS / RISK_PENALTY / SOFT_FAIL_PENALTY | 0 / 0 / 0 | RISK −3 cap, SOFT_FAIL −5 (provider unknown 시 dedup으로 0) |

- **전체 천장 = 108점**, 임계값 70 = 천장의 **65%**
- **provider UNKNOWN 시 천장 = 108 − 16 = 92점**, 임계값 70 = 천장의 **76%**

### 임계값 출처 (런타임 노브)

`minimumSignalScoreTrace.ts:649`
```
const requiredScore = input.trace.minSignalRequiredScore
  ?? loadTradingSettings().buyCondition.minScoreThreshold;   // default 70
```
`server/persistence/tradingSettingsRepo.ts:44` → `minScoreThreshold: 70`.
LIVE 결정은 이 **flat 70**을 그대로 사용한다.

---

## 근본 원인 (불변식 정합 확인)

코드는 불변식을 *올바르게* 지키고 있다:
- UNKNOWN 수급을 음수 페널티(-8)가 아니라 **0점**으로 처리 (불변식 #6, `:810`)
- investor + supply가 같은 provider 루트로 UNKNOWN이면 **중복 페널티 제거**(dedup, `:669` `investorUnknown && supplyUnknown ? 0`)

문제는 코드 버그가 아니라 **임계값(70)이 16점이 항상 존재한다고 가정한 고정값**이라는 점이다. provider가 빈번히
UNKNOWN인 운영 현실(방대한 UNKNOWN 처리 인프라 자체가 방증)에서, 천장이 92로 줄면 70은 사실상 76% 컷이 된다.

---

## 이미 설계됐지만 LIVE 미연결인 해법

`server/trading/signalScanner/gate1FinalCalibration.ts:484` `buildActiveComponentRequiredScorePolicy`:
```
coverageAdjustment = (100 - activeCoveragePct) * 0.05      // 활성 컴포넌트 비율만큼 임계값 하향
clamp(70 - coverageAdjustment, hardFloor=50, hardCeiling=70)
```
**"활성 커버리지가 낮으면(provider 미가용) 임계값을 비례 하향"** — 70을 무작정 내리는 게 아니라 16점이 사라진 만큼
천장을 보정하는 접근. 단, 현재 전부 `liveExecutionAllowed: false`, `enableMode: 'DRY_RUN'`, `executionImpact: 'NONE'`
상태로 **진단/관측만 하고 LIVE 결정엔 미연결**이다.

---

## 한계 — 실측 분포 미확보

본 진단은 점수식 기반 **구조적** 진단이다. "실제로 몇 %가 SUPPLY_PROVIDER_UNKNOWN으로 탈락하는지" 실측 분포는
확보하지 못했다 (이 분석 환경에 라이브 KIS/provider 접근·저장된 스캔 데이터 없음). 실측은 운영 시스템에서 다음으로 확인:

- `/scan_blockers gate` — fresh 스캔 차단 사유 분포 (TRUE_GATE1_REJECTION vs DATA_UNAVAILABLE_DOMINANT)
- gate1 calibration audit / `gate1FinalCalibration` 리포트 — bestRepairedNetAvg, unknownDiagnosticNetAvg, threshold sweep, 생존자 수

확인 포인트: `trueFailRate`(분모에서 unavailable/error 제외) vs `unavailableRate`. **unavailableRate가 높으면
본 진단(provider coverage loss)이 확정**되고, trueFailRate가 높고 unavailableRate가 낮으면 진짜 임계값 재검토 대상.

---

## 권장 다음 단계 (의사결정 보류 중)

1. **운영 실측** — 위 명령으로 차단 사유 분포 확정 (provider coverage loss 가설 검증)
2. (실측이 가설 확정 시) **coverage-adjusted required score를 LIVE에 연결** — ADR 발급 + dry-run/shadow 3일 관측
   (생존자 수 / 1D·3D·5D forward return / false positive) + 회귀 테스트 + 운영자 승인. byte-equivalent: LIVE 매매
   본체 무변경, ENV 1줄 롤백, KIS/KRX quota 0 침범.
3. **대안** — provider VERIFIED 시 supply/investor 실제 신호를 복원하는 경로 점검 (이미 일부 구현됨,
   `gate1FinalCalibration.ts:320` `autoDisabledByProviderVerified`).

> 임계값 70 변경은 `04-gate-system.md:37` "절대 보존" 대상 — 데이터 검증 + ADR + 회귀 테스트 필수.
> 본 PR은 진단 문서만 추가하며 코드/임계값/매매 로직 0줄 변경.
