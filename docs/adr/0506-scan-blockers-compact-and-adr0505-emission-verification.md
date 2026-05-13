# ADR-0506 — Scan Blockers Compact Mode + ADR-0505 Emission Verification

**Date:** 2026-05-13
**Status:** Accepted
**Scope:** Telegram `/scan_blockers` command surface only — diagnostic / display layer.

---

## 1. 배경

PR #919에서 ADR-0505 Gate1 Minimum Signal Forensic Audit이 머지된 직후 다음
두 결함이 동시 발생하였다.

1. `/scan_blockers` 출력이 운영 요약이 아니라 전체 diagnostic dump 수준 (장문).
2. 머지된 ADR-0505 Gate1 Minimum Signal Forensic 섹션이 운영 Telegram
   `/scan_blockers` 출력에서 보이지 않음 — ADR-0467~0477, ADR-0480~0501 등은
   보이지만 정작 최신 ADR-0505 는 누락.

코드베이스 audit 결과 ADR-0505 emission 결손의 원인은 다음 5중 가능성 중 하나임을 확인:

- (a) `ScanSummary.gate1MinimumSignalForensicAdr0505` 미생성
- (b) `PersistScanResultsOptions.gate1ForensicInputs` 미전달
- (c) `buildGate1MinimumSignalForensicAuditAdr0505` 미호출
- (d) `formatGate1MinimumSignalForensicSection` 미참조
- (e) `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` env 활성

본 ADR audit 결과 진짜 원인은 **(b) FORENSIC_INPUTS_MISSING** — `persistScanResults`
호출자 측 `gate1ForensicInputs` collector 가 *Phase 1 후속 PR* 로 분리되어
구현되지 않은 dead-code wiring 상태. 운영 환경에서는 `SUMMARY_FIELD_MISSING` 으로 관측됨.

## 2. 결정

**Diagnostic / Display only 격상** — 운영자가 한 명령으로 *어디서 끊겼는지* 즉시
식별하는 진단 layer 신설. live trading / score / threshold / order path 변경 0.

### 2.1 6-mode dispatcher

| Mode | Default? | 목적 | Length budget |
|------|----------|------|---------------|
| `compact` | ✅ default | 15~25줄 운영 요약, 핵심 판단만 | 2,000자 |
| `full` | 명시 호출 | 기존 장문 출력 보존 (헤더 추가) | 4,096자 |
| `gate` | 명시 호출 | Gate1/Gate2/Gate3/MinSignal 관련만 | 4,000자 |
| `supply` | 명시 호출 | 수급/Provider/FreshData 관련만 | 4,000자 |
| `sector` | 명시 호출 | SectorEnergy 관련만 | 4,000자 |
| `runtime` | 명시 호출 | RuntimePipelineAudit/Liveness/Counterfactual 관련만 | 4,000자 |

### 2.2 ADR-0505 Emission Status SSOT — 7-value union (절대 변경 금지)

```
type Adr0505EmissionStatus =
  | 'EMITTED'                  // OK — forensic 정상 노출
  | 'DISABLED_BY_ENV'          // GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED='true'
  | 'SUMMARY_FIELD_MISSING'    // summary 존재 + gate1MinimumSignalForensicAdr0505 부재
  | 'FORENSIC_INPUTS_MISSING'  // persistScanResults 호출자 gate1ForensicInputs 미전달
  | 'BUILDER_NOT_CALLED'       // input 있으나 totalCandidates=0 (논리 결함)
  | 'FORMATTER_NOT_WIRED'      // summary 존재 + /scan_blockers formatter 미참조 (논리 결함)
  | 'PERSIST_SKIPPED'          // 스캔 미실행 — summary 자체 부재
  | 'UNKNOWN'                  // 위 분류 불가
```

### 2.3 결정 트리 SSOT (`deriveAdr0505EmissionStatus`, 절대 변경 금지)

1. `env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED === 'true'` → `DISABLED_BY_ENV`
2. summary 자체 부재 → `PERSIST_SKIPPED`
3. summary 존재 + `gate1MinimumSignalForensicAdr0505` undefined → `SUMMARY_FIELD_MISSING`
4. `gate1MinimumSignalForensicAdr0505.totalCandidates === 0` → `BUILDER_NOT_CALLED`
5. `totalCandidates > 0` → `EMITTED`

### 2.4 Mode → ADR 매트릭스 SSOT (사용자 §E-H, 절대 변경 금지)

```
gate    : 0465 / 0466 / 0467 / 0468 / 0469 / 0470 / 0471 / 0472 / 0475 / 0476 / 0505
supply  : 0473 / 0477 / 0481 / 0482 / 0483 / 0484 / 0485 / 0486 / 0487 / 0491 / 0498
sector  : 0423 / 0446 / 0448 / 0474 / 0488
runtime : 0425 / 0426 / 0430 / 0433 / 0451 / 0461 / 0464 / 0500 / 0501
compact : (지정 ADR 없음 — 핵심 운영 판단만)
full    : (모든 section 포함)
```

