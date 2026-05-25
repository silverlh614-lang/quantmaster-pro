# ADR-0519 — UnifiedSourceSnapshot & SymbolDataCollector

**Status:** Proposed  
**Date:** 2026-05-25  
**Domain:** Trading Engine / Data Collection  
**Author:** architect  
**References:** 9대 불변식 #3, ADR-0134 (persymbol-evaluation-decomposition), ADR-0135 (kisclient-decomposition), ADR-0147b (signalScanner-orchestration-migration)

---

## Context

### 문제

`buyListLoop` 내에서 Gate0~Gate3와 `injectPerSymbolSupplyContext`가 KIS API를 종목당 독립적으로 호출한다.

```
buyListLoop(candidates)
  └─ for each candidate:
       ├─ Gate1: fetchKisStockDailyBars()     ← 종목당 1회
       ├─ Gate1: fetchKisInvestorFlow()       ← 종목당 1회 (중복)
       ├─ Gate2: fetchKisStockDailyBars()     ← 종목당 2회째
       ├─ Gate2: fetchKisStockProgramTrade()  ← 종목당 1회
       └─ injectPerSymbolSupplyContext:
            fetchKisInvestorFlow()            ← 종목당 3회째 (중복)
```

이 구조는 두 가지 근본 문제를 야기한다.

1. **중복 API 호출** — 동일 종목에 대해 `fetchKisInvestorFlow`가 Gate1·Gate2·injectPerSymbolSupplyContext에서 각각 독립 호출된다. 후보 종목 100개 기준 최대 300회 KIS REST 호출이 논리적으로 100회로 압축 가능하다.

2. **9대 불변식 #3 미충족** — "모든 판단은 단일 SourceSnapshot에서 출발한다" 원칙에 따르면, Gate0~Gate3는 동일 수집 원본에서 파생된 데이터를 소비해야 한다. 현재 Gate별 독립 fetch는 수집 시점 차이(밀리초 단위)로 인해 같은 종목에 대해 Gate1과 Gate2가 서로 다른 시점의 데이터를 판단 근거로 사용할 수 있다.

---

## Decision

**SymbolDataCollector**가 `buyListLoop` 진입 전 KIS API 4개 엔드포인트를 종목당 1회 수집하여 **UnifiedSourceSnapshot**을 구성한다. 이후 Gate0~Gate3와 `injectPerSymbolSupplyContext`는 이 스냅샷을 읽기 전용으로 소비한다.

Feature flag `USE_UNIFIED_SOURCE_SNAPSHOT=true` 활성화 시 신경로, `false`(기본값) 시 기존 per-gate fetch 경로가 유지된다. 신경로와 구경로는 동시에 공존하며 flag 하나로 즉시 전환·롤백이 가능하다.

---

## Architecture

### 데이터 흐름

```
[buyListLoop 진입 전]
SymbolDataCollector
  ├─ fetchKisStockFullQuote()     × N 종목  (FHKST01010100)
  ├─ fetchKisInvestorFlow()       × N 종목  (FHKST01010300)
  ├─ fetchKisStockDailyBars()     × N 종목  (FHKST03010100, 60일)
  └─ fetchKisStockProgramTrade()  × N 종목  (FHPPG04650201)
           │
           ▼
  UnifiedSourceSnapshot
    ├─ snapshotId (UUID)
    ├─ macroContext (MacroState 복사본)
    ├─ perSymbol: Record<code, SymbolSnapshotData>
    │    ├─ quote, investorFlow, dailyBars, programTrade  (KIS 원시)
    │    ├─ technicalIndicators                           (파생 계산)
    │    └─ supplySignal                                  (파생 분류)
    └─ completionRate, collectorDurationMs, pipelinePath

[buyListLoop 내부]
Gate0 ──────────────────────┐
Gate1 ──────────────────────┤  perSymbol[code] 읽기 전용 소비
Gate2 ──────────────────────┤
Gate3 ──────────────────────┘
injectPerSymbolSupplyContext ┘
```

### 파이프라인 분기 (Feature Flag)

```
ENV: USE_UNIFIED_SOURCE_SNAPSHOT

  true  → SymbolDataCollector → UnifiedSourceSnapshot → Gates (신경로)
  false → buildLegacyPlaceholderSnapshot() → perSymbol={} → Gates 기존 fetch (구경로)
```

### 모듈 책임 분리

| 모듈 | 파일 | 책임 |
|------|------|------|
| 타입 계약 | `server/trading/sourceSnapshot/symbolSnapshotData.ts` | `SymbolSnapshotData`, `SymbolTechnicalIndicators`, `SymbolSupplySignal` 타입 정의 |
| 타입 계약 | `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts` | `UnifiedSourceSnapshot`, `UnifiedMacroContext`, `generateSnapshotId()`, `buildLegacyPlaceholderSnapshot()` |
| 수집 구현 | `server/trading/sourceSnapshot/symbolDataCollector.ts` | KIS 4개 엔드포인트 병렬 fetch + 파생 지표 계산 (engine-dev 담당) |
| Gate 소비 | `server/quantFilter.ts` → Gate0~3 | `perSymbol[code]` 읽기 전용 접근 (engine-dev 담당) |

---

## Types

### SymbolSnapshotData (`symbolSnapshotData.ts`)

종목 단위 수집 결과 컨테이너. `UnifiedSourceSnapshot.perSymbol` Record의 값 타입.

