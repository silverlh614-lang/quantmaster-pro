# ADR-0413 — Stock Master 저녁 갱신 Cron (KIS 토큰 cron 패턴 정합)

**상태**: Accepted
**머지 일자**: 2026-05-06
**관련**: ADR-0013 (multi-source stock master), ADR-0147a (KIS 토큰 디스크 영속), ADR-0242 (stockMaster 자동 보완), ADR-0245 (정합성 검증), ADR-0395 (P2 영속 ExecutionMode)

## 배경

`server/scheduler/maintenanceJobs.ts` 의 `stock_master_auto_enrichment` cron 은 KST 평일 06:00 (UTC 21:00 전일) 단일 발동. KIS 토큰 갱신 cron 은 `kis_token_refresh` jobName 으로 1일 2회 (KST 08:30 + 20:30) 발동하는 반면, stockMaster 갱신은 *장 시작 전 1회만* — 장 마감 (15:30 KST) 후 14시간 동안 갱신 0건 → 저녁 시간대 master staleness 위험.

**구체적 결함 시나리오**:

1. 평일 06:00 갱신 후 KRX OpenAPI 일시 장애 발생 → 그날 master 갱신 실패
2. `data_verification_batch` (16:30 KST) 에서 stale master 사용 → false positive 검증 결손
3. 다음 영업일 06:00 까지 36시간 동안 stale master
4. `/krx_master_status` 진단 명령에서 staleness 감지되어도 운영자 수동 `/kmr` (= `/krx_master_refresh`) 호출 의존

사용자 요청: *"kis 토큰 인증과 마찬가지로 /kmr 로 krx 호출을 하도록 한다 (현재는 6시에 한번만 하는데 저녁에도 한번 더 갱신하도록)"* — KIS 토큰 cron 패턴 (08:30 + 20:30) 정합으로 stockMaster 갱신도 1일 2회 발동.

## 결정

**KST 평일 19:00 (UTC 10:00) 두 번째 cron 추가** + 동일 jobName `stock_master_auto_enrichment` 사용 (KIS 토큰 cron 패턴 정합).

```typescript
// 장전 06:00 KST (기존)
scheduledJob('0 21 * * 0-4', 'TRADING_DAY_ONLY', 'stock_master_auto_enrichment',
  () => runStockMasterEnrichmentCron('장전 06:00 KST'), { timezone: 'UTC' });

// 장후 19:00 KST (신규, ADR-0413)
scheduledJob('0 10 * * 1-5', 'TRADING_DAY_ONLY', 'stock_master_auto_enrichment',
  () => runStockMasterEnrichmentCron('장후 19:00 KST'), { timezone: 'UTC' });
```

### 시간 결정 근거 (KST 19:00)

| 시각 | 이벤트 | 본 cron 과의 시간차 |
|------|--------|---------------------|
| 15:30 | KRX 장 마감 | -3h 30m (충분한 데이터 안정화 시간) |
| 16:30 | `data_verification_batch` (ADR-0128) | -2h 30m (verification 사용 데이터 확정 후) |
| **19:00** | **stockMaster 저녁 갱신 (ADR-0413)** | — |
| 20:30 | KIS 토큰 갱신 (ADR-0147a) | +1h 30m (token 갱신 직전 master fresh 확보) |
| 다음 영업일 06:00 | stockMaster 장전 갱신 | +11h |

KIS 토큰 갱신 (20:30) 직전이라 token-master 신선도 정합. KRX 휴장일은 ScheduleClass='TRADING_DAY_ONLY' 가드로 자동 skip.

### `runStockMasterEnrichmentCron(label)` 헬퍼 SSOT

KIS 토큰 cron 의 `forceRefreshKisTokenCron(label)` 패턴 정합. label 은 진단 로그 prefix 에 포함되어 운영자가 어느 시간대 발동인지 즉시 식별 가능:

```
[StockMasterAutoEnrichment] (장전 06:00 KST) source=KRX_DIRECT total=2784 ...
[StockMasterAutoEnrichment] (장후 19:00 KST) source=KRX_DIRECT total=2784 ...
```

cron 콜백 본체 중복 제거 + 향후 갱신 시간대 추가 시 헬퍼 1 위치만 수정.

### jobName 정책

KIS 토큰 cron 의 동일 jobName 패턴 (`kis_token_refresh` 두 번 등록) 정합. metric 합산으로 운영자가 *총 stockMaster 갱신 시도/성공/실패* 를 단일 jobName 으로 추적. 시간대별 분리 진단은 console 로그의 label 로 충분.

## 절대 원칙

