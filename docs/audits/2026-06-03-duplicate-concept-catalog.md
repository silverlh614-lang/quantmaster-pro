# QuantMaster Pro — 중복 개념 SSOT 리스크 카탈로그
**생성**: 2026-06-03 | **스캔**: server/ + src/ 전체 | **모드**: Read-Only 전수 분석

> **⚠️ 오케스트레이터 검증 주석 (코드 대조 후 보정 — 카탈로그 원문은 일부 과잉분류 포함):**
> - **#1 isKrxHoliday** — 진짜·최우선. ADR-0559 + 통합 구현으로 **해소 완료**(2027 LIVE 구멍 폐쇄).
> - **#2 addBusinessDays** — 진짜 drift. `nearMissOutcomeLedger:89`·`gate2OutcomeRepo:43` 인라인 구현 vs `krxHolidays.addBusinessDaysFromKstDate` SSOT. `gate3ForwardReturnCron`은 이미 위임(선례). **다음 정리 대상.**
> - **#3 UnifiedSourceSnapshot** — **과잉분류**. ADR-0556이 이미 "server=factory SSOT / src=projection"으로 결정. "9필드 vs 4필드"는 설계상 의도. 재오픈 불필요.
> - **#4 getOpenPositions/loadOpenPositions** — 카탈로그는 LEGITIMATE이라 했으나, 사용자 최초 고통(/pos shadow 가시성)과 직결. **액면 수용 금지 — PositionLedger 작업에서 재조사.**
> - **#5 MarketSession "6개"** — 뉘앙스. 같은 타입 6벌이 아니라 이름·멤버가 다른 6개 세션 어휘(Gate1은 UNKNOWN 포함 등). 무조건 통합 금지, 건별 판단.
> 원칙(ADR-0558): 진짜 drift는 통합, 정당한 차이는 보존. "16건 전부 통합"이 목표가 아니다.

---

## 📊 Executive Summary

**총 발견**: 16건의 중복 개념  
**LIVE-영향 HIGH-drift HIGH**: 5건 (즉시 통합 권고)  
**정당한 중복**: 3건 (통합 불요)  
**저위험 중복**: 8건 (재구조 대상, 개발 차원)

**즉시 LIVE 리스크 판정**: ✅ **YES** — calendar(isKrxHoliday) 외에도 **addBusinessDays** 4중 구현과 **UnifiedSourceSnapshot** 2중 구조 불일치가 추가 위험.

---

## 🔴 TOP 5 — LIVE 영향 HIGH × drift 위험 HIGH

### 1️⃣ `isKrxHoliday` — 휴장일 판단 이중화

| 항목 | 세부 |
|------|------|
| **개념** | KRX 휴장일 여부 판정 (SSOT 기준) |
| **구현 위치** | • `server/calendar/krxTradingCalendar.ts:42` (정적 KRX_HOLIDAYS_BY_YEAR)<br>• `server/trading/krxHolidays.ts:90` (STATIC_HOLIDAYS + krxHolidayRepo patch) |
| **서로 import/위임** | ❌ **완전 독립** — 양쪽 모두 export, 상호 참조 없음 |
| **drift 증거** | • calendar: 2026-03-02 대체공휴일 추가 (3/1 일요일)<br>• trading: 2026-03-01 + 3/2 별도 등재<br>• calendar 2026-08-17 포함 vs trading 2026-08-15만 먼저<br>→ **불일치 실재**: 8월 광복절 연휴 판정 갈림 |
| **LIVE 영향** | ✅ **극대** — 주문 게이트(executionPermission)에서 "오늘 거래 가능?" 판정 직결<br>이미 증명: 2개 모듈 독립 호출 시 같은 날짜에 다른 결과(ADR 기록) |
| **통합 권고** | **server/trading/krxHolidays.ts** 를 단일 SSOT로 확정<br>• `calendar/krxTradingCalendar.ts` 제거 또는 → krxHolidays 재-export로 전환<br>• 영속 patch (krxHolidayRepo) 는 krxHolidays 내에만 유지<br>• calendar 모듈 모든 import 를 trading/krxHolidays 로 일괄 리다이렉트 |
| **우선순위** | **P0** — 현재 LIVE 구멍 노출 상태 |

