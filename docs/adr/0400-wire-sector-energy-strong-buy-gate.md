# ADR-0400 — Wire SectorEnergyStrongBuyGate into Signal Decision Path

**상태**: 채택
**날짜**: 2026-05-06
**관련 ADR**: ADR-0398 (= 사용자 명시 ADR-0373) STRONG_BUY 4 조건 OR confidence gate SSOT / ADR-0399 KRX 원천 복구 + 4-axis 영속 writer / ADR-0396 5단계 dataQuality + 4-axis 분리 / ADR-0397 Yahoo ETF L4 fallback / ADR-0146 PR 자가 review / ADR-0157 ENV 정확 비교 / ADR-0185~0189 ENV 헬퍼 SSOT 위임 패턴

## 1. 컨텍스트

ADR-0398 (`server/trading/sectorEnergyStrongBuyGate.ts`) 가 `evaluateSectorEnergyStrongBuyGate()` 4 조건 OR SSOT 함수를 신설했지만 **호출자 0건 dead code** 상태였다. ADR-0399 (KRX 원천 복구) 후속 + ADR-0396 4-axis 영속 writer 활성으로 macroState 의 `sectorEnergyConfidence` / `sectorEnergyDataQuality` / `sectorEnergySourceTier` 3 필드 모두 영속 데이터 흐름이 정착됐다. 본 PR 은 그 데이터 흐름 위에서 **단일 STRONG_BUY 결정 지점** 에 게이트 wiring 을 활성화한다.

### 단일 STRONG_BUY 결정 지점

코드베이스 audit 결과 *외부 노출 STRONG_BUY 등급* 결정은 `server/trading/signalScanner/perSymbol/buyListLoop.ts:1130` 단일 위치에 집중되어 있다:

```ts
const isStrongBuy = gateScore >= 9;
```

이 boolean 이 다음 5 곳에 영향:
- 라인 1280~1283: kelly grade ('STRONG_BUY' | 'BUY' | 'PROBING' | 'HOLD')
- 라인 1342: 사이징 엔진 입력 signalGrade
- 라인 1416: rawSignalLevel: TradingSignal
- 라인 1466: isFinalStrongBuy → execQty 분할매수 비율
- 라인 1545 / 1554 / 1595: addRecommendation / recordAiCandidate / channelBuySignalEmitted 의 signalType

**나머지 STRONG_BUY 사용 위치는 *내부 사이징 입력* 에 한정** (외부 record 무영향):
- PRE_BREAKOUT_FOLLOWTHROUGH (라인 491/543/579) — sizing engine 입력은 'STRONG_BUY' 이지만 `addRecommendation({ ..., signalType: 'BUY' })` (라인 609) → 외부 등급은 BUY
- PRE_BREAKOUT 30% (라인 741/794) — 모두 BUY
- intradayLoop — STRONG_BUY 결정 부재

따라서 *외부 STRONG_BUY 승격 차단* 정책 (ADR-0398 의 의도) 은 **라인 1130 단일 wiring 으로 충분**.

## 2. 결정

### 2.1 wiring 위치 + 패턴

`buyListLoop.ts:1130` 의 `isStrongBuy` 를 `let` 으로 격상 후 직후 분기에서 ADR-0398 게이트 호출. `forbidStrongBuy === true` 시 `isStrongBuy = false` (강등) 만 수행 — *매수 차단 / continue / return 절대 금지*.

```ts
let isStrongBuy = gateScore >= 9;

// ── ADR-0400: STRONG_BUY → BUY 강등 (4 조건 OR) ─────────────────────
if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled()) {
  const m = ctx.macroState;
  const gateResult = evaluateSectorEnergyStrongBuyGate({
    confidence: typeof m?.sectorEnergyConfidence === 'number' ? m.sectorEnergyConfidence : 0,
    dataQuality: m?.sectorEnergyDataQuality ?? 'FAILED',
    sourceTier: m?.sectorEnergySourceTier ?? 'FAILED',
  });
  if (gateResult.forbidStrongBuy) {
    isStrongBuy = false;
    if (!m || m.sectorEnergyConfidence === undefined || m.sectorEnergyDataQuality === undefined || m.sectorEnergySourceTier === undefined) {
      console.log(
        `[SectorEnergyGate] macroState.sectorEnergy* 부재 — 보수 fallback 적용 (STRONG_BUY 차단) 종목=${stock.code}`,
      );
    }
    console.log(
      `[SectorEnergyGate] STRONG_BUY → BUY 강등 (사유: ${gateResult.reasons.join(', ')}) 종목=${stock.code} ${stock.name}`,
    );
  }
}
```

### 2.2 입력 매핑 SSOT

