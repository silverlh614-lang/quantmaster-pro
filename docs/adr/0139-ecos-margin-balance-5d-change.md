# ADR-0139: ECOS 신용공여잔액 5일 변화율 페치 인프라 (사용자 P2)

## 상태

채택 (2026-05-01)

## 배경

사용자 5/1 audit 12 아이디어 중 #7 — *"KIS 신용잔고 시장 5일 변화율 — `marginBalance5dChange` 결손 해소"*. 코드베이스 audit 결과:

- `MacroState.marginBalance5dChange?: number` 필드 **존재** (이미 schema 등록)
- `regimeBridge.buildRegimeVars` 에서 `?? 0` fallback 사용 중 (라인 63)
- `enemyChecklistFlag` 가 입력으로 사용 중 (신용잔고 ≥5% → ENEMY 플래그)
- `macroDigestReport` 표시 라인 존재
- **하지만 *영속 writer 부재*** — 어디에서도 `marginBalance5dChange` 를 갱신하지 않음. 영원히 0 fallback (silent degradation).

코드 주석 (`marketDataRefresh.ts:18`): *"⑥ 신용: marginBalance5dChange — KRX 데이터 별도 필요"* — 미구현 명시. 페르소나 자료 #6 *신용잔고 과열 감시* 시그널 데이터 입력 부재.

## 결정

### Track 1 — ECOS 우선 (한국은행 공식)

**ECOS API 우선** 선택 사유:
1. 한국은행 공식 데이터 (KRX/KIS 비공식 → ECOS 공식)
2. 코드베이스에 ECOS 클라이언트 (`server/clients/ecosClient.ts`) 6 시리즈 이미 존재 → 인프라 재사용
3. KIS quota 절약 (KIS 신용잔고 endpoint 미확정 + ENV 우회 부담)
4. ADR-0071 USD/KRW dual-source 패턴 차용 가능 (후속 PR 에서 KRX 추가)

ECOS 신용공여 시리즈 — `ECOS_STAT.MARGIN_LOAN` 신규 추가:
- 통계코드 추정: `129Y003` (예금취급기관 가계대출) 또는 `159Y004` (신탁회사 신용공여)
- ENV 우회 가능: `ECOS_MARGIN_LOAN_STAT_CODE` + `ECOS_MARGIN_LOAN_ITEM_CODE` (운영 환경 검증 후 즉시 수정)
- default 값은 추정 — 운영 첫 호출 시 검증 필수

### Track 2 — `fetchLatestMarginBalance5dChange()` SSOT

**`server/clients/ecosClient.ts`** 에 함수 추가:

```typescript
export async function fetchLatestMarginBalance5dChange(): Promise<MarginBalance5dResult | null>;
```

반환 타입:
```typescript
export interface MarginBalance5dResult {
  changePct: number;       // 5영업일 변화율 (%)
  latestDate: string;      // YYYY-MM-DD
  fetchedAt: string;       // ISO
  source: 'ECOS_API';
}
```

- ECOS_API_KEY 미설정 + ECOS_API_DISABLED → null
- 표본 < 6개 (5일 변화율 계산 불가) → null
- 가장 최근 값 vs 5영업일 전 값 → `safePctChange` 사용 (ADR-0028 sanity 보호)
- 실패 → null (silent degradation 차단, throw 안 함)
- 10분 캐시 (다른 ECOS 시리즈 정합)

### Track 3 — `MacroState` schema 확장

```typescript
marginBalance5dChange?: number;          // 이미 존재 (변경 없음)
marginBalanceFetchedAt?: string;         // 신규: ISO 응답 시각
marginBalanceSource?: 'ECOS_API' | 'NONE'; // 신규: 마지막 갱신 성공 여부
```

ADR-0136 패턴 차용 — `programSource` / `fssRecordsAge` 와 동일 silent degradation 차단 마커.

### Track 4 — `marketDataRefresh` wiring

`refreshMarketRegimeVars()` 의 KRX 공매도 비율 (⑥) 다음에 `⑥-b` 섹션 추가:

```typescript
const marginResult = await fetchLatestMarginBalance5dChange().catch(() => null);
if (marginResult) {
  computed.marginBalance5dChange = marginResult.changePct;
  computed.marginBalanceFetchedAt = marginResult.fetchedAt;
  computed.marginBalanceSource = 'ECOS_API';
} else {
  computed.marginBalanceSource = 'NONE';
}
```

### Track 5 — `/margin_balance` 텔레그램 진단 명령

**`server/telegram/commands/system/marginBalance.cmd.ts` 신규**:

- name: `/margin_balance`, alias `/margin` `/mb`
- category: `SYS`, riskLevel: 0, visibility: `ADMIN`
- 출력:
  - 실시간 (ECOS 직접 호출) — 5일 변화율 + 최신 일자 + KST 시각
  - macroState 영속 — 직전 cron 결과 + Source (ECOS_API / NONE / 미수집)
  - ENV 안내 — STAT_CODE / ITEM_CODE 검증 필요 시
  - enemyChecklist 임계 (≥5%) 안내

## 결과

### 운영 효과 (배포 후)

1. `marginBalance5dChange` 영속 writer 처음 마련 — `regimeBridge`/`enemyChecklist`/`macroDigestReport` 가 처음으로 *실제 데이터* 사용 (이전엔 영원히 0 fallback).
2. `enemyChecklistFlag` 가 신용잔고 5% 이상 종목을 정확 차단 — 페르소나 자료 #6 시그널 0→1.
3. macroDigestReport 일일 알림에 신용잔고 변화 정확 표기.

### KIS quota 영향

- ECOS 호출 — 추가 KIS quota 소비 0건. cron 1회당 ECOS 1 호출.
- 사용자 명령 1회당 단발성 1 호출.

### 절대 규칙 정합

- **#2 kisClient 단일 통로**: 본 PR KIS 미사용 (ECOS) — 영향 없음
- **#3 stockService 단일 통로**: macroState 영속 — 자동매매 경로 무영향
- **#4 autoTradeEngine 단일 통로**: 매매 결정 변경 0줄 — 페치 인프라 + 영속 + 진단만
- **LIVE 매매 본체 0줄 변경**

## 회귀 테스트

- `ecosClient.marginBalance.test.ts` — fetchLatestMarginBalance5dChange:
  - ECOS_API_KEY 미설정 시 null
  - ECOS_API_DISABLED=true 시 null
  - 표본 < 6 null
  - 정상 응답 → MarginBalance5dResult
  - safePctChange null 시 null
  - 캐시 동작
  - throw → null
- `marketDataRefreshMarginBalance.test.ts` — wiring 정적 grep:
  - import 존재
  - ⑥-b 섹션 위치
  - ECOS_API / NONE 분기
  - catch graceful
- `marginBalance.cmd.test.ts` — 메시지 빌더 + execute:
  - 실시간 정상 + 영속 비교
  - 실시간 null 운영자 안내
  - 영속 source 분기 (ECOS_API / NONE / 미수집)
  - 5% 임계 안내

## 잔여 후속 PR (scope 외)

1. **wiring**: 의사결정 wiring (regime 가중치 / enemyChecklist 활성화) 은 본 PR scope 밖
2. **dual-source**: ECOS + KRX 신용공여 cross-validation (ADR-0071 패턴 차용)
3. **STAT_CODE 검증**: 운영 환경에서 첫 호출 후 ENV override 필요 시 즉시 적용
