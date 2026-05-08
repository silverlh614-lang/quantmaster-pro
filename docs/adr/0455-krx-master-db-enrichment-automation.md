# ADR-0455: KRX Master DB Enrichment Automation

> **상태**: Accepted
> **발급일**: 2026-05-08
> **카테고리**: governance / persistence / krx-master

## 결함

KRX OpenAPI 종목기본정보 (`KrxIsuBaseInfoRow`) 가 9 필드 제공:

```typescript
export interface KrxIsuBaseInfoRow {
  code: string;
  isin: string;
  name: string;
  nameEng: string;
  listDate: string;
  market: string;
  securityType: string;
  parValue: number;
  listedShares: number;
}
```

**`server/clients/krxOpenApiMasterFetcher.ts mapBaseInfoToMaster()` 는 3 필드만 propagate**:

```typescript
out.push({ code: r.code, name: r.name, market });
```

**`server/persistence/krxStockMasterRepo.ts parseKrxMasterCsv()` 도 동일** — cols[0] (ISIN) / cols[4] (영문 종목명) / cols[5] (상장일) / cols[11] (상장주식수) 사용 가능 데이터 discard.

**결과**: ADR-0456 DART name disambiguation 의 입력 데이터 (ISIN + 영문명) 부재. 시가총액 산출 입력 (listedShares) 부재. 신규 IPO 식별 (listDate) 부재. KRX/Naver/Yahoo 다중 출처 disambiguation 의 핵심 정합 키 부재.

## 결정

`StockMasterEntry` schema 에 4 옵셔널 enrichment 필드 추가 + 두 parser (`mapBaseInfoToMaster` / `parseKrxMasterCsv`) 가 propagate. 후방호환 — 모든 필드 옵셔널, 기존 영속 데이터 그대로 read.

### 변경 매트릭스

1. **schema 격상** (`server/persistence/krxStockMasterRepo.ts:13`):
   ```typescript
   export interface StockMasterEntry {
     code: string;
     name: string;
     market: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'OTHER';
     sector?: string;
     // ADR-0455:
     isin?: string;          // 12자리 ISIN (ADR-0456 입력)
     listDate?: string;      // YYYY-MM-DD 정규화
     listedShares?: number;  // 양수 검증
     nameEng?: string;       // trim 검증 (ADR-0456 입력)
   }
   ```

2. **`mapBaseInfoToMaster()` propagate** (`server/clients/krxOpenApiMasterFetcher.ts:170~`):
   ```typescript
   const entry: StockMasterEntry = { code: r.code, name: r.name, market };
   if (r.isin && /^[A-Z0-9]{12}$/i.test(r.isin)) entry.isin = r.isin.toUpperCase();
   if (r.listDate && /^\d{4}[-/]?\d{2}[-/]?\d{2}$/.test(r.listDate)) {
     entry.listDate = r.listDate.replace(/[/]/g, '-');
   }
   if (typeof r.listedShares === 'number' && Number.isFinite(r.listedShares) && r.listedShares > 0) {
     entry.listedShares = r.listedShares;
   }
   if (r.nameEng && typeof r.nameEng === 'string' && r.nameEng.trim().length > 0) {
     entry.nameEng = r.nameEng.trim();
   }
   out.push(entry);
   ```

3. **`parseKrxMasterCsv()` extract** (`server/persistence/krxStockMasterRepo.ts:335~`):
   - cols[0] → `isin` (12자리 정규식 + 대문자 정규화)
   - cols[4] → `nameEng` (빈 문자열 skip)
   - cols[5] → `listDate` (`YYYY-MM-DD` 또는 `YYYY/MM/DD` → `-` 정규화)
   - cols[11] → `listedShares` (콤마 제거 + Number 검증)

4. **`getKrxMasterEnrichmentCoverage()` 진단 SSOT** (`server/persistence/krxStockMasterRepo.ts`):
   ```typescript
   export interface KrxMasterEnrichmentCoverage {
     total: number;
     isinCoveragePct: number;
     listDateCoveragePct: number;
     listedSharesCoveragePct: number;
     nameEngCoveragePct: number;
   }
   ```

### 검증 정책 (사용자 명시 절대 변경 금지)

- **모든 4 필드 옵셔널** — 필수 격상 금지 (Tier 1 CSV 부재 시점 호환 보존)
- **기존 reader 무영향** — `getStockByCode`/`getStockByName`/`extractStocksFromText` 로직 0줄 변경
- **외부 API 호출 추가 0건** — 이미 fetch 한 KrxIsuBaseInfoRow 데이터만 활용 (Tier 0 OpenAPI / Tier 1 CSV 양쪽)
- **영속 schema 마이그레이션 강제 금지** (사용자 4/30 정책 정합) — 기존 영속 데이터 undefined 유지 + 다음 refresh 부터 자연 채움