| 인자 | 출처 | 부재 시 fallback | 정합 ADR |
|------|------|----------------|--------|
| `confidence` | `ctx.macroState.sectorEnergyConfidence` | `0` (typeof guard) | ADR-0396 4-axis SSOT |
| `dataQuality` | `ctx.macroState.sectorEnergyDataQuality` | `'FAILED'` | ADR-0396 5-state union |
| `sourceTier` | `ctx.macroState.sectorEnergySourceTier` | `'FAILED'` | ADR-0396/0399 |

**보수 fallback 정책** — macroState 부재 또는 4-axis 영속 부재 (ADR-0396 격상 전 영속 데이터) 시 알 수 없는 상태 → STRONG_BUY 차단 (사용자 명시 정책 정합). NaN/Infinity confidence 도 ADR-0398 본체에서 동일 보수 fallback.

### 2.3 ENV 우회

- `SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED=true` (default OFF, 정확 비교 ADR-0157) — 회귀 발견 시 1줄 즉시 ADR-0398 dead code 동작 100% 복원.
- `isSectorEnergyStrongBuyGateWiringDisabled()` SSOT 헬퍼 — 호출자 측 inline ENV 검사 0건 (ADR-0185~0189 정합).

기존 ADR-0398 의 `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true` 는 **게이트 본체** 비활성 (4 조건 평가 자체 skip). 본 PR 의 `_WIRING_DISABLED` 는 **wiring** 비활성 (게이트 호출 자체 skip). 두 ENV 가 모두 활성 시 효과 동일 (강등 발생 0). 별도 운영을 위해 분리 — 게이트 본체는 정상이지만 wiring 결함만 격리하고 싶을 때 `_WIRING_DISABLED=true` 사용.

## 3. 절대 원칙 (ADR-0398 의 §"잘못된 해결 방법" 정합)