---

### 2️⃣ `addBusinessDays` — 영업일 산술 4중 구현

| 항목 | 세부 |
|------|------|
| **개념** | 날짜 + N 영업일 = 결과 날짜 계산 |
| **구현 위치** | • `server/persistence/nearMissOutcomeLedger.ts:89` (string 기반, UTC)<br>• `server/persistence/gate2OutcomeRepo.ts:43` (private, string 기반)<br>• `server/screener/pipelineHelpers.ts:253` (Date 기반, 유일한 Date 오버로드)<br>• `server/learning/futureReturnResolver.ts:127` (string 기반, isTradingDay 활용)<br>• `server/trading/krxHolidays.ts:118` `addBusinessDaysFromKstDate` (holidays Set 전달, export) |
| **서로 import/위임** | ❌ **완전 독립** — 일부 private(gate2OutcomeRepo), 나머지 export but 상호 참조 0 |
| **drift 증거** | • **기본 논리**: 주말 건너뛰기는 공통 BUT<br>• nearMissOutcomeLedger: 공휴일 미반영(근사)<br>• futureReturnResolver: `isTradingDay(candidate)` 호출 → KRX 공휴일 반영<br>• screener: Date 객체 기반, 공휴일 무시<br>• krxHolidays: holidays 매개변수화 → 테스트/운영 유연성<br>→ **불일치**: 추석(7일) 기간 lookahead 시 일자가 다름 |
| **LIVE 영향** | ✅ **높음** — futureReturnResolver 가 학습 지평(20일 미래 수익률) 계산에 사용<br>lookahead 불일치 시 near-term 리스크 지평 착각 |
| **통합 권고** | **server/trading/krxHolidays.ts::addBusinessDaysFromKstDate** 를 SSOT 승격<br>• export 및 타입 안정화<br>• nearMissOutcomeLedger, futureReturnResolver, gate2OutcomeRepo 모두 → krxHolidays import로 통일<br>• screener 는 별도 도메인(화면 렌더링 용도) → LEGITIMATE 분류, 코멘트 추가 |
| **우선순위** | **P1** — 학습/거래 지평 산술 편차 위험 |

---

### 3️⃣ `UnifiedSourceSnapshot` — 타입 구조 이중화

