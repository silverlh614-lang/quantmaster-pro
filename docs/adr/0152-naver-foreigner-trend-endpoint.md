# ADR-0152: Naver 외인 추세 endpoint 신설 + #4 supplyInflow 격상 (Phase 2 진정한 후속)

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase2-Real-Phase3 (PR-Phase2-KisSupplyAudit `_workspace/audit-pr-phase0/findings.md` §C15 후속)
**관련 ADR**:
- ADR-0011 (PR-25-A/B/C, AI 추천 KIS/KRX 분리) — 본 PR 정합 의무 (KIS 호출 0)
- ADR-0140 (Naver 외인 추세 영속) — 본 PR 의 데이터 인프라
- ADR-0151 (Phase 2 KIS Supply audit) — 본 PR 의 직접 후속 (옵션 B 채택)
- ADR-0152 의 다음 PR — ADR-0153 (Phase 3 globalIntel 합성)

## 문제

ADR-0151 (Phase 2 KIS Supply audit) 가 main path 의 silent degradation 차단 후 *진정한 #4 supplyInflow 격상* 을 후속 ADR 로 분리하면서 두 옵션을 제시:

- **옵션 A**: ADR-0011 정책 변경 — KIS 수급 호출 제한적 허용
- **옵션 B**: ADR-0140 추세 endpoint 신설 — Naver 외인 보유율 5d/20d 변화율 추세 활용

옵션 B 가 ADR-0011 정책 무영향 + 진정한 *흐름* 의미 정합으로 권장. 본 PR 이 옵션 B 채택.

## 결정

### 1. `GET /api/foreigner-ratio/trend?code=...` HTTP endpoint 신설

`server/routes/foreignerRatioRouter.ts` 신규. ADR-0140 영속 시계열 (`computeForeignerRatioTrend(code)`) 의 read-only 노출:

```typescript
GET /api/foreigner-ratio/trend?code=005930
→ { current: 51.2, changePct5d: +1.5, changePct20d: +2.1, sampleSize: 12, latestDate: '2026-04-30' }
→ { current: null, changePct5d: null, changePct20d: null, sampleSize: 0, latestDate: null } (영속 부재)
```

외부 호출 0건 (영속 read-only). KIS/KRX/Yahoo quota 무관. 4xx (잘못된 code) / 5xx (computeForeignerRatioTrend throw) 분기.

### 2. 클라이언트 SDK `src/api/foreignerRatioClient.ts` 신규

절대 규칙 #3 (서버↔클라 직접 import 금지) 준수 — `ForeignerRatioTrend` 타입 동기 사본. 4초 timeout + 4xx/5xx/timeout/네트워크 실패 모두 null fallback (호출자 stock.checklist 보존).

### 3. enrichment.ts main path #4 supplyInflow 격상

**임계** (audit findings §A 권장 + ADR-0140 STRUCTURAL_INFLOW_THRESHOLD 정합):
```typescript
supplyInflow:
  foreignerTrend?.changePct5d != null &&
  foreignerTrend.changePct5d >= 1.0 &&     // ≥ +1.0%p (구조적 매수)
  foreignerTrend.sampleSize >= 6           // 5d 표본 충분
    ? 1
    : (stock.checklist?.supplyInflow ?? 0); // fallback: AI 추정 보존
```

- `changePct5d ≥ +1.0%p` — ADR-0140 의 `STRUCTURAL_INFLOW_THRESHOLD=+1.0` 정합 (외인 보유율 5일간 1.0%p 이상 증가 = 구조적 매수)
- `sampleSize ≥ 6` — 5d 변화율 산출 표본 충분 (ADR-0140 `FOREIGNER_RATIO_5D_SAMPLE=6`)
- 부재/미달 → AI 추정 fallback (silent degradation 차단 — ADR-0151 정합)

### 4. main path 만 적용 (aiFallback 제외)

aiFallback 경로는 *Yahoo OHLCV 부재 시 fallback* — 외부 호출 회로 부담 차단 정책 (ADR-0028 EgressGuard 정합). 추가 fetchForeignerRatioTrend 호출 = 회로 부담 증가. 따라서 aiFallback 은 stock.checklist 보존만, 외인 추세 격상 안 적용.

