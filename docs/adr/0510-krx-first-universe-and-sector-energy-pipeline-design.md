---
id: 0510
title: KRX-First Universe & Sector Energy Pipeline — Design ADR (코드 0줄, OBSERVE 단계 전 설계 SSOT)
status: ACCEPTED
date: 2026-05-14
executionImpact: NONE
liveExecutionAllowed: false
policyPromotionMode: SHADOW_ONLY
operatorApprovalRequired: true
---

# ADR-0510 — KRX-First Universe & Sector Energy Pipeline (Design ADR, 코드 0줄)

## Context

사용자 5/14 명시 framing 직접 인용:

> "KRX를 KIS 대체재로 쓰는 것이 아니라, KRX를 '전 종목 스캔·섹터 에너지·기초 시장 데이터의 1차 원천'으로 복귀시키고, KIS는 최종 후보 검증과 보유/매도 관리에만 남겨야 한다."

> "예전에는 KRX로 모든 걸 하려다 어려웠다 (섹터에너지 + 수급원 + 판단까지). 이번에는 그렇게 가면 안 된다. KRX는 1차 원천/스캔/섹터 breadth만 담당, KIS는 최종 확인만 담당, DART는 펀더멘털, Yahoo/local OHLCV는 기술지표, → 역할 분리."

> "신규 데이터 소스는 검증 전까지 바로 CORE 판단에 연결하면 안 된다. OBSERVE → SHADOW_SCORE → ADVISORY → WEIGHTED → GATED → CORE 단계."

본 ADR 은 **코드 0줄 변경 design SSOT** — KRX-First 정책의 *측정 가능한 정의* + 현 코드베이스 정확 매핑 + Stage 2/3 신규 SSOT 시그니처 + 위험 분석 + 회귀 전략 + Phase 분리. 실제 SSOT 신설 / wiring 은 후속 PR (ADR-0511 ~ ADR-0515) 에서 분리 진행.

## Decision — 정책 SSOT (절대 변경 금지)

### §1. 역할 분리 SSOT

```
KRX  = 전 종목 universe + sector energy + 기초 시장 breadth (1차 원천)
KIS  = 보유 매도 관리 + READY 후보 3~5개 최종 확인 (좁게)
DART = 펀더멘털 검증 (깊게)
Yahoo/local OHLCV = 기술지표 계산
Shadow = 실패/차단 학습 + 표본 누적
```

### §2. 6 단계 파이프라인 SSOT (사용자 §"새 구조" 정합, 절대 변경 금지)

| Stage | 책임 | 출력 | KIS 호출 | 현 코드베이스 매핑 |
|------:|------|------|---------|-------------------|
| 0 | KRX Universe Snapshot | KOSPI+KOSDAQ 전 종목 + 관리/정지/저유동성 제외 | **0** | `krxStockMasterRepo` ✅ 존재 + 4-tier multi-source |
| 1 | KRX Sector Energy | 12 섹터 × {상승률 rank / 거래대금 증가 rank / advancing breadth / new-high breadth / volume surge breadth} | **0** | `sectorEnergyProvider` ✅ 존재 + L1~L4 fallback chain |
| 2 | KRX Stock Prefilter | universe → 30~50 후보 압축 (거래대금 + 거래량 증가 + 52w high 근접 + 5d/20d/60d 수익률 + 업종 내 상대강도) | **0** | ❌ **미구현 — 신규 SSOT 필요** |
| 3 | MTAS-Lite (KRX + OHLCV) | 30~50 → 10~15 후보 (KRX/Yahoo/local OHLCV 기반 기술지표) | **0** | ❌ **미구현 — 기존 MTAS 는 KIS 의존** |
| 4 | DART Fundamental | ROE / OCF / ICR / EPS growth 정합 | **0** | ✅ Patch-005 4-state union |
| 5 | READY Candidate Selection | 10~15 → 3~5 종목 | **0** (선택적) | `buyListLoop` ✅ 존재 |
| 6 | KIS Confirm | 현재가 / 호가 / 최종 수급 / 주문 가능성 | **3~5** (P0/P1 만, circuit=CLOSED) | Patch-005 enforcement 매트릭스 ✅ |

