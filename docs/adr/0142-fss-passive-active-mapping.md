# ADR-0142: FSS Passive/Active 매핑 정책 (Stage 2 — default OFF)

## 상태

**초안 + helper 도입 (default OFF)** (2026-05-01)

매핑 *정책* 자체는 *데이터 부재* 상태에서 채택하지 않음. helper SSOT 만 도입하고
`FSS_MAPPING_ENABLED=true` ENV 명시 활성화 시에만 작동. 운영자가 *Stage 1
(ADR-0141)* 데이터 1~2주 누적 후 매핑 검증 후 활성화 결정.

## 배경

ADR-0141 Stage 1 이 KRX 11분류 raw 데이터를 일자별 영속 — 매핑 정책 검증
*데이터 기반* 가능 인프라 마련. 본 ADR-0142 는 매핑 정책 *후보* 명문화 + helper
도입 + ENV 우회 default OFF.

사용자 명시 *통념 추정 위험* 차단 — *데이터 검증 없이 통념 매핑* 적용 시
페르소나 의사결정이 잘못된 가정 위에 자동화되는 위험.

## 매핑 후보 (검증 대기, *데이터 누적 후 ENV 활성화 결정*)

KRX 11 카테고리:
1. 금융투자 (자기자본 매매)
2. 보험
3. 투신 (투자신탁)
4. 사모 (사모펀드)
5. 은행
6. 기타금융
7. 연기금 등
8. 기타법인
9. 개인
10. 외국인
11. 기타외국인

**후보 매핑** (사용자 5/1 audit 명시 권장안):

```typescript
const MAPPING_CANDIDATE = {
  passive: ['투신', '연기금 등', '보험'],          // 장기 자산운용 (passive)
  active:  ['금융투자', '사모', '은행', '기타금융'], // 단기 알파 추구 (active)
  foreign: ['외국인', '기타외국인'],                // 외국인 합산
  // 개인, 기타법인 — passiveActiveBoth 평가에서 제외
};
```

**매핑 근거 (검증 필요)**:
- *passive*: 투자 호라이즌 6개월~3년, 인덱스 또는 가치 추종 — 장기 외인 행동과 동행 가정
- *active*: 자기자본 알파 추구, 호라이즌 1주~1개월 — 외인 단기 알파와 동행 가정
- 양쪽 *합 양수* + 외인 합 양수 = `passiveActiveBoth=true` → R3_EARLY 트리거

**위험 (사용자 명시)**:
- 통념 매핑이 실제 시장 행동과 일치하는지 *데이터 검증 부재*
- 매핑 활성화 즉시 페르소나 의사결정 (regimeEngine R3_EARLY) 입력 변경
- 잘못된 매핑 시 trades 가 *틀린 신호* 위에 자동화

## 결정 — 3중 안전 격리

### Track 1 — Helper SSOT 도입 (코드만, 미작동)

**`server/persistence/fssMappingPolicy.ts` 신규**:

```typescript
export const FSS_PASSIVE_CATEGORIES = ['투신', '연기금 등', '보험'] as const;
export const FSS_ACTIVE_CATEGORIES = ['금융투자', '사모', '은행', '기타금융'] as const;
export const FSS_FOREIGN_CATEGORIES = ['외국인', '기타외국인'] as const;

export interface FssMappingResult {
  date: string;
  passiveNetBuy: number;   // 합산 (억원)
  activeNetBuy: number;    // 합산 (억원)
  foreignNetBuy: number;   // 합산 (억원)
  unmatched: string[];     // 매핑 미적용 카테고리 (로깅용)
}

export function mapPassiveActive(
  rows: KrxInvestorDetailRow[],
  date: string,
): FssMappingResult;

/** ENV gate — default OFF, 사용자 명시 활성화 시에만 활성화. */
export function isFssMappingEnabled(): boolean {
  return process.env.FSS_MAPPING_ENABLED === 'true';
}
```

### Track 2 — `marketDataRefresh` wiring (ENV gate 안)

ADR-0141 Stage 1 ⑥-c 섹션의 `appendFssDetailRecord` 호출 직후:

```typescript
if (isFssMappingEnabled() && detailRows.length > 0) {
  const mapped = mapPassiveActive(detailRows, todayKst);
  appendFssRecord({
    date: mapped.date,
    passiveNetBuy: mapped.passiveNetBuy,
    activeNetBuy: mapped.activeNetBuy,
  });
  console.log(`[FSS Mapping] ENV ON — appendFssRecord 영속 (passive=${mapped.passiveNetBuy}, active=${mapped.activeNetBuy})`);
}
```

ENV OFF (default) → `fssRepo.appendFssRecord` 호출 0건 — PR-1 (ADR-0136) 의 silent
degradation 차단 *유지* (운영자가 검증 전까지는 안전).

### Track 3 — `/fss_mapping` 진단 명령

운영자가 *매핑 적용 결과 검증* 가능:

- name: `/fss_mapping [YYYY-MM-DD]`, alias `/fssm`
- 일자 인자 없으면 최신 record
- 출력:
  - 11 카테고리 raw → passive/active/foreign 합산 결과
  - unmatched 카테고리 (개인 / 기타법인 / 매핑 부재)
  - ENV `FSS_MAPPING_ENABLED` 현재 상태 (ON/OFF)
  - OFF 시 운영자 안내 (검증 후 활성화 권장)

**read-only — 영속 변경 0건**. 운영자가 *매핑 결과 미리 확인* 후 ENV 활성화 결정.

## 채택 절차 (운영자 결정 흐름)

1. **PR-B Stage 1 (#493) 머지** + Railway 배포
2. **운영 데이터 1~2주 누적** — 매 cron 사이클 KRX 11분류 raw 영속
3. **`/fss_mapping` 진단** — 매일/주 단위 매핑 결과 검토:
   - passive 합 / active 합 / foreign 합 분포 확인
   - 시장 행동 (KOSPI 추세, 외인 순매수 통계) 과 일치도 검증
4. **검증 통과 시** `FSS_MAPPING_ENABLED=true` ENV 활성화
5. **활성화 직후** `fssRepo.appendFssRecord` 자동 영속 시작 → PR-1 (ADR-0136)
   `passiveActiveBoth` 평가 정상 작동 → 페르소나 R3_EARLY 트리거 활성화
6. **검증 실패 시** ENV 미활성화 + 매핑 후보 재검토 (별도 ADR)

## 결과

- 매핑 helper SSOT 도입 (코드만)
- ENV gate default OFF — *통념 추정 위험* 차단
- 진단 명령으로 *데이터 기반 검증* 가능
- 활성화 결정은 운영자 명시

## 절대 규칙 정합

- **#2 kisClient 단일 통로**: 영향 없음
- **#3 stockService 단일 통로**: macroState 영속 (ENV ON 시) — 자동매매 무영향
- **#4 autoTradeEngine 단일 통로**: 매매 결정 변경 0줄 (default OFF)
- **LIVE 매매 본체 0줄 변경** (default OFF)
- **ENV ON 시**: PR-1 (ADR-0136) 의 `passiveActiveBoth` 평가 정상 작동 → regimeEngine R3_EARLY 입력 활성화

## 회귀 테스트

- `fssMappingPolicy.test.ts`:
  - `mapPassiveActive` — 11 카테고리 입력 시 passive/active/foreign 합산 정확
  - 카테고리 누락 시 0 합산 (안전 fallback)
  - unmatched 분류 (개인 / 기타법인 등) 정확
  - 음수 합산 보존
  - 거래대금 → 억원 환산 정확
  - 빈 입력 시 모두 0 + unmatched 빈 배열
  - 잘못된 date 형식 → 그대로 반환 (호출자 책임)
- `marketDataRefreshFssMapping.test.ts` — 정적 grep:
  - `isFssMappingEnabled` import 존재
  - `appendFssRecord` 호출 ENV gate 안
  - default OFF 회귀 가드
- `fssMapping.cmd.test.ts`:
  - 정상 매핑 결과 표기
  - ENV OFF 시 안내
  - 영속 부재 시 운영자 안내
  - throw graceful

## 잔여 후속 PR (scope 외)

1. **운영자 ENV 활성화** — 데이터 검증 후 명시 (코드 변경 0)
2. **매핑 후보 재검토** (검증 실패 시 별도 ADR)
3. **dual-source cross-validation** — ETF flow proxy 와 일치도 비교 (ADR-0071 패턴)