ADR-0150 의 main + aiFallback 두 경로 정합 패턴과 차이 — DART 는 이미 fetchDartFinancials 가 두 경로 다 호출 (서버 캐시 효과적), 본 PR 의 fetchForeignerRatioTrend 는 *클라이언트 → 서버 endpoint* 호출 (네트워크 추가). 부담 격리 위해 main path 한정.

### 5. `buildConditionSourceTiers` 'API' 분류 추가

```typescript
if (ctx.hasForeignerTrend) {
  meta.supplyInflow = 'API';
}
```

신규 ctx 필드 `hasForeignerTrend?: boolean` 추가. main path 에서 `foreignerTrend?.sampleSize >= 6` 시 true. UI DataQualityBadge 가 #4 supplyInflow 를 'API' tier 로 표시 — 진정한 데이터 출처 정확화.

## 영향

### 27 조건 격상 진행도

| Phase | 누적 격상 % | 격상 항목 |
|---|---|---|
| Phase 1 (PR-Phase1-DartFinalize) | 52% (14개) | REAL_DATA 9 + DART 5 |
| Phase 2 (PR-Phase2-KisSupplyAudit) | 52% (14개) | *동일 — silent degradation 차단* |
| **본 PR (Phase 2 진정한 후속, ADR-0152)** | **56% (15개)** | **+ #4 supplyInflow (Naver 외인 추세)** |
| Phase 3 globalIntel 합성 (ADR-0153, 동시 진행) | 67% (18개) | + #5/#1/#16 |
| Phase 2-Real Plus (#12 institutionalBuying) | 70% (19개) | ADR-0011 정책 변경 후 별도 ADR |
| Phase 4 외부 컨센서스 (BLOCKED) | 78% (21개) | + #14/#13 |

→ 본 PR 만으로 **52% → 56%**. ADR-0153 (globalIntel 합성) 동시 진행 시 **67%**.

### LIVE 매매 영향

- ADR-0011 정책 그대로 유지 — KIS supply 호출 0건 변경
- 신규 매수 시점부터 #4 supplyInflow 가 *Naver 외인 추세 5d 변화율* 영속 (구조적 매수 신호)
- 6 영업일 누적 후 자연 활성화 (sampleSize ≥ 6 임계)
- 임계 미달 / 표본 부족 / endpoint 실패 → AI 추정 stock.checklist 보존

### KIS/KRX/Yahoo quota 영향

- KIS: 0 (ADR-0011 정책 그대로)
- KRX: 0
- Yahoo: 0
- Naver: 0 (ADR-0140 영속 시계열만 read, 추가 호출 0)
- 신규 internal HTTP: enrichment 1회당 `/api/foreigner-ratio/trend` 1 호출. 서버는 영속 파일 read-only. 응답 ~수십 ms.

## 회귀 테스트

`server/routes/foreignerRatioRouter.test.ts` 신규 (선택, computeForeignerRatioTrend mock 의존 큼) + 회귀 그리드 정합 검증 (정적 grep):
1. `enrichment.ts` 의 `fetchForeignerRatioTrend` import + main path 호출 패턴 grep
2. `foreignerTrend?.changePct5d >= 1.0` 임계 grep
3. `foreignerTrend?.sampleSize >= 6` 표본 임계 grep
4. aiFallback 경로에 fetchForeignerRatioTrend 호출 부재 (회로 부담 차단)

## ENV 우회

본 PR 미도입. 임계값 (1.0%p / 6 표본) 은 ADR-0140 정합 정책 SSOT. 향후 데이터 기반 재조정 시 본 ADR 갱신 + ENV 우회 검토 가능.

## 잔여 후속

- **#12 institutionalBuying 격상**: ADR-0011 정책 변경 후 별도 ADR (옵션 A) 또는 KRX 기관 순매수 데이터 출처 확보 후 (옵션 C — 향후 검토).
- **임계값 데이터 검증** — 1~2 주 운영 데이터 누적 후 1.0%p / 6 표본 임계 정합성 평가.
- **endpoint timeout / retry 정책** — 4초 timeout 단일 시도. 운영 모니터링 후 조정 검토.