### §3. 데이터 단계 SSOT (사용자 §"승격 흐름" 정합, 절대 변경 금지)

```typescript
type ProviderStage =
  | 'OBSERVE'        // 새 데이터 도입 직후 — 매매 결정 입력 0건
  | 'SHADOW_SCORE'   // Shadow 매매에만 영향 — Live 매매 결정 입력 0건
  | 'ADVISORY'       // Live 표시는 되지만 결정 가중치 0
  | 'WEIGHTED'       // Live 결정에 가중치 적용 (조건부)
  | 'GATED'          // Live Gate 통과 조건 입력
  | 'CORE';          // Live STRONG_BUY / HARD_BLOCK 입력 가능
```

**신규 데이터 소스는 항상 OBSERVE 단계로 도입.** 검증 누적 후에만 상위 단계 승격.

### §4. KRX-First 진단 status SSOT

```typescript
type KrxDataStatus =
  | 'VERIFIED'         // 정상 응답 + 모든 필드 가용
  | 'DEGRADED'         // 일부 시장 빈 응답 (KOSPI OK + KOSDAQ 빈 등)
  | 'STALE'            // cache fallback (last-good ≤ 4h)
  | 'EMPTY_VALID'      // 정상 응답 + 데이터 자체 비어있음 (장 시작 전 등)
  | 'MISSING'          // 모든 fallback 실패
  | 'NOT_EVALUATED';   // ENV DISABLED 또는 휴장일

type SectorEnergyStatus =
  | 'SECTOR_ENERGY_OK'
  | 'SECTOR_ENERGY_STALE'
  | 'SECTOR_ENERGY_PARTIAL'
  | 'SECTOR_ENERGY_NOT_EVALUATED';
```

### §5. Sector Energy 점수 SSOT (사용자 §"섹터에너지 재설계" 정합)

```
sectorEnergyScore =
    sectorReturnRankScore         * 0.25
  + sectorTradingValueRankScore   * 0.25
  + sectorAdvancingBreadthScore   * 0.20
  + sectorNewHighBreadthScore     * 0.15
  + sectorVolumeSurgeBreadthScore * 0.15
```

**해석**: 점수는 *돈이 들어오는 흔적* 만 측정. *누가 사는지* (외국인/기관/Active/Passive) 는 KRX 단독으로 해결 불가 → KIS 또는 별도 투자자 데이터.

### §6. KIS 호출 감축 규칙 SSOT

```
- 전 종목 스캔 중 KIS network call = 0
- MTAS-Lite 중 KIS network call = 0
- preEntry hydration 중 KIS network call = 0
- READY 후보 상위 3~5개만 KIS Confirm 허용
- P0_POSITION_EXIT / P1_SHADOW_POSITION_MANAGEMENT 는 항상 보호 (Patch-005 정합)
- P2_READY_CANDIDATE_CONFIRM 은 circuit=CLOSED 에서만 live call
- P3/P4 는 장중 suppress (Patch-004 정합)
```

### §7. 절대 불변식

1. **LIVE 매매 본체 0줄 변경 의무** — 본 ADR 은 design SSOT, 실제 wiring 은 후속 PR.
2. **KRX 실패 시 KIS 호출 폭증으로 보상 금지** — KRX 실패 → sectorEnergy=STALE 또는 NOT_EVALUATED → 신규 매수 강도 축소 + Shadow case 기록. **KIS 추가 호출 0건**.
3. **KRX 데이터 단독 HARD_BLOCK 금지** — sector energy 가 낮아도 일반 BUY 진입 차단 0 (ADR-0448 Trading Engine Liveness First 정합). 사이즈 감점은 가능, STRONG_BUY 승격 제한은 가능 (ADR-0398 정합).
4. **신규 KRX 데이터는 OBSERVE 단계로 도입** — Stage 2/3 신규 SSOT 첫 머지 시 매매 결정 입력 0건.
5. **DART sample=0 → nullRate=null N/A** (Patch-005 정합 보존).
6. **executionImpact=NONE / liveExecutionAllowed=false / policyPromotionMode=SHADOW_ONLY** literal 강제 (Phase 1/2 SSOT 모두).