1. KIS 토큰 cron 패턴 (08:30 + 20:30) 정합 — 동일 jobName + ScheduleClass.
2. 기존 06:00 cron 동작 100% 보존 — `runStockMasterEnrichmentCron` 헬퍼 추출 + label 인자 추가만.
3. KRX 휴장일 자동 skip — ScheduleClass='TRADING_DAY_ONLY' (ADR-0045 정합).
4. `STOCK_MASTER_AUTO_ENRICHMENT_DISABLED=true` ENV 우회 보존 — 함수 본체 진입부 즉시 return.
5. KIS 주문 함수 / autoTradeEngine / orchestrator 본체 무수정 (절대 규칙 #2/#3/#4).
6. 신규 데이터 출처 추가 0건 — 기존 `autoEnrichAndVerifyStockMaster` 함수 재사용만.
7. 동일 jobName 두 번 등록 패턴은 KIS 토큰 cron 에서 검증된 패턴 (ADR-0147a 정합).

## 잘못된 해결 방법 영구 차단

1. **시간 분산 자동 결정** (예: master age 측정 후 동적 trigger) — ENV/cron 정적 정책이 운영자 추적성/신뢰성 측면 우월.
2. **다른 jobName 분리** (`stock_master_morning` / `_evening`) — KIS 토큰 cron 패턴 위반, metric 분산.
3. **신규 cron 본체 inline 추가** — 06:00 cron 본체 코드와 drift 위험. 헬퍼 추출 의무.
4. **일요일 추가** — KRX 휴장일이라 의미 없음. ScheduleClass 가드와 별도로 cron expression 단계에서도 평일 (`1-5`) 명시.
5. **외부 데이터 출처 변경** — `autoEnrichAndVerifyStockMaster` 본체 무수정 (ADR-0013 4-tier fallback 보존).
6. **ENV 신규 도입** — `STOCK_MASTER_AUTO_ENRICHMENT_DISABLED` 1종 보존, 시간대별 별도 ENV 도입 금지.

## ENV 우회

`STOCK_MASTER_AUTO_ENRICHMENT_DISABLED=true` (기존, ADR-0242) — 두 cron 모두 동일하게 적용. 함수 본체 (autoEnrichAndVerifyStockMaster) 진입부에서 즉시 return → 회귀 발견 시 1줄로 두 cron 모두 비활성화.

## 운영 효과 (배포 직후)

1. KRX 일시 장애로 06:00 갱신 실패 시 19:00 두 번째 시도로 자연 회복.
2. 저녁 시간대 stockMaster staleness 차단 — KIS 토큰 (20:30) 갱신 시점 master fresh 보장.
3. `data_verification_batch` (16:30) 직후 + KIS 토큰 갱신 (20:30) 직전 *최적 시각* 갱신.
4. `/krx_master_status` 진단에서 stale 감지 빈도 감소 → 운영자 수동 `/kmr` 호출 부담 감소.
5. KRX 휴장일 자동 skip (ScheduleClass) — 휴장 다음날 첫 거래일 06:00 갱신은 휴장 전 마지막 19:00 갱신 데이터로 fresh.

## 검증

- 회귀 테스트 정적 grep 가드 — `maintenanceJobs.ts` 에 `stock_master_auto_enrichment` cron 정확 2건 등록 검증.
- ENV 정확 비교 (ADR-0157) — 기존 `STOCK_MASTER_AUTO_ENRICHMENT_DISABLED` 동작 무수정.
- LIVE 매매 본체 0줄 변경 — `signalScanner` / `entryEngine` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` 모두 0 LoC.

## 잔여 후속 PR (scope 외)

1. `getAllJobMetrics` 의 jobName 별 집계가 시간대 라벨까지 분리 표시 (현재 합산) — 별도 PR.
2. KIS 토큰 cron 의 동일 jobName 패턴 운영 데이터 누적 후 별도 jobName 분리 결정 (label 만으로 충분한지 운영자 검증).
3. `/krx_master_status` 명령 응답에 *마지막 갱신 시간대* (06:00 vs 19:00) 표기 — 별도 PR.
4. 평일 19:00 vs 다른 시각 (예: 16:35 verification batch 직후 5분 후) 운영 데이터 비교 후 시각 재조정 — 1주 운영 후 결정.

## 거버넌스 정합

- ADR-0146 PR 자가 review 5 카테고리 모두 PASS.
- ADR-0148 4 정적 검증 baseline 무회귀.
- ADR-0157 ENV 정확 비교 의무 무관 (본 PR ENV 신규 도입 0건).
- ADR-0159 별칭 정책 정합 (충돌 부재 — 별칭 부여 0).
- ADR-0146 §"PR 자가 review 체크리스트" §"📅 거버넌스" CLAUDE.md 변경 이력 한 줄 추가 의무 충족.
