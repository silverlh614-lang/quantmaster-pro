# ADR-0141: FSS 11분류 투자자별 매매 자동 fetcher (PR-B 출처 audit + Stage 분리)

## 상태

**초안** (2026-05-01) — 출처 후보 audit 완료, 사용자 결정 대기

## 배경

사용자 5/1 후속 보강 P0-2 — *"ADR-0141 신설 — FSS Passive/Active 자동 fetcher.
KRX 비공식 BLD 11분류 채널 또는 ETF flow proxy 결정. 자동 fetcher 가 없으면
ADR-0136 의 silent degradation 차단이 절반의 효과만 — `/fss_status` 로 알아챌
수는 있지만 고칠 수는 없습니다."*

PR-1 (ADR-0136 fast-track) 가 영속 부재 진단 가시화는 마련했지만 *영속 writer
자체* 부재. 운영자는 `POST /api/macro/fss-records` 로 수동 보강만 가능.

## 출처 후보 audit (요약)

자세한 비교: `_workspace/2026-05-01_fss-fetcher-source-audit/findings.md`

| 후보 | 인프라 재사용도 | 정확도 | 위험 |
|---|---|---|---|
| **A. KRX BLD 11분류 raw** | ✅ `krxClient.ts` 패턴 (BLD ID 추가만) | ⭐⭐⭐ raw | 비공식 endpoint (이미 사용 중) + 매핑 정책 *분리 필요* |
| **B. ETF flow proxy** | ✅ PR-5 `foreignerRatioRepo` 차용 | ⭐ 추정 | 정확도 낮음 (개별 ETF ≠ 시장) |
| **C. 하이브리드** | ✅ A+B 동시 | ⭐⭐⭐ + 검증 | 운영 복잡도 ↑ |

## 결정 — 후보 A 단계 분리

사용자 명시 *통념 추정 위험* 차단을 위해 *raw 데이터 fetch* 와 *Passive/Active
매핑 정책* 을 분리:

### Stage 1 (PR-B 본 PR scope)

**KRX 11분류 raw 데이터 fetch + 영속만** — 매핑 정책 *분리*

#### 인프라 신설

```typescript
// server/clients/krxClient.ts (확장)
const BLD_INVESTOR_DETAIL = process.env.KRX_BLD_INVESTOR_DETAIL ?? 'dbms/MDC/STAT/standard/MDCSTAT02301';

export interface KrxInvestorDetailRow {
  date: string;          // YYYY-MM-DD
  category: string;      // 한글 카테고리명 (raw 그대로 보존 — 매핑 미적용)
  netBuyKrw: number;     // 순매수 거래대금 (원)
  netBuyQty: number;     // 순매수 수량 (주)
}

export async function fetchInvestorTradingDetail(date?: string): Promise<KrxInvestorDetailRow[]>;
```

**중요 — raw 데이터 영속**:
- 11 카테고리 *그대로* 저장 (한글 키 보존)
- *Passive/Active 매핑 미적용* — 매핑은 별도 후속 PR (ADR-0142)
- 사용자 명시 *통념 추정 위험* 차단

#### 영속 layer

`server/persistence/fssDetailRepo.ts` 신설 — 일자별 11 카테고리 raw 영속:

```typescript
export interface FssDetailRecord {
  date: string;
  rows: KrxInvestorDetailRow[];      // 11 카테고리 raw
  fetchedAt: string;
  source: 'KRX_BLD' | 'NONE';
}
```

영속 정책:
- 30영업일 보관 (FIFO trim)
- atomic write (tmp → rename)
- 손상 JSON 빈 배열 fallback

#### `marketDataRefresh` wiring

`refreshMarketRegimeVars()` 사이클의 `⑥-c` 섹션 추가 (KRX 공매도 다음, FRED 이전):
- KRX 호출 → 정상 시 `fssDetailRecord` 영속 + 진단 로그
- 실패 시 `fssDetailSource='NONE'` + 기존 값 보존
- `.catch(() => null)` graceful

#### 진단 명령

`/fss_detail [YYYY-MM-DD]` (alias `/fssd`) — SYS riskLevel=0 ADMIN
- 인자 없으면 최신 일자 raw 11 카테고리 표시
- 일자 인자 시 해당 날짜 영속 표시
- 영속 부재 시 운영자 안내

### Stage 2 (별도 후속 PR + ADR-0142)

**Passive/Active 매핑 정책** — 운영 데이터 1~2주 누적 후 결정

사용자 명시 *통념 추정 위험* 차단을 위해 *데이터 기반 검증* 후 채택:

후보 매핑 (운영 데이터 검증 대기):
- Passive proxy = 투신 + 연기금 + 보험 합 (장기 자산운용 패시브 가정)
- Active proxy = 금융투자 + 사모 + 은행 + 기타금융 합 (단기 알파 추구 가정)
- 외국인 = 외국인 + 기타외국인 합

검증 항목:
1. 위 매핑 vs 실제 시장 행동 (Active 합 양수 → 단기 알파 행동 일치 여부)
2. Passive 합 추세 vs 시장 인덱스 추세 (장기 동행성)
3. Cross-validation: ETF flow proxy (KODEX 200/TIGER 200) 와 일치도

ADR-0142 채택 시:
- `fssRepo.appendFssRecord` 매 사이클 자동 호출 (Passive/Active 합산)
- 기존 PR-1 (ADR-0136) `getFssRecordsAge` 정상 OK 전환

### Stage 3 (선택 — 운영 데이터 누적 후 별도 PR)

ETF flow proxy cross-validation (ADR-0071 패턴):
- KODEX 200 (069500), TIGER 200 (102110) 외인 보유율 추세
- PR-5 (ADR-0140) `foreignerRatioRepo` 차용
- KRX raw vs ETF proxy divergence 진단

## 결과 (Stage 1 적용 시 운영 효과)

1. KRX 11분류 raw 데이터 일자별 영속 — 매핑 정책 검증 *데이터 기반 가능*
2. `/fss_detail` 운영자 진단 — 11 카테고리 흐름 확인
3. ADR-0142 매핑 채택 시 PR-1 의 silent degradation 차단 *완전 작동*
4. cross-validation (Stage 3) 인프라 시드

## 절대 규칙 정합

- **#2 kisClient 단일 통로**: KIS 미사용 — 영향 없음
- **#3 stockService 단일 통로**: macroState 영속 — 자동매매 무영향
- **#4 autoTradeEngine 단일 통로**: 매매 결정 변경 0줄 — fetch + 영속 + 진단만
- **LIVE 매매 본체 0줄 변경**

## 사용자 결정 필요 항목

1. **Stage 분리 동의**: Stage 1 (raw 만) 단독 진행 → 후속 ADR-0142 매핑 분리?
   - 동의 시 PR-B 진행 (Stage 1 구현)
2. **출처 단독 vs 하이브리드**: A 단독 우선 / A+B 동시?
   - 권장 A 단독 (운영 데이터 누적 후 B 추가)
3. **BLD ID 검증 정책**: 운영 환경 첫 호출 후 ENV `KRX_BLD_INVESTOR_DETAIL` override?
   - 권장 default `MDCSTAT02301` + ENV 우회

## 잔여 후속 PR (scope 외)

1. **PR-B Stage 1 실제 구현** — 본 ADR 채택 후
2. **ADR-0142 + 후속 PR**: Passive/Active 매핑 정책 (운영 데이터 1~2주 누적 후)
3. **ADR-0071 패턴 dual-source**: ETF flow proxy cross-validation (Stage 3)