## Stage 2 신규 SSOT — `server/screener/krxPrefilterStage2.ts` (Phase 1 후속 PR)

### Schema

```typescript
export type KrxPrefilterCandidate = {
  readonly stockCode: string;
  readonly stockName: string;
  readonly market: 'KOSPI' | 'KOSDAQ';
  readonly sectorKey: string;                 // SECTOR_INDEX_MASTER 정합
  readonly tradingValueKrwToday: number;
  readonly tradingValueRank: number;          // 1=highest
  readonly volumeChangePctVsAvg20: number;    // 거래량 변동률
  readonly close: number;
  readonly high52w: number;
  readonly distanceTo52wHighPct: number;
  readonly return5dPct: number;
  readonly return20dPct: number;
  readonly return60dPct: number;
  readonly sectorRelativeStrengthPct: number;
};

export type KrxPrefilterResult = {
  readonly status: 'VERIFIED' | 'DEGRADED' | 'STALE' | 'EMPTY_VALID' | 'MISSING';
  readonly inputUniverseSize: number;
  readonly survivors: ReadonlyArray<KrxPrefilterCandidate>;
  readonly maxSurvivors: 50;
  readonly fetchedAt: string;
  readonly executionImpact: 'NONE';            // literal 강제
  readonly liveExecutionAllowed: false;        // literal 강제
  readonly policyPromotionMode: 'OBSERVE';     // literal 강제 — Phase 1 단계
};

export function runKrxPrefilterStage2(opts?: {
  readonly nowMs?: number;
  readonly maxSurvivors?: number;
  readonly minTradingValueKrw?: number;
}): Promise<KrxPrefilterResult>;
```

### 입력 SSOT (KIS 호출 0건)

- `krxStockMasterRepo.getAllStocks()` → universe (기존 SSOT, 2,500+ 종목)
- `fetchKrxDailyOhlcv(date)` → 전 종목 일봉 (기존 SSOT)
- `fetchKospiIndexDaily(date)` + `fetchKosdaqIndexDaily(date)` → 시장 평균 (기존 SSOT)
- `sectorEnergyProvider.buildSectorEnergyInputsWithMeta()` → 섹터 매핑 (기존 SSOT)

### 결정 트리 SSOT (절대 변경 금지)

```
1. ENV `KRX_PREFILTER_STAGE2_DISABLED=true` → status='NOT_EVALUATED' early return
2. krxStockMasterRepo 부재 → status='MISSING' empty survivors
3. fetchKrxDailyOhlcv 빈 응답 → status='EMPTY_VALID' empty survivors (휴장일)
4. KOSPI/KOSDAQ 한쪽만 가용 → status='DEGRADED' 부분 universe 사용
5. 5d/20d/60d 수익률 계산 가능 → status='VERIFIED' rank top 50
```

### 회귀 SSOT (Phase 1 후속 PR 의무)

- 빈 universe → empty survivors + status='MISSING'
- 휴장일 → status='EMPTY_VALID' (vs MISSING 구분)
- 한 시장 빈 응답 → status='DEGRADED' + 나머지 시장 정상 처리
- KIS 주문 함수 5종 import 0건 (정적 grep 가드)
- autoTradeEngine / orderExecutor / trancheExecutor import 0건
- 외부 fetch / axios / node-fetch import 0건 (KRX SSOT 만 위임)
- ENV `=== 'true'` 정확 비교 (ADR-0157)
- literal type 강제 (`executionImpact='NONE'` / `liveExecutionAllowed=false` / `policyPromotionMode='OBSERVE'`)

## Stage 3 신규 SSOT — `server/screener/mtasLitePrefilterStage3.ts` (Phase 2 후속 PR)

Stage 2 survivors (30~50) → 10~15 후보 압축, KRX/Yahoo/local OHLCV 만 사용 (KIS 0).

### Schema

```typescript
export type MtasLiteStatus =
  | 'MTAS_LITE_OK'
  | 'MTAS_LITE_PARTIAL'
  | 'MTAS_LITE_NOT_EVALUATED';

export type MtasLiteCandidate = KrxPrefilterCandidate & {
  readonly rsi14: number | null;
  readonly macdSignal: 'BULL' | 'BEAR' | 'NEUTRAL';
  readonly ichimokuTrend: 'BULL' | 'BEAR' | 'NEUTRAL';
  readonly vcpStage: 'STAGE_1' | 'STAGE_2' | 'STAGE_3' | null;
  readonly mtasLiteScore: number;
};
```

