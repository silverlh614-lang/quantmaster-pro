# ADR-0427: Wire R3 Provisional Shadow Lane into Scanner and Shadow Ledger

- **Status**: Accepted
- **Date**: 2026-05-07
- **PR**: TBD (claude/adr-0427-wire-provisional-shadow-ledger)
- **Context**: ADR-0425 (Gate Decision Router) + ADR-0426 (provisional shadow eligibility SSOT)

## 결정

ADR-0426 의 SSOT (`deriveR3ProvisionalShadowCandidate` + `summarizeProvisionalShadowCandidates`) 가 호출자 0건 dead code 였던 상태를 차단. **buyListLoop 의 Gate2 attribution 직후** 위치에 wiring 추가 + **별도 영속 모듈 (`provisionalShadowLedger.ts`)** 신설로 일반 shadow-trades.json 과 완전 분리. dedup key (`scanId:symbol:ADR-0426`) 로 동일 scan 중복 차단.

## 동기

ADR-0426 머지 후 운영 관찰:

- candidates 50 / gate1Pass 9~10 / gate2Pass=0 / entries=0
- SectorEnergy DEGRADED + indexCodeCoverage 18.7% + repairStatus PARTIAL
- Router severity SOFT_DEGRADE / WATCH_ONLY 시점에도 **Shadow 학습 샘플 0**
- ADR-0426 의 SSOT 가 *분류만* — 호출자 0건 → 영속 0건

**결함**: ADR-0426 PR 본문 §"잔여 후속 PR" 명시 — *"호출자 wiring (signalScanner) + shadow ledger 실제 entry 영속"* 미수행이라 운영 환경에서 provisional shadow 학습 샘플 생성 불가.

## 영속 SSOT (사용자 §D 정합)

신규 별도 파일 `data/provisional-shadow-ledger.json` (일반 `shadow-trades.json` 과 완전 분리):

```typescript
interface ProvisionalShadowLedgerEntry {
  eventType: 'PROVISIONAL_SHADOW_ENTRY';   // ← literal 분리 마커
  provisional: true;                        // ← literal
  source: 'ADR-0426';                       // ← literal
  liveAllowed: false;                       // ← literal (TypeScript 강제)
  shadowAllowed: true;                      // ← literal
  // 기타 필드: symbol/name/scanId/scannedAtKst/createdAtKst/label/reasons/regime/
  //          gate1Passed/gate2Passed/routerSeverity/metadata
}
```

**핵심 분리**:
- `PROVISIONAL_SHADOW_LEDGER_FILE` ≠ `SHADOW_FILE` (paths.ts 별도 상수)
- `shadowTradeRepo` import 0건 (정적 grep 가드)
- virtual account holdings/cash 무영향 (학습 metadata 만)

## dedup key 방식 (사용자 §E)

```typescript
buildDedupKey(scanId, symbol)
  → `${scanId}:${symbol}:ADR-0426`           // scanId 있을 때
  → `${YYYYMMDDHHmm}:${symbol}:ADR-0426`     // scanId 부재 fallback
```

동일 scan 내 중복 시 `recorded: false` + `reason: 'DUPLICATE'`. 다음 scan 에서는 다시 영속 가능.

## 호출 지점 (buyListLoop wiring)

**위치**: `server/trading/signalScanner/perSymbol/buyListLoop.ts` — Gate2 attribution `accumulateGate2ConditionOutputs` *직후* + `entryRevalidationStep` *직전*.

**선정 이유 (사용자 §B 우선순위)**:
1. Gate 평가 결과 (`reCheckGate.outputs`) 와 후보 quote 가 함께 있는 지점 ✅
2. Gate Decision Router 평가 가능 (macroState + sectorEnergyQualityDiagnostic 모두 가용) ✅
3. ScanSummary persist 이전이라 후보별 정보 유실 0 ✅

**try/catch 격리** — 영속 throw 시 매수 흐름 차단 0.

## ScanCounters 확장 (사용자 §F)

`createScanCounters()` 신규 4 필드:
```typescript
provisionalShadowEligible: number;
provisionalShadowCreated: number;
provisionalShadowSkipped: number;
provisionalShadowSkipReasons: Record<string, number>;
provisionalShadowCandidates: ProvisionalShadowCandidate[];  // summarize 입력
```

`persistScanResults` 가 자동 합성 → `ScanSummary.provisionalShadowLane` 영속:
- eligible > 0: `summarizeProvisionalShadowCandidates(candidates)` 결합 + `skipped` / `skipReasons` 부착
- eligible = 0: Router severity / gate1Pass / regime 기반 `noEligibleReason` 자동 합성
  - HARD_BLOCK → `'HARD_BLOCK / <top reason>'`
  - TRUE_WEAKNESS → `'TRUE_WEAKNESS — Shadow 학습도 차단'`
  - gate1Pass=0 → `'no Gate1 survivor'`
  - regime≠R3_EARLY → `'regime=<X> — R3_EARLY 외 차단'`