### 2.5 ADR-0505 NOT_EMITTED compact line 형식

```
🧬 ADR-0505 Gate1 Forensic: <status> ⚠️
  reason=<status>
  action=<recommendedAction>
  impact=NONE
```

## 3. 안전 원칙 (절대 불변식)

1. **executionImpact: 'NONE'** — display / diagnostic only.
2. **liveExecutionAllowed: false** — KIS 주문 / autoTradeEngine / orderExecutor /
   trancheExecutor import 0건 (정적 grep 가드).
3. **Gate threshold + STRONG_BUY + requiredScore 변경 0**.
4. **외부 API 호출 0** — fetch / axios / node-fetch import 0건 (read-only).
5. **console.log 직접 추가 금지** — LOG_LEVEL/Noise suppression 정책 정합.
6. **기존 full 출력 보존** — `mode='full'` 으로 100% 접근 가능.
7. **compact formatter 실패 시 안전 fallback** — throw 시 호출자 catch (본 SSOT 안에서
   throw 안 함).
8. **ADR-0157 ENV 정확 비교** — `=== 'true'` 만 인정, `'1'` / `'TRUE'` / `'yes'` 모두 거부.
9. **summary 부재 시 PERSIST_SKIPPED 우선** — 잘못된 단계 (forensic_inputs / builder)
   추측 금지.
10. **ScanSummary schema 변경 0** — 본 ADR 은 read-only consumer.

## 4. 잘못된 해결 방법 (영구 차단)

- `requiredScore`, threshold, UNKNOWN penalty, sector boost 임계 변경
- watchlist score live 승격 / SectorEnergy OK 격상 / provider fetch 추가
- KIS / KRX / Yahoo / Naver outbound 추가
- KIS 주문 경로 변경 / live candidate promotion
- Shadow learning 저장 차단
- evaluateServerGate raw score 변경 / minimumSignalScoreTrace 산식 변경
- Telegram 메시지 강제 분할 (multi-message) — 운영자 cognitive load 폭증, 길이
  budget 으로 단일 메시지 안 truncate 처리
- Mode 결정을 호출자 측 inline 처리 — `parseScanBlockersMode` SSOT 위임 의무

## 5. 회귀 테스트 (36/36 PASS, 사용자 §L 12 mandatory + 안전 invariant 정적 grep)

1. `/scan_blockers` 기본 호출 → compact 출력 (default).
2. compact 출력은 SCAN_BLOCKERS_USAGE_HINT 안내 포함.
3. compact 출력은 SCAN_BLOCKERS_LENGTH_BUDGET=2000 이하.
4. `/scan_blockers full` → 기존 full mode 헤더 + 모든 section.
5. `/scan_blockers gate` → ADR-0505 line 포함, ADR-0466 등 gate 그룹만.
6. `/scan_blockers supply` → ADR-0477 등 supply 그룹만, gate 그룹 제외.
7. `/scan_blockers sector` → ADR-0423 등 sector 그룹만.
8. `/scan_blockers runtime` → ADR-0451 등 runtime 그룹만.
9. summary.gate1MinimumSignalForensicAdr0505 부재 → SUMMARY_FIELD_MISSING.
10. ENV `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` → DISABLED_BY_ENV.
11. unknown mode → compact fallback + 경고 메시지.
12. KIS 주문 함수 5종 / autoTradeEngine / fetch / Gate threshold / STRONG_BUY
    변경 0건 (정적 grep 가드).

## 6. 성공 기준

- ✅ `/scan_blockers` 기본 출력이 15~25줄 수준 (compact).
- ✅ ADR-0505 가 EMITTED 이면 표시.
- ✅ ADR-0505 가 부재이면 NOT_EMITTED + reason + recommendedAction 표시.
- ✅ `/scan_blockers full` 로 기존 장문 접근 가능.
- ✅ `/scan_blockers gate|supply|sector|runtime` 분리 조회 가능.
- ✅ LIVE 매매 본체 0줄 변경 (`signalScanner.ts` / `entryEngine.ts` / `exitEngine/**`
  / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` 모두).

## 7. 잔여 후속 PR (scope 외)

- ADR-0505 `gate1ForensicInputs` collector 호출자 측 wiring (Phase 1 후속 PR) —
  현재 `FORENSIC_INPUTS_MISSING` / `SUMMARY_FIELD_MISSING` 상태 해소.
- Mode 별 length budget 운영 데이터 누적 후 재조정 (operator 피드백 기반).
- ADR 그룹 매트릭스 확장 (신규 ADR 발급 시 자동 분류).

## 8. ENV 우회

| ENV | Default | 효과 |
|-----|---------|------|
| `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` | OFF | ADR-0505 emission 차단 (ADR-0505 정책) |

본 ADR 자체 ENV 우회 0건 — compact mode 는 *영구 default*. 회귀 발견 시 `git revert`
(외부 SSOT 변경 0건, 호출자 변경만).