### 결정 트리

```
1. Stage 2 result.status != 'VERIFIED' && != 'DEGRADED' → MTAS_LITE_NOT_EVALUATED
2. survivors.length === 0 → MTAS_LITE_NOT_EVALUATED + empty
3. RSI/MACD/일목/VCP 계산 → 임계 통과 시 score 부여
4. score top 15 → MTAS_LITE_OK
5. 일부 데이터 부재 → MTAS_LITE_PARTIAL
```

## 정합 매핑 — Stage × 현 코드베이스 × 신규 SSOT

| Stage | 신규 SSOT | 기존 호출자 변경 | LIVE 매매 영향 | Phase |
|-------|-----------|------------------|---------------|-------|
| 0 | (없음 — 기존 활용) | krxStockMasterRepo 그대로 | 0줄 | Phase 1 wiring |
| 1 | (없음 — 기존 활용) | sectorEnergyProvider 그대로 | 0줄 | Phase 1 wiring |
| 2 | `krxPrefilterStage2.ts` | scanDiagnostics 비교 표시만 | **0줄** | **Phase 1 (OBSERVE)** |
| 3 | `mtasLitePrefilterStage3.ts` | scanDiagnostics 비교 표시만 | **0줄** | **Phase 2 (OBSERVE)** |
| 4 | (없음 — DART Patch-005) | 그대로 | 0줄 | 이미 wired |
| 5 | (없음 — buyListLoop) | Phase 3 SHADOW_SCORE 승격 후 입력 | 0줄 | Phase 3 (SHADOW_SCORE) |
| 6 | (없음 — Patch-005 enforcement) | 그대로 | 0줄 | 이미 wired |

## Phase 분리 (후속 PR 시리즈, 1주 검증 간격 의무)

### Phase 1 (단일 PR) — `Patch-KRX-FIRST-PREFILTER-OBSERVE-ONLY-001`
- 신규 SSOT: `krxPrefilterStage2.ts` (~300~400 LoC) + `krxPrefilterStage2.test.ts` (~30~40 케이스)
- ENV: `KRX_PREFILTER_STAGE2_DISABLED=true` (default OFF)
- wiring: `scanDiagnostics` 에 *비교 진단* 만 (KIS pre-screen 결과 vs KRX prefilter 결과 차이 표시)
- LIVE 매매 본체 0줄 변경
- ADR 발급: ADR-0511 (Stage 2 SSOT 정책)
- 1주 운영 데이터 누적

### Phase 2 (단일 PR) — `Patch-KRX-FIRST-MTAS-LITE-OBSERVE-002`
- 신규 SSOT: `mtasLitePrefilterStage3.ts` + tests
- ENV: `MTAS_LITE_PREFILTER_DISABLED=true` (default OFF)
- wiring: `scanDiagnostics` 비교 진단만 (KIS MTAS 결과 vs MTAS-Lite 결과 차이)
- ADR 발급: ADR-0512

### Phase 3 (단일 PR) — `Patch-KRX-FIRST-PROMOTE-TO-SHADOW-SCORE-003`
- `policyPromotionMode: 'OBSERVE'` → `'SHADOW_SCORE'` 승격
- Shadow 매매 결정 입력으로 KRX prefilter 후보 사용 (LIVE 영향 0)
- ADR 발급: ADR-0513

### Phase 4 ~ 7 (각 단일 PR)
- `SHADOW_SCORE` → `ADVISORY` → `WEIGHTED` → `GATED` → `CORE` 점진 승격
- 각 단계 1~2개월 운영 데이터 누적 + 비교 진단 정합성 확인 후
- KIS pre-screen 흐름 제거는 CORE 승격 이후에만

## 잘못된 해결 방법 영구 차단 (사용자 §"가장 좋은 구조" 정합)

