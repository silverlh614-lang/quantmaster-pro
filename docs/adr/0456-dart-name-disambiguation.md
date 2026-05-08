# ADR-0456: DART Name Disambiguation

> **상태**: Accepted
> **발급일**: 2026-05-08
> **카테고리**: governance / persistence / dart / disambiguation

## 결함

`server/alerts/dartPoller.ts:567, 795` 두 위치 모두 동일 패턴:

```typescript
const stockCode = (d.stock_code ?? '').padStart(6, '0');
```

DART `/list.json` API 가 disclosure 를 `stock_code` 필드 없이 반환하는 경우 (비상장 corp 또는 KOSPI/KOSDAQ 외 거래소 corp) → `padStart('000000')` → `watchCodes.has('000000')` 항상 false → disclosure **영구 손실**.

**손실 시나리오**: 사용자 watchlist 에 005930 (삼성전자) 가 등록되어 있고 DART 가 `corp_name='삼성전자'` 로만 disclosure 를 반환할 때 (드물지만 존재), 시스템은 watchlist 매칭 실패 → 텔레그램 알림 0건 → 운영자 인지 부재.

## 결정

ADR-0455 (PR #728) 가 마련한 `StockMasterEntry.isin` + `nameEng` enrichment 입력을 사용해 DART corpName / ISIN / 영문명 → stockCode 역매핑 SSOT 신설 + `dartPoller.ts` 두 위치 fallback wiring.

### 변경 매트릭스

1. **신규 SSOT** `server/persistence/dartCorpNameLookup.ts` (~150 LoC):
   - `lookupStockCodeByIsin(isin)` — ADR-0455 isin 입력 (12자리 정규식 + 대문자 정규화)
   - `lookupStockCodeByExactName(nameKo, nameEng)` — 한국어 우선 → 영문 fallback (정확 일치만, no fuzzy)
   - `diagnoseCorpNameMatch(corpName)` — 모호성 진단 SSOT (0/1/2+ matches, ambiguous boolean)
   - `resolveStockCodeFromDart(input)` — 진입점 (6 source 분기: DART_RAW / ISIN_LOOKUP / NAME_KO_LOOKUP / NAME_ENG_LOOKUP / AMBIGUOUS / NOT_FOUND / DISABLED)
   - `isDartNameDisambiguationDisabled()` — ENV gate (ADR-0157 정확 비교)

2. **`dartPoller.ts:567` LLM disclosure 핸들러** wiring:
   ```typescript
   const resolved = resolveStockCodeFromDart({ dartStockCode: d.stock_code, corpName });
   const stockCode = resolved.stockCode ?? (d.stock_code ?? '').padStart(6, '0');
   ```

3. **`dartPoller.ts:795` Fast disclosure 핸들러** 동일 wiring.

4. **graceful fallback 보존** — `resolved.stockCode === null` 시 legacy `padStart('000000')` 동작 그대로 (회귀 안전망).

### 우선순위 결정 트리 (사용자 명시 절대 변경 금지)

1. **DART_RAW** — `dartStockCode` 가 6자리 정수 + ≠`'000000'` → 그대로 사용 (정상 경로)
2. **ISIN_LOOKUP** — ADR-0455 isin 가용 시 reverse mapping
3. **NAME_KO_LOOKUP** — corpName 한국어 정확 일치
4. **NAME_ENG_LOOKUP** — corpNameEng 영문 정확 일치 (대소문자 무관)
5. **AMBIGUOUS** — 한국어 다중 매칭 시 null + 진단 (fuzzy 도입은 별도 ADR)
6. **NOT_FOUND** — 모든 입력 부재
7. **DISABLED** — ENV `DART_NAME_DISAMBIGUATION_DISABLED=true` 시 null (legacy 동작 100% 복원)

## 12 Invariants

1. **LIVE 매매 본체 0줄 변경** — signalScanner / entryEngine / exitEngine/** / kisClient/** / orchestrator/** / autoTradeEngine* / trancheExecutor / buyPipeline 모두 0줄
2. **KIS 주문 함수 5종 import 0건** (정적 grep 가드)
3. **외부 API 호출 추가 0건** — `getAllStockEntries()` (krxStockMasterRepo) read-only
4. **autoTradeEngine / orderExecutor / trancheExecutor import 0건**
5. **Gate threshold + condition weight + STRONG_BUY 조건 0 변경**
6. **virtual account holdings/cash 무수정**
7. **graceful fallback 보존** — `resolved.stockCode === null` 시 legacy `padStart('000000')` 동작 그대로 (회귀 안전망)
8. **fuzzy 매칭 도입 0건** — 정확 일치만, Levenshtein/Jaro-Winkler 는 별도 ADR scope
9. **ENV `DART_NAME_DISAMBIGUATION_DISABLED=true` 1줄 즉시 legacy 동작 100% 복원** (ADR-0157 정확 비교)
10. **외부 패키지 추가 0건**
11. **persistence schema 변경 0건** — `dartRepo.ts` / DartAlert / 기타 영속 schema 모두 무수정 (ADR-0455 의 StockMasterEntry 만 read-only 사용)
12. **ADR-0455 입력 데이터 (`isin` + `nameEng`) 활용** — ADR-0455 promise 직접 충족

## 잘못된 해결 방법 영구 차단

- **fuzzy 매칭 본 PR 통합** — Levenshtein/Jaro-Winkler 알고리즘 도입은 운영 데이터 누적 + 사용자 명시 결정 후 별도 ADR scope
- **DART API 추가 호출** — `/company.json?stock_code=` 추가 호출은 비용 + DART quota 부담 → 본 PR 은 read-only KRX master 활용
- **dartPoller `padStart('000000')` 영구 제거** — graceful fallback 으로 보존 (resolved=null 시 legacy 동작 → 회귀 안전망)
- **다중 매칭 시 첫 항목 자동 선택** — silent ambiguous resolution 위험. 명시 null + 진단 로그 + 운영자 검토 (별도 ADR fuzzy scope)
- **별도 영속 cache 신설** (`data/dart-corp-name-cache.json`) — 단일 SSOT 보존 의무. ADR-0455 StockMasterEntry 만 read-only 사용.
- **persistence schema 변경** — DartAlert / dartRepo 본체 무수정 (read-only fallback wiring 만)
- **ENV default ON** — 옵셔널 fallback 이라 default 활성화 안전 (사용자 운영 환경에서 disclosure 손실 즉시 차단). ENV `DISABLED=true` 만 운영자 명시 활성화.

## 회귀 검증

- `npx vitest run server/persistence/dartCorpNameLookupAdr0456.test.ts` — **35/35 PASS**
  - ENV gate 4 (default OFF + 'true' / '1'·'TRUE'·'yes' 거부 / 'false')
  - lookupStockCodeByIsin 6 (빈 입력 / 빈 master / 정상 / 소문자 정규화 / 형식 위반 / isin 부재 entry 무시)
  - lookupStockCodeByExactName 7 (한국어 정확 / 영문 정확 / 한국어 우선 / 영문 fallback / 빈 입력 / 한국어 모호 / 영문 모호)
  - diagnoseCorpNameMatch 6 (빈 입력 / 정확 1건 / 영문 매칭 / dedup / 다중 ambiguous / 매칭 없음)
  - resolveStockCodeFromDart 11 (DART_RAW / `'000000'` fallback / ISIN / 한국어 / 영문 / 모호 / 부재 / master 부재 / DISABLED / 우선순위 / 회귀 시나리오)
  - dartPoller wiring 정적 grep 가드 1 (import + 2 wiring site + legacy padStart 보존 + ADR-0456 추적)
- 인접 server/persistence/krxStockMasterRepo + server/persistence/krxStockMasterEnrichmentAdr0455 + server/alerts/dartPoller — 66/66 PASS (무회귀)
- `npm run lint` EXIT=0
- `git merge-tree origin/main HEAD` 충돌 marker 0건

## 운영자 활성화

- **default ON** — ENV 부재 시 자동 활성화 (옵셔널 fallback 이라 default 안전, 사용자 환경 disclosure 손실 즉시 차단)
- **ENV `DART_NAME_DISAMBIGUATION_DISABLED=true`** → 1줄 즉시 legacy 동작 100% 복원 (회귀 위험 격리 안전망)

## 후속 PR

- Fuzzy name 매칭 (Levenshtein/Jaro-Winkler) — 운영 데이터 1~2주 누적 + ambiguous 빈도 측정 후 별도 ADR
- DART corp_code 영속 cache (`data/dart-corp-codes.json`) — 24h in-memory cache 의 영속화, 별도 ADR
- `dartPoller` 의 `analyzeOwnershipChange(corpName, ...)` 위치에서 ambiguous corpName 진단 노출 (현재는 silent first-match)

## 사용자 3순위 (잔여 부채 정리) 시리즈 완료

- **ADR-0453**: ADR Index 22 violations baseline retrofit (첫 단계, PR #726)
- **ADR-0454**: SilentDegradation MacroState.sectorEnergyInputsUpdatedAt writer wiring (두 번째 단계, PR #727)
- **ADR-0455**: KRX master DB enrichment automation (세 번째 단계, PR #728)
- **ADR-0456**: DART name disambiguation (마지막 단계, 본 PR)

## 참고

- ADR-0148 INDEX SSOT
- ADR-0157 ENV 정확 비교 의무
- ADR-0455 KRX master DB enrichment automation (입력 데이터 마련)
- `server/persistence/krxStockMasterRepo.ts` (StockMasterEntry SSOT — `isin` / `nameEng` 입력)
- `server/clients/dartFinancialClient.ts:48-76` (기존 corp_code lookup, 본 PR 변경 0)
- `server/alerts/dartPoller.ts:567, 795` (wiring 위치)