## 출력 예시 (`/scan_blockers`)

### eligible > 0 (사용자 §G 정합)
```
🌱 R3 Provisional Shadow Lane (ADR-0426 / ADR-0427 wiring)
  • eligible: 3
  • created: 3
  • lanes: live=❌ shadow=✅ watch=✅
  • label: R3_PROVISIONAL_LEADER_DATA_DEGRADED
  • top reasons:
    1. SECTOR_DATA_DEGRADED
    2. DATA_UNAVAILABLE
    3. GATE2_NOT_CONFIRMED
  • provisional 라벨로 일반 Shadow buy 와 분리 영속 — LIVE 매매 영향 0, 학습 샘플 보존.
```

### eligible > 0 + skipped > 0
```
🌱 R3 Provisional Shadow Lane (ADR-0426 / ADR-0427 wiring)
  • eligible: 5
  • created: 3
  • skipped: 2
  • skipReasons: DUPLICATE=1, ENV_DISABLED=1
  • lanes: live=❌ shadow=✅ watch=✅
  ...
```

### eligible = 0 (HARD_BLOCK)
```
🌱 R3 Provisional Shadow Lane (ADR-0426 / ADR-0427 wiring)
  • eligible: 0
  • created: 0
  • lanes: live=❌ shadow=✅ watch=✅
  • blockedBy: HARD_BLOCK / SELL_ONLY
  • note: HARD_BLOCK / SELL_ONLY 에서는 Shadow 학습도 제한.
```

## 핵심 불변식

1. **LIVE 매매 차단** — `liveAllowed: false` literal type (TypeScript 강제)
2. **KIS 주문 경로 0줄 변경** — KIS 주문 함수 5종 import 0건 (정적 grep 가드)
3. **Gate threshold 변경 0** — Router 호출만, threshold 무관
4. **HARD_BLOCK 은 Shadow 도 차단** — eligibility 가 null 반환
5. **SELL_ONLY / R6_DEFENSE / emergencyStop** — Shadow 도 차단
6. **별도 영속 layer** — `PROVISIONAL_SHADOW_LEDGER_FILE` ≠ `SHADOW_FILE`
7. **`shadowTradeRepo` import 0건** — 일반 shadow buy 와 완전 분리 (정적 grep 가드)
8. **`eventType: 'PROVISIONAL_SHADOW_ENTRY'` literal** — 영속 분리 마커
9. **virtual account holdings/cash 무영향** — 학습 metadata 만
10. **dedup 멱등** — 동일 scan 중복 차단

## 본 PR 범위

- `server/persistence/paths.ts` (+`PROVISIONAL_SHADOW_LEDGER_FILE`)
- `server/persistence/provisionalShadowLedger.ts` SSOT 신설 (~200 LoC)
- `server/persistence/provisionalShadowLedgerAdr0427.test.ts` (24 케이스)
- `server/trading/signalScanner/scanDiagnostics.ts` — ScanCounters 4 신규 필드 + persistScanResults 자동 합성
- `server/trading/signalScanner/perSymbol/buyListLoop.ts` — Gate2 attribution 직후 wiring (try/catch 격리)
- `server/trading/signalScanner/provisionalShadowLane.ts` — formatter 격상 (skipped / skipReasons / blockedBy)
- ADR-0426 회귀 테스트 정합 정정 (formatter 메시지 격상)

회귀 테스트 영향 영역 55 files / 708 tests 무회귀.

## ENV 우회

`PROVISIONAL_SHADOW_LEDGER_DISABLED=true` (default OFF, ADR-0157 정확 비교) — 영속 비활성. 회귀 발견 시 1줄 즉시 ADR-0426 SSOT dead code 동작 복원.

## scope 외 (후속 PR)

- **ADR-0428 provisional shadow performance report** — 주간/월간 적중률 집계 + Telegram report
- **provisional → normal shadow 승격 조건** — Gate2 후속 통과 시 자동 격상 (별도 ADR)
- **reduced paper/live 검토** — 성과 확인 후 별도 ADR (현재 절대 금지)
- **/shadow_provisional 텔레그램 명령** — eligible/created 진단 (사용자 §I — 본 PR scope 외)
- **/gate_audit 분리 카운트** — `shadowProvisional` / `liveBuy` / `ghost` 별도 표시 (사용자 §H)
- **intradayLoop wiring** — 본 PR 은 buyListLoop 만, intradayLoop 적용 시 추가 회귀 위험
- **PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% 분기 wiring** — 회귀 격리

## 참고 문헌

- ADR-0420 (Fresh Scan Blocker Attribution)
- ADR-0422 (Gate2 / NO_LEADERSHIP fresh attribution)
- ADR-0423 (SectorEnergy data-truth diagnostic)
- ADR-0424 (SectorEnergy indexCode provider repair)
- ADR-0425 (Gate Decision Router — hard block vs soft degrade separation)
- ADR-0426 (R3_EARLY Provisional Leader Shadow Lane — eligibility SSOT)