## 12 Invariants

1. **LIVE 매매 본체 0줄 변경** — signalScanner / entryEngine / exitEngine/** / kisClient/** / orchestrator/** / autoTradeEngine* / trancheExecutor / buyPipeline 모두 0줄
2. **KIS 주문 함수 5종 import 0건** (정적 grep 가드)
3. **외부 API 호출 추가 0건** — 이미 fetch 한 KrxIsuBaseInfoRow 데이터만 활용
4. **KRX/Yahoo/Naver outbound 빈도 0 변경** — Tier 0/1 fetch 정책 보존
5. **`autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건**
6. **Gate threshold + condition weight + STRONG_BUY 조건 0 변경**
7. **virtual account holdings/cash 무수정**
8. **ENV 신규 도입 0건** — 옵셔널 schema enrichment 항상 안전
9. **외부 패키지 추가 0건**
10. **후방호환 보존** — 기존 영속 데이터 (`data/krx-stock-master.json`) 그대로 read, 옵셔널 필드 undefined 유지
11. **ADR-0456 DART disambiguation 입력 데이터 마련** — `isin` + `nameEng` 두 필드가 다음 단계의 핵심 정합 키
12. **ADR-0157 ENV 정확 비교 의무 무관** — 본 PR ENV 신규 0건

## 잘못된 해결 방법 영구 차단

- **enrichment 필드 필수 격상** — `isin: string` (옵셔널 → 필수) 시 Tier 1 CSV 부재 시점 호환 깨짐. 옵셔널 보존 의무.
- **별도 enrichment 영속 파일 신설** (`data/krx-stock-master-enrichment.json` 등) — 단일 master SSOT 분리 위반. `StockMasterEntry` 단일 schema 보존.
- **외부 fetch 추가** (Naver Mobile / Yahoo / KIS CTPF1002R 등) — 이미 KrxIsuBaseInfoRow 가 4 필드 제공하므로 추가 호출 비용 0 으로 해결 가능. Naver Mobile fallback 확장은 별도 ADR scope.
- **영속 schema 마이그레이션 강제** — 사용자 4/30 정책 *"강제 마이그레이션 금지"* 정합. 기존 영속 데이터는 다음 refresh 사이클에서 자연 채움.
- **listDate `YYYYMMDD` → `YYYY-MM-DD` 강제 정규화** — KRX OpenAPI raw 형식이 `YYYYMMDD` (no separators) 일 수 있음. 현재 PR 은 `[-/]` separator 정규화만 (slash → hyphen), no-separator 형식은 그대로 보존 (Number 비교 시 정합 보존).
- **`isin` 형식 위반 시 throw** — silent skip 으로 graceful 처리. KRX 일시 형식 변경 시 master refresh 차단 위험 회피.

## 회귀 검증

- `npx vitest run server/persistence/krxStockMasterEnrichmentAdr0455.test.ts` — **23/23 PASS**
- 기존 `server/clients/krxOpenApiMasterFetcher.test.ts` 1 케이스 정합 정정 (mapBaseInfoToMaster 정상 매핑 deep-equal — listDate / listedShares 추가 propagate 반영)
- 인접 server/persistence/krxStockMasterRepo + server/clients/krxOpenApi — pre-existing baseline 7 fail 그대로 (본 PR 무관, git stash 동일 재현)
- `npm run lint` EXIT=0
- `git merge-tree origin/main HEAD` 충돌 marker 0건

## 후속 PR

- **ADR-0456**: DART name disambiguation — 본 PR 의 `isin` + `nameEng` 입력 활용 (사용자 3순위 마지막 단계)
- Naver Mobile fallback enrichment 확장 (Tier 2 enrichment, 별도 ADR scope)
- Tier 0 OpenAPI listDate `YYYYMMDD` → `YYYY-MM-DD` 정규화 (현재 KRX raw 형식 그대로 보존, 운영 데이터 누적 후 별도 ADR)

## 참고

- ADR-0011 KRX 단일 통로 (PR-25-A)
- ADR-0013 multi-source stock master (4-tier fallback)
- ADR-0148 INDEX SSOT
- ADR-0413 stock master evening cron
- ADR-0454 SilentDegradation MacroState.sectorEnergyInputs writer wiring (사용자 3순위 두 번째 단계)
- `server/persistence/krxStockMasterRepo.ts` (StockMasterEntry SSOT)
- `server/clients/krxOpenApiMasterFetcher.ts` (Tier 0 OpenAPI)
- `server/clients/krxOpenApi.ts` (KrxIsuBaseInfoRow 정의)