1. **KRX 단독 HARD_BLOCK** — ADR-0448 위반. sector energy 가 낮아도 일반 BUY 차단 0.
2. **신규 SSOT 첫 머지 시 CORE 단계 도입** — `OBSERVE` 단계 의무, 검증 없이 매매 결정 입력 절대 금지.
3. **KRX 실패 시 KIS 호출로 보상** — KRX unavailable → Shadow case 기록 + 신규 매수 강도 축소만, KIS 추가 호출 0건.
4. **단일 PR 통합** — Phase 1/2/3/4 분리 의무, 회귀 위험 격리.
5. **scanner 본체 (signalScanner.ts / signalScanner/**) 변경** — Phase 1/2 는 scanDiagnostics 비교 진단만, 본체 0줄 변경.
6. **sectorEnergyProvider 본체 변경** — 기존 L1~L4 fallback chain 그대로 보존, KRX-First wiring 은 외부 추가만.
7. **KRX 호출 빈도 폭증** — Phase 1 SSOT 도 기존 `fetchKrxDailyOhlcv` / `fetchKospiIndexDaily` / `fetchKosdaqIndexDaily` 재사용 의무, 신규 KRX endpoint 호출 0건.

## 안전 invariants (모든 후속 Phase 1/2/3/4/5/6 PR 의무)

1. LIVE 매매 본체 0줄 변경 (signalScanner / entryEngine / exitEngine / kisClient / orchestrator / autoTradeEngine / trancheExecutor / buyPipeline 모두)
2. KIS 주문 함수 5종 import 0건 (정적 grep 가드)
3. autoTradeEngine / orderExecutor / trancheExecutor import 0건
4. 외부 fetch / axios / node-fetch import 0건 (KRX SSOT 재사용만)
5. Gate threshold + condition weight + STRONG_BUY 조건 + requiredScore + UNKNOWN penalty 변경 0
6. virtual account 무수정
7. 자동 paper/live promotion 0
8. KRX 호출 빈도 0 변경 (기존 SSOT 재사용 의무)
9. `executionImpact: 'NONE'` literal type 강제 (Phase 1/2)
10. `liveExecutionAllowed: false` literal type 강제 (Phase 1/2)
11. `policyPromotionMode` 단계별 literal 강제 (`OBSERVE` Phase 1/2, `SHADOW_SCORE` Phase 3, etc.)
12. ENV `=== 'true'` 정확 비교 (ADR-0157)
13. 호출자 측 inline ENV 검사 0건 (SSOT 헬퍼 위임 의무)
14. ADR-0448 Trading Engine Liveness First 정합 (KRX 단독 HARD_BLOCK 금지)
15. ADR-0398 SectorEnergy STRONG_BUY confidence gate 정합 (sector energy 가 STRONG_BUY 승격 제한은 가능, 일반 BUY 차단은 금지)

## 본 ADR scope

- **본 ADR scope**: design SSOT, **코드 0줄 변경**, ADR 발급만.
- **Phase 1 후속 PR**: Stage 2 SSOT 신규 (ADR-0511, ~400 LoC).
- **Phase 2 후속 PR**: Stage 3 SSOT 신규 (ADR-0512, ~300 LoC).
- **Phase 3~7 후속 PR**: 점진 승격 (ADR-0513~ADR-0517).

## 운영 효과 (Phase 1 ~ Phase 7 누적, 6개월~1년 예상)

- KIS network call: scan 1회당 80~120 → 5 (READY 후보만)
- KIS quota 96% 감축 예상
- Patch-005 Circuit OPEN 상태 진입 빈도 ↓ (호출 자체가 줄어 throttle 발생 ↓)
- 보유 매도 (P0) 응답성 격상 (다른 호출 quota 점유 ↓)
- 사용자 § *"KIS를 너무 넓은 범위에 쓰고 있기 때문"* 의 구조적 해결

## 거버넌스

- [x] ADR-0146 PR 자가 review 5 카테고리 정합 (본 ADR 은 코드 변경 0, audit 분류 N/A)
- [x] ADR-0148 INDEX SSOT 정합 (다음 발급 0510 → 0511)
- [x] ADR-0159 별칭 정책 정합 (0510 비충돌)
- [x] KIS/KRX/Yahoo/Naver outbound 0 (design 문서)
- [x] 외부 패키지 추가 0건
