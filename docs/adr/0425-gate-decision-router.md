# ADR-0425: Gate Decision Router — Hard Block vs Soft Degrade Separation

- **Status**: Accepted
- **Date**: 2026-05-07
- **PR**: TBD (claude/adr-0425-gate-decision-router)
- **Context**: ADR-0416/0417/0418 (DATA_UNAVAILABLE 의미론) + ADR-0420 (Gate1 fresh attribution) + ADR-0422 (Gate2 fresh attribution) + ADR-0423 (SectorEnergy data-truth diagnostic) + ADR-0424 (SectorEnergy provider repair)

## 결정

Gate 판단 결과를 단일 PASS/FAIL 에서 **7-tier severity** Decision Router 로 분리. 실매수는 보수적으로 차단을 유지하면서 SOFT_DEGRADE / DATA_UNAVAILABLE / STALE 상황에서 Shadow / Watch 학습 후보를 완전히 죽이지 않도록 한다.

## 동기

운영 관찰 (2026-05-07):

- candidates 49~50 / gate1Pass 9~10 / gate2Pass=0 / entries=0
- SectorEnergy: dataQuality=STALE / sourceTier=STOCK_DAILY / freshness=FRESH / coverage=91.7% / confidence=0.0%
- Gate2 blockers: trend_acceleration / vcp 일부 failed + earnings_quality / per / supply_confluence unavailable
- Shadow / virtual entry 도 0에 가까움

**결함**: Gate 가 *진짜 리스크 위반* / *진짜 기술적 약세* / *데이터 부재* / *STALE* / *초기 주도주 대기* 를 모두 동일하게 *진입 차단* 으로 처리. 실매수뿐 아니라 Shadow 학습 경로까지 같이 막힘.

## 7-tier severity SSOT

```typescript
type GateDecisionSeverity =
  | 'HARD_BLOCK'              // 리스크 차단 — Shadow 도 차단
  | 'TRUE_WEAKNESS'           // 진짜 기술 약세 — Shadow 차단, Watch 만 보존
  | 'SOFT_DEGRADE'            // 데이터 품질 저하 — 실매수 차단, Shadow/Watch 보존
  | 'WATCH_ONLY'              // 돌파 대기 — Watch/Shadow 보존
  | 'SHADOW_ENTRY_ALLOWED'    // (R3_EARLY provisional, ADR-0426 후속)
  | 'REDUCED_ENTRY_CANDIDATE' // 부분 pass — Shadow/Watch 보존
  | 'FULL_ENTRY_CANDIDATE';   // Full pass — 기존 매수 정책으로 결정
```

## 분류 규칙 (사용자 §C 정합, 절대 변경 금지)

### HARD_BLOCK
- emergencyStop / SELL_ONLY / R6_DEFENSE / VIX panic / FOMC hard block
- liquidity / RRR severe block
- sizing impossible (sizingBlocked ≥ gate1Pass)
- order/execution risk

**결과**: liveAllowed=false / paperAllowed=false / shadowAllowed=false / watchAllowed=false / label=BLOCK_RISK

### TRUE_WEAKNESS
- trueFailRate ≥ 0.7 (trend_acceleration / vcp / breakout_momentum / relative_strength failed 우세)
- 데이터 결손이 우세하지 *않을* 때만 (DATA_UNAVAILABLE / STALE 우세 시 SOFT_DEGRADE 우선)

**결과**: liveAllowed=false / shadowAllowed=false / watchAllowed=true / label=BLOCK_TRUE_WEAKNESS

### SOFT_DEGRADE (사용자 명시 핵심 분류)
- SectorEnergy STALE / DEGRADED / FAILED / fallbackUsed≠NONE
- DATA_UNAVAILABLE 우세 (unavailableRate ≥ 0.5)
- evaluator non-critical error (errorRate ≥ 0.3)
- supply_confluence / earnings_quality / per DATA_UNAVAILABLE
- stock-daily fallback leadership confidence blocked

**결과**: liveAllowed=false / paperAllowed=false / **shadowAllowed=true** / watchAllowed=true / label=SOFT_DEGRADE_DATA

### WATCH_ONLY
- Pre-breakout WAIT 우세 (preBreakoutWait/gate1Pass ≥ 0.5)
- Gate2 단계 wait 우세 (waitRate ≥ 0.5)
- Gate 재검증 미달 우세 (gateRecheckRate ≥ 0.5)

**결과**: liveAllowed=false / shadowAllowed=true / watchAllowed=true / label=WATCH_PRE_BREAKOUT

### FULL_ENTRY_CANDIDATE
- gate1Pass>0 + gate2Pass>0 + gate3Pass>0 + lastTriggerPass>0

**결과**: liveAllowed=true (Router 결정만, 실제 매수는 기존 sizing/RRR/budget 정책으로 결정) / 모든 lane 허용 / label=FULL_CANDIDATE

### REDUCED_ENTRY_CANDIDATE
- gate1Pass>0 + gate2/3/lastTrigger 미완