핵심 필드:
- `quote: KisStockFullQuote | null` — FHKST01010100
- `investorFlow: KisInvestorFlow | null` — FHKST01010300
- `dailyBars: KisStockDailyBar[]` — FHKST03010100 (최대 60일)
- `programTrade: KisStockProgramTrade | null` — FHPPG04650201
- `technicalIndicators: SymbolTechnicalIndicators | null` — collector 파생 계산
- `supplySignal: SymbolSupplySignal | null` — collector 파생 분류
- `dataQuality: 'FULL' | 'PARTIAL' | 'MINIMAL' | 'MISSING'`

불변 계약: `fetchedAt` 이후 필드 변경 금지. `quote === null` 이면 `dataQuality === 'MISSING'`.

### UnifiedSourceSnapshot (`unifiedSourceSnapshot.ts`)

buyListLoop의 단일 데이터 진입점.

핵심 필드:
- `snapshotId: string` — `generateSnapshotId()` 반환값 (snap\_ prefix UUID v4)
- `perSymbol: Readonly<Record<string, SymbolSnapshotData>>`
- `macroContext: UnifiedMacroContext` — macroState 핵심 필드 불변 복사본
- `completionRate: number` — FULL 등급 비율 (0.0~1.0)
- `dataSourceVersion: '2.0'`
- `pipelinePath: 'UNIFIED_SNAPSHOT' | 'LEGACY_PER_SYMBOL'`

불변 계약: `createdAt` 이후 `perSymbol` 레코드 추가·삭제·변경 금지.

---

## Migration

### Phase 0 — 타입 계약 확정 (이번 ADR)

- [x] `symbolSnapshotData.ts` — 타입 정의 완료
- [x] `unifiedSourceSnapshot.ts` — 타입 + 헬퍼 함수 완료
- [ ] ADR-0519 문서 작성 (본 파일)
- [ ] `docs/adr/INDEX.md` 다음 발급 번호 0520 갱신

### Phase 1 — SymbolDataCollector 구현 (engine-dev)

- `server/trading/sourceSnapshot/symbolDataCollector.ts` 신규 생성
- KIS 4개 엔드포인트 병렬 fetch (Promise.allSettled 패턴)
- `SymbolTechnicalIndicators` 파생 계산 (ma20/ma60/avgVolume20d 등)
- `SymbolSupplySignal` 분류 로직 (investorFlow → supplySignal label)
- `completionRate` 계산 및 `collectorDurationMs` 측정

### Phase 2 — buyListLoop 연결 (engine-dev)

- `USE_UNIFIED_SOURCE_SNAPSHOT` ENV 분기 추가
- `buildLegacyPlaceholderSnapshot()` 활용하여 Gate 인터페이스 통일
- Gate0~3에 `UnifiedSourceSnapshot` 파라미터 전달 (읽기 전용)

### Phase 3 — Gate 내부 fetch 제거 (engine-dev, 별도 PR)

- `USE_UNIFIED_SOURCE_SNAPSHOT=true` 검증 완료 후 Gate 내부 개별 fetch 제거
- `injectPerSymbolSupplyContext` 중복 fetch 경로 제거

---

## Consequences

### 긍정적 효과

- KIS API 호출 횟수 최대 60~70% 감소 (후보 100종목 기준)
- Gate별 데이터 수집 시점 불일치 제거 → 판단 일관성 향상
- 9대 불변식 #3 완전 충족
- `completionRate < 0.5` 시 조기 스캔 중단 가능 → 품질 기반 안전장치 추가

### 부정적 효과 / 트레이드오프

- SymbolDataCollector가 단일 장애점(SPOF)이 됨 → `dataQuality: 'MISSING'` 처리로 개별 종목 격리
- 스캔 사이클 시작이 Collector 완료 시까지 지연됨 → 병렬 fetch로 최소화
- Phase 1~3 구현 전까지 `USE_UNIFIED_SOURCE_SNAPSHOT=false`(기존 경로)가 기본값

---

## Alternatives Considered

### A. Gate 내부 캐시 레이어 추가

Gate마다 별도 in-memory 캐시를 두어 중복 fetch를 캐시 히트로 처리하는 방안.

거부 이유: Gate 간 캐시 공유가 필요하여 전역 상태 증가. 수집 시점 불일치 문제가 근본적으로 해결되지 않음. 불변식 #3 미충족.

### B. Gate 파라미터에 이미 수집된 데이터를 선택적으로 전달

일부 Gate에만 미리 수집한 데이터를 전달하고 나머지는 기존 fetch 유지.

거부 이유: Gate마다 다른 인터페이스가 생겨 일관성 손실. 장기적으로 유지보수 비용 증가.

### C. SourceSnapshot을 Redis 기반 공유 저장소로 구성

거부 이유: 단일 프로세스 내 스캔 사이클에서 외부 의존성 추가는 오버엔지니어링. 사이클당 in-memory 컨테이너로 충분.

---

## Rollback

`USE_UNIFIED_SOURCE_SNAPSHOT=false` (또는 ENV 삭제) 로 즉시 기존 per-gate fetch 경로 복귀.

타입 파일(`symbolSnapshotData.ts`, `unifiedSourceSnapshot.ts`)은 순수 타입 정의 + 헬퍼 함수만 포함하므로 `executionImpact: NONE` — 기존 동작에 영향 없음.

---

## References

- 9대 불변식 #3: "모든 판단은 단일 SourceSnapshot에서 출발한다"
- 9대 불변식 #9: "SourceSnapshot을 우회하여 Gate 내부에서 provider를 직접 조회하지 않는다"
- ADR-0134: persymbol-evaluation-decomposition
- ADR-0135: kisclient-decomposition
- ADR-0147b: signalScanner-orchestration-migration (6단계 오케스트레이터 패턴 참조)
- `docs/ai/03-source-snapshot-ssot.md`
- `docs/ai/02-trading-engine-rules.md`