1. **일반 BUY 차단 금지** — 게이트는 *STRONG_BUY 등급 승격* 만 결정. wiring 분기 안에 `continue` / `return` 부재 (정적 grep 가드).
2. **STRONG_BUY → BUY 강등만 허용** — `isStrongBuy = false` 패턴만, 매수 자체는 그대로 진행.
3. **sectorBoost=0 ≠ 매수 차단** — sectorBoost 와 본 게이트 무관 (별개 정책 — ADR-0125 sectorScoreBoost).
4. **4 조건 OR 차단** (사용자 명시 절대 변경 금지) — confidence<0.6 / dataQuality='DEGRADED' / dataQuality='FAILED' / sourceTier='YAHOO_ETF'.
5. **LIVE 주문 함수 무수정** — KIS 주문 본체 0줄 변경 (절대 규칙 #2/#3/#4).
6. **ADR-0396/0397/0398 SSOT 무수정** — 본 PR 은 호출만 추가, 기존 SSOT 본체 변경 금지.
7. **ENV 우회 default OFF** — 회귀 위험 격리.
8. **호출자 측 inline ENV 검사 0건** — SSOT 헬퍼 위임.
9. **Yahoo ETF / KRX source restoration / UI 문구 / dataQuality 정책 무수정** — ADR-0399 / ADR-0398 정책 그대로.

## 4. 잘못된 해결 방법 영구 차단

1. **`forbidBuy` 같은 일반 BUY 차단 필드 도입 거부** — 절대 원칙 #1 위반. `StrongBuyGateResult` 에 forbidBuy/blockBuy/rejectBuy 부재 정적 가드.
2. **wiring 분기 안 `continue` / `return` 거부** — 절대 원칙 #2 위반. 정적 grep 가드 회귀 차단.
3. **PRE_BREAKOUT_FOLLOWTHROUGH 내부 sizing-engine STRONG_BUY 사용에 wiring 적용 거부** — 외부 등급 무영향 (recommendation 은 BUY 로 기록), 회귀 위험 격리.
4. **ADR-0398 본체 import 변경 거부** — 호출자만 추가, SSOT 본체 byte-equivalent.
5. **macroState 4-axis 영속 부재 시 통과 거부** — 보수 fallback (FAILED) 으로 STRONG_BUY 차단 (사용자 명시 정책 정합 — 알 수 없으면 차단).
6. **호출자 측 inline `process.env.SECTOR_ENERGY_*` 참조 거부** — SSOT 위임.

## 5. 회귀 테스트

`server/trading/sectorEnergyStrongBuyGateWiringAdr0400.test.ts` (신규 26 케이스):

**카테고리 1 — 정적 grep 가드 (drift 차단)**: 10 케이스
- `evaluateSectorEnergyStrongBuyGate` import 정확 1건
- `isSectorEnergyStrongBuyGateWiringDisabled` import 정확 1건
- 게이트 호출 정확 1건 (단일 STRONG_BUY 결정 지점)
- ENV 헬퍼 호출 정확 1건
- `let isStrongBuy` 격상 + `const isStrongBuy` 부재 회귀 가드
- inline `process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED` 참조 0건
- KIS 주문 함수 5종 import 0건 (gate 모듈 본체)
- ADR-0400 추적 주석 + "STRONG_BUY → BUY 강등" 어구
- `isStrongBuy = false` 강등 패턴 정확 1건
- wiring 분기 안 `continue` / `return` 부재 (절대 원칙 #1)

**카테고리 2 — 동작 매트릭스**: 6 케이스
- 정상 입력 (KRX_CODE + OK + confidence=0.8) → 통과
- 보수 fallback (confidence=0 + FAILED + FAILED) → 차단 + 다중 사유
- YAHOO_ETF 단독 차단 (조건 4)
- NaN confidence 보수 fallback
- Infinity confidence 보수 fallback
- ENV `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true` 시 게이트 비활성

**카테고리 3 — ENV gate 정확 비교 (ADR-0157)**: 4 케이스
- default OFF (ENV 미설정 → false)
- `'true'` → true
- `'1'` / `'TRUE'` / `'yes'` 모두 false (정확 비교)
- `'false'` / 빈 문자열 → false

**카테고리 4 — 회귀 격리 (절대 원칙)**: 6 케이스
- 함수 시그니처 forbidBuy/blockBuy/rejectBuy 부재
- wiring 분기 안 강등 패턴 정확 1건
- 진단 로그 [SectorEnergyGate] STRONG_BUY → BUY 강등 + 사유 + 종목코드/종목명
- macroState 부재 보수 fallback 진단 로그 별도 노출
- typeof guard (NaN/Infinity 안전)
- ADR-0398 SSOT 본체 무수정 (4 분기 + ENV gate 그대로)

## 6. 운영 효과

배포 직후 즉시 효과 (ENV default OFF — 정책 적용):

1. **STRONG_BUY 자동 강등** — sectorEnergy 가 (a) confidence < 0.6 / (b) DEGRADED / (c) FAILED / (d) YAHOO_ETF 4 조건 중 하나라도 충족 시 자동 STRONG_BUY → BUY 강등.
2. **외부 record 정합** — `addRecommendation` / `recordAiCandidate` / `channelBuySignalEmitted` 의 signalType 모두 BUY 로 기록 → 학습 데이터 정확도 격상.
3. **분할매수 비율 자동 조정** — `isFinalStrongBuy=false` → execQty 100% (분할 1차 50% 분할 진입 안 함). 보수 사이징 자연 적용.
4. **운영자 추적성** — `[SectorEnergyGate]` 진단 로그로 강등 사유 + 종목 즉시 인지. macroState 부재 시 별도 라인.
5. **일반 BUY 진입 영향 0** — 절대 원칙 #1 정합. sectorEnergy 약해도 일반 BUY 는 통과.

## 7. PR 자가 review 5 카테고리 (ADR-0146)

- **A. LIVE 매매 안전성** ✅ — KIS 주문 함수 5종 import 0건 / ENV 정확 비교 / 회귀 격리 / wiring 분기 안 매수 차단 0건.
- **B. wiring 완료 vs 인프라만** ✅ — 본 PR 은 *wiring 완료* (ADR-0398 dead code 종결). 호출자 0건 → 1건.
- **C. ADR 발급 무결성** ✅ — INDEX.md 0400 등재 + 다음 발급 0401.
- **D. 회귀 테스트 적정성** ✅ — 26 케이스 / 100 LoC 당 ≥5 (heuristic 충족, 실제 ~25/100 LoC).
- **E. 정책 위반** ✅ — validate:all 16종 baseline 무회귀.

## 8. 잔여 / 후속 PR (scope 외)

- **PRE_BREAKOUT_FOLLOWTHROUGH 내부 sizing-engine STRONG_BUY 사용** — 외부 record 무영향이지만 사이징 보수화 효과를 위해 후속 PR 에서 검토 가능 (회귀 위험 격리 — 별도 ADR + ENV gate 의무).
- **`/sector_energy_diag` 명령에 STRONG_BUY 강등 빈도 카운터 추가** — ADR-0398 §6 진단 명령 격상.
- **운영 데이터 누적 후 임계값 재조정 검토** — CONFIDENCE_GATE_THRESHOLD=0.6 / DEGRADED 차단 / YAHOO_ETF 차단 정책 운영 데이터 1~2개월 누적 후 재검증 (사용자 명시 절대 변경 금지 정책 보존, 변경 시 별도 ADR 의무).