**결과**: liveAllowed=false / shadowAllowed=true / watchAllowed=true / label=REDUCED_CANDIDATE

## 안전 invariant (사용자 명시 §"절대 하지 말 것" 정합)

1. **Gate threshold 변경 0** — 정적 grep 가드 (`setGateThreshold` / `MIN_GATE_OVERRIDE` / `GATE_RELAX` 부재)
2. **LIVE/실주문 정책 0** — KIS 주문 함수 5종 import 0건 (정적 grep 가드)
3. **HARD_BLOCK 은 Shadow 도 차단** — emergencyStop / SELL_ONLY / R6 시 shadowAllowed=false
4. **SOFT_DEGRADE 는 Shadow 보존** — SectorEnergy STALE / DATA_UNAVAILABLE 시 shadowAllowed=true
5. **DATA_UNAVAILABLE 은 failed 가 아니다** — SOFT_DEGRADE 분기, TRUE_WEAKNESS 아님
6. **STALE 은 failed 가 아니다** — sectorEnergy STALE 단독 시 SOFT_DEGRADE
7. **SectorEnergy STALE 은 true no-leadership 이 아니다** — TRUE_WEAKNESS 분기 진입 차단
8. **외부 API / fetch 0건** — Router 본체는 순수 함수 SSOT
9. **GATE_DECISION_ROUTER_THRESHOLDS Object.freeze SSOT** — drift 차단

## 잘못된 해결 방법 영구 차단

1. Gate threshold 완화 (사용자 §"절대 하지 말 것" #1) — Router 가 임계 변경 0
2. Gate2 통과 기준 완화 (#2) — Router 는 분류만, threshold 무관
3. sectorEnergy 점수 산식 완화 (#3) — sectorEnergyDiagnostic 결과 *그대로* 사용
4. SectorEnergy confidence 0% 를 OK 처리 (#4) — confidence=0 + dataQuality=STALE 시 SOFT_DEGRADE 분류
5. supply_confluence weight 변경 (#5) — Router 본체에서 weight 참조 0
6. STRONG_BUY 조건 변경 (#6) — Router 본체에서 STRONG_BUY 입력 0
7. LIVE 주문 경로 변경 (#7~#9) — KIS 주문 import 0건
8. SectorEnergy provider/cache 복구 본 PR 통합 (#11) — ADR-0424 후속 별도
9. last 7 days gate_audit reset (#12) — Router 영속 변경 0건

## 출력 예시 (`/scan_blockers`)

### SOFT_DEGRADE (사용자 보고 시나리오)
```
🧭 Gate Decision Router (ADR-0425)
  • severity: 🟡 SOFT_DEGRADE
  • label: SOFT_DEGRADE_DATA
  • lanes: live=❌ paper=❌ shadow=✅ watch=✅
  • reasons:
    1. SECTOR_DATA_STALE
    2. DATA_UNAVAILABLE
  • operatorMessage: 실매수 차단 유지 — 데이터 품질 저하 (STALE/UNAVAILABLE/ERROR). Shadow/Watch 학습 후보로 보존 가능. 데이터 소스 점검 우선 (Gate 임계 변경 금지).
```

### HARD_BLOCK
```
🧭 Gate Decision Router (ADR-0425)
  • severity: 🚨 HARD_BLOCK
  • label: BLOCK_RISK
  • lanes: live=❌ paper=❌ shadow=❌ watch=❌
  • reasons:
    1. SELL_ONLY
    2. R6_DEFENSE
  • operatorMessage: 리스크 차단 — Shadow 학습도 제한.
```

## 본 PR 범위

- `server/trading/signalScanner/gateDecisionRouter.ts` SSOT 신설 (~290 LoC)
- `scanDiagnostics.ts` `ScanSummary.gateDecisionRouter?` 옵셔널 schema + `persistScanResults` 자동 합성 + `formatScanBlockersMessage` section 추가
- 회귀 테스트 21 신규
- LIVE 매매 본체 0줄 변경

## scope 외 (후속 PR)

- ADR-0426 R3_EARLY provisional leader entry rules (SHADOW_ENTRY_ALLOWED severity 활성화)
- ADR-0424 SectorEnergy provider/cache actual repair (운영 환경에서 macroState 가 계속 STOCK_DAILY 반환 시)
- Router 결과를 shadow ledger 에 실제 entry 로 연결 (현재는 metadata 만)
- /gate_audit postmortem 의 status-aware top blocker 표시 (legacy 카운터 reset 금지)

## 참고 문헌

- ADR-0416 (Phase 1 — DATA_UNAVAILABLE wiring, supplyConfluence + earningsQuality)
- ADR-0417 (Phase 2 — postmortem action taxonomy split)
- ADR-0418 (Phase 3 — registry evaluator.inputs metadata automation)
- ADR-0420 (Fresh Scan Blocker Attribution)
- ADR-0422 (Gate2 / NO_LEADERSHIP fresh attribution)
- ADR-0423 (SectorEnergy data-truth diagnostic)
- ADR-0424 (SectorEnergy indexCode provider repair)