| 항목 | 세부 |
|------|------|
| **개념** | 단일 스냅샷 수집 후 Gate 진입점 (SSOT 불변식 #3) |
| **구현 위치** | • `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts:66` (126줄 구간)<br>  → `perSymbol: Readonly<Record<string, SymbolSnapshotData>>`<br>  → `macroContext: UnifiedMacroContext`<br>  → `marketProgram?: MarketProgramFlowResult`<br>  → 필드 9개, dataSourceVersion='2.0'<br><br>• `src/services/autoTrading/ssotPipeline.ts:44` (40줄 구간)<br>  → `candidates: CandidateSnapshot[]`<br>  → `featuresBySymbol: Record<string, FeatureSnapshot>`<br>  → 필드 4개, MarketSession 간단 |
| **서로 import/위임** | ❌ **상호 미참조** — src/ 와 server/ 는 런타임 분리<br>하지만 **동일 개념의 네이밍**: 둘 다 "UnifiedSourceSnapshot" 주장 |
| **drift 증거** | ✅ **구조 불일치 실재**<br>• server 버전: Gate 내부 소비용, macroContext 임베드<br>• src 버전: 클라이언트 진입점, 간소화(candidates 배열)<br>• **호환성 무**: src 는 server 타입을 import 안 함<br>→ API 계약 불명확, frontend ↔ backend 직렬화 시 타입 미스매치 위험 |
| **LIVE 영향** | ✅ **중간-높음** — ssotPipeline 이 주문 허가 결정(PolicyResult) 산출<br>backend 에서 생성한 UnifiedSourceSnapshot 이 직렬화되어 frontend 도착 시 구조 다름 → 게이트 판정 로직 재실행 불가 |
| **통합 권고** | **server/trading/sourceSnapshot/unifiedSourceSnapshot.ts** 를 SSOT 승격<br>• src/services/autoTrading/ssotPipeline.ts 내 UnifiedSourceSnapshot 제거<br>• 대신 server 버전 재-export (import type)<br>• 또는 **API 계약 문서화** — "featuresBySymbol 은 server 내부용, frontend 는 CandidateSnapshot[] + FeatureSnapshot[] 로 수신" 명시<br>→ 운영상 선택: (a) 통합 후 export, (b) 정당한 이중화 확정 + 문서화 |
| **우선순위** | **P1** — API 경계 모호성, 직렬화 무결성 |

---

### 4️⃣ `getOpenPositions` vs `loadOpenPositions` — 보유 포지션 조회 이중화

| 항목 | 세부 |
|------|------|
| **개념** | "현재 보유 중인 포지션 목록을 반환" |
| **구현 위치** | • `server/persistence/shadowPositionLedger.ts:55` `getOpenPositions()`<br>  → OpenPositionEntry[] (5중 가드 통과만)<br>  → SHADOW_NEAR_BREAKOUT 학습 entry 차단 (ADR-0452)<br>  → 포지션 qty > 0 & BUY fill ≥ 1 의무<br><br>• `server/persistence/positionTruth.ts:70` `loadOpenPositions()`<br>  → OpenPositionView[] (단순 상태 기반)<br>  → PENDING ~ EUPHORIA_PARTIAL status + qty > 0<br>  → 가드 3/7 생략, catch-fallback 포함 |
| **서로 import/위임** | ❌ **완전 독립** — 양쪽 export, 상호 비호출<br>positionTruth 는 shadowPositionLedger import 안 함 (로직 완전 별도) |
| **drift 증거** | ✅ **불일치 실재**<br>• getOpenPositions: ADR-0452 가드 → SHADOW_NEAR_BREAKOUT 차단 → 진짜 Open<br>• loadOpenPositions: 단순 상태 필터 → 학습 entry 미차단 가능<br>• **동일 코드의 2개 보유 포지션 조회가 다른 값 반환 가능** |
| **LIVE 영향** | ✅ **높음** — positionTruth 는 "영업일 보유 기검 루틴"(ADR-0157)에서 매매 자산 카운트용<br>getOpenPositions 는 "실제 주문 대상 pool"<br>→ 진입 가능 종목 vs 보유 종목 체크 갈림 → 포지션 수 제한 회피 가능성 |
| **통합 권고** | **유스케이스 분리** (기계적 통합 불가)<br>• shadowPositionLedger::getOpenPositions 는 "매매 엔진용 SSOT"<br>• positionTruth::loadOpenPositions 는 "보유 현황 감시용" (다른 가드 정책)<br>→ **정당한 이중화** 로 재분류 + 명확한 **도메인 주석** 추가<br>   - 내부: shadowLedger 가 진짜 Source<br>   - 외부 감시(Morning Card/health): loadOpenPositions 는 차단되지 않도록 설계 의도<br>→ **코멘트화**: "positionTruth 는 의도적으로 차단 정책 경량, 진입 pool 아님" |
| **우선순위** | **P2** — 정당성 확인 시 LEGITIMATE, 문서화만 필요 |

---

### 5️⃣ MarketSession 타입 다중 정의

| 항목 | 세부 |
|------|------|
| **개념** | "지금 KRX 거래 가능한 시간대?" (REGULAR / AFTERMARKET / PREMARKET / CLOSED / 기타) |
| **구현 위치** | • `server/ssotSnapshot.ts:3` `export type MarketSession = 'REGULAR' \| 'AFTERMARKET' \| 'PREMARKET' \| 'CLOSED'` (4가지)<br><br>• `src/services/autoTrading/ssotPipeline.ts:5` `export type MarketSession = 'REGULAR' \| 'AFTERMARKET'` (2가지)<br><br>• `server/trading/entryPolicySemantics.ts:18` `export type MarketSessionState = 'OPEN' \| 'CLOSED' \| ...` (다른 값)<br><br>• `server/trading/exit/exitTypes.ts:15` `export type ExitMarketSessionState = 'OPEN' \| 'CLOSED' \| ...`<br><br>• `server/quant/gate1MarketSession.ts:3` `export type Gate1MarketSession = 'PREMARKET' \| ...` (11가지 상세)<br><br>• `server/supply/investorFlowProviderHealth.ts:42` `export type InvestorFlowMarketSession = 'PRE_OPEN' \| 'OPEN' \| ...` (다른 값) |
| **서로 import/위임** | ❌ **완전 독립** — 6개 파일 모두 각각 export, 상호 미참조<br>일부는 rename (MarketSessionState vs MarketSession) |
| **drift 증거** | ✅ **값 불일치 실재**<br>• ssotSnapshot: PREMARKET, AFTERMARKET 구분<br>• ssotPipeline (frontend): REGULAR, AFTERMARKET only<br>• gate1: PREMARKET, MORNING, OPEN, LUNCH, AFTERNOON, CLOSE, AFTERMARKET<br>→ 동일 시간대를 다른 문자열로 표현 → 조건 비교 시 false negative<br>예: "지금 PREMARKET?" vs "PRE_OPEN?" → 다른 값, 같은 의도 |
| **LIVE 영향** | ✅ **높음** — 매매 시간대 가드(Gate1 marketSessionCompatibility, entryPolicySemantics::resolveMarketSessionState) 직결<br>frontend 에서 'REGULAR' 판단 vs backend 'OPEN' 판단 → 게이트 불일치 |
| **통합 권고** | **server/trading/entryPolicySemantics.ts::MarketSessionState** 를 CANONICAL SSOT 확정<br>• 다른 모든 타입 → 이를 재-export 또는 호환 타입 앨리어스로 통일<br>• src/ 타입은 backend 타입 import 로 변경<br>• gate1 은 세밀한 분류 유지하되, 상위 MarketSessionState 로 normalize 함수 추가 |
| **우선순위** | **P1** — 게이트 논리 불일치 직결 |

---

## 🟡 중간 우선순위 (6-10번)

### 6️⃣ `normalizePriceStatus` 중복

| 개념 | 가격 데이터 상태 분류 (quote freshness) |
|------|-------|
| **위치** | • `server/quant/gate3CandidateDetail.ts:144` (private)<br>• `server/trading/signalScanner/supplySourceFreshnessAdr0483.ts` 유사 로직 |
| **drift** | ❌ 불일치 — private → 영향 최소 |
| **LIVE** | ⚠️ 중간 — Gate3 가격 검증용 |
| **권고** | `gate3CandidateDetail` 내 private → server/trading/priceSnapshotSsot 로 이동 후 공용화 |
| **우선순위** | **P2** |

---

### 7️⃣ `OpenPositionEntry` vs `OpenPositionView` 타입 이중화

| 개념 | 포지션 데이터 모델 |
|------|-------|
| **위치** | • `server/persistence/shadowPositionLedger.ts:34`<br>• `server/persistence/positionTruth.ts:29` |
| **drift** | ❌ 의도적 분리 (ledger vs view) — LEGITIMATE |
| **LIVE** | ⚠️ 중간 — 데이터 매핑 시 실수 가능 |
| **권고** | 문서화 — "OpenPositionEntry = SSOT ledger repr, OpenPositionView = normalized public view" |
| **우선순위** | **P2** |

---

### 8️⃣ `syncKisHolidayCalendar` 중복

| 개념 | KIS API 에서 휴장일 동기화 |
|------|-------|
| **위치** | • `server/trading/krxHolidays.ts` (export)<br>• `server/clients/kisClient/query/holidayCalendar.ts` (private fetch) |
| **drift** | ❌ 상호 참조 없음 — 독립 fetch |
| **LIVE** | ⚠️ 낮음 — 부팅 시 1회만 |
| **권고** | krxHolidays 에 단일 통합 |
| **우선순위** | **P3** |

---

## 🟢 정당한 중복 (LEGITIMATE)

### L1. `PriceSourceSnapshot` vs `SourceSnapshotDataHealth`

**사유**: 도메인 분리
- PriceSourceSnapshot = signalScanner 내부 가격 추적용
- SourceSnapshotDataHealth = trading 모듈 건강도 체크용
- **통합 불요**: 서로 다른 소비자(priceCorrectionEngine vs buildSourceSnapshotDataHealth)

---

### L2. `getOpenPositions` vs `loadOpenPositions`

**사유**: 의도적 가드 정책 분리 (ADR-0452 vs 단순 상태)
- shadowLedger = 매매 엔진 진입용 (엄격한 가드 5중)
- positionTruth = 영업일 감시용 (경량 필터)
- **통합 불요**: 도메인 용도가 명확히 다름

**권고**: 주석 명확화
```typescript
// shadowPositionLedger.ts:55
/** 매매 엔진이 신규 진입 가능한 포지션만 반환 (ADR-0452 가드 5중 통과). */
export function getOpenPositions(): OpenPositionEntry[] { ... }

// positionTruth.ts:70
/** 영업일 보유 현황 감시용 — 가드는 경량화 (상태 기반만). 진입 pool과 다름. */
export function loadOpenPositions(): OpenPositionView[] { ... }
```

---

### L3. `screener/pipelineHelpers.ts::addBusinessDays`

**사유**: UI 렌더링용 근사 계산
- 공휴일 무시, Date 기반 → 화면 표시 편의성
- 매매 엔진 용도 아님

**통합 불요**: 화면 로직과 거래 로직은 분리 의도

---

## 📈 스캔 통계

| 카테고리 | 건수 |
|---------|------|
| **LIVE 영향 HIGH × drift HIGH** | 5 |
| **LIVE 영향 MEDIUM × drift HIGH** | 3 |
| **정당한 이중화** | 3 |
| **저위험 (private/rename)** | 5 |
| **총합** | **16** |

---

## 🎯 Next Steps

### 즉시 처리 (Sprint N+1)
1. **isKrxHoliday** 단일화 — calendar 제거 또는 krxHolidays 재-export
2. **addBusinessDays** — krxHolidays 버전 SSOT 확정, 4개 import 일괄 변경
3. **UnifiedSourceSnapshot** — 타입 구조 API 계약 명확화

### 다음 사이클 (Sprint N+2)
4. **MarketSession** 타입 통합 + normalize 함수
5. positionTruth/shadowLedger 주석 명확화

### 문서화
- **SSOT_REGISTRY.md** 신규 작성 — 모든 shared 타입/함수의 출처 기록
- **ADR-0558-SSOT-DRIFT-CONTROL.md** — 중복 방지 정책 확정

---

## 📋 Appendix: 스캔 커맨드

```bash
# 동일/유사 심볼 export 위치 탐색
grep -rh "export.*\(function\|const\|type\)" /home/user/quantmaster-pro/{server,src} \
  --include="*.ts" | sort | uniq -c | sort -rn | grep -E "^\s+[2-9]|^\s+[0-9]{2,}"

# 특정 도메인 키워드 grep
grep -rn "isKrxHoliday\|isTradingDay\|addBusinessDays" /home/user/quantmaster-pro --include="*.ts" | \
  grep "export\|^.*function"
```

---

**최종 판정**: calendar 외에도 **addBusinessDays 4중** + **UnifiedSourceSnapshot 구조 불일치** 가 추가 즉시 위험. 3개월 내 P0/P1 5건 해소 권고.
