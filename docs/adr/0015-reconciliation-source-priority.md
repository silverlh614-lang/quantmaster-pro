# ADR-0015 — 재동기화(/reconcile) 데이터 출처 우선순위

- 상태: Accepted
- 날짜: 2026-04-25
- 영향 범위: `server/trading/liveReconciler.ts` (신설), `server/telegram/webhookHandler.ts`,
  `server/persistence/shadowAccountRepo.ts` (기존 SHADOW reconcile 와 분리)

## 컨텍스트

### 현재 /reconcile 의 한계

PR-3 #9 (2026-04-24) 로 `/reconcile` 텔레그램 명령이 도입되었으나 현재 범위는
**SHADOW 계좌 수량 재계산** 만이다 (`reconcileShadowQuantities` 호출).

| 서브명령 | 동작 |
|---------|------|
| `/reconcile` | SHADOW 수량 dry-run 점검 |
| `/reconcile apply` | SHADOW 수량 교정 적용 |
| `/reconcile last` | 마지막 결과 조회 |
| `/reconcile status` | 마지막 실행 시각/모드 |
| `/reconcile push` | 서버 장부 → 다기기 브로드캐스트 |

**LIVE 모드 시 KIS 실잔고와 로컬 포지션 캐시 간 괴리** 가 발생해도 강제 동기화 경로가 없다.
괴리는 다음 상황에서 발생할 수 있다:
- ADR-0014 의 WRITE 5xx fast-fail 후 KIS 가 실제로는 주문을 받았던 경우
- KIS 회로 차단(PR-21) 동안 fillMonitor 가 누락한 체결
- Railway SIGTERM/재배포 직후 in-memory state 휘발

### 데이터 종류별 진실 원천(SSOT) 후보

| 데이터 | 후보 1 | 후보 2 | 후보 3 |
|--------|--------|--------|--------|
| 포지션 수량 (LIVE) | KIS `inquire-balance` output1[] | 로컬 ServerShadowTrade fills[] | - |
| 포지션 평단가 (LIVE) | KIS `inquire-balance` pchs_avg_pric | 로컬 fills[] 가중평균 | - |
| 오늘 체결 내역 | KIS `inquire-daily-ccld` | 로컬 fills[] | - |
| 현금 잔고 | KIS `inquire-balance` dnca_tot_amt | - | - |
| 종목명 (code↔name) | krx-master.json | KRX live API | seed |
| 시장 시세 | KIS `inquire-price` | Naver | Yahoo |
| 재무 펀더멘털 | DART (계획) | Naver Mobile | - |

## 결정

### 우선순위 룰 (LIVE 모드)

다음 데이터에 대해 **충돌 발생 시 KIS 가 무조건 SSOT** 이다 (CLAUDE.md 절대 규칙 #2 정합):

| 데이터 | SSOT | 비고 |
|--------|------|------|
| 포지션 수량 | KIS inquire-balance output1[].hldg_qty | 로컬 캐시는 KIS 값으로 덮어씀 |
| 포지션 평단가 | KIS inquire-balance output1[].pchs_avg_pric | KIS 가 사사오입 수행 |
| 현금 잔고 | KIS inquire-balance output2[0].dnca_tot_amt | 기존 fetchAccountBalance 동일 |
| 오늘 체결 (감사) | KIS inquire-daily-ccld | 본 PR 범위 외, 후속 |

### 우선순위 룰 (SHADOW 모드)

SHADOW 는 KIS 실잔고와 무관 — 기존 로컬 fills[] SSOT 유지.
`/reconcile` (서브명령 없음) 은 기존 SHADOW 흐름 그대로 보존.

### 우선순위 룰 (기타 데이터)

| 데이터 | SSOT | 후속 fallback |
|--------|------|--------------|
| 종목명 마스터 | KRX `MDCSTAT01901` (24h TTL) | shadowMasterDb → seed (PR-33) |
| 시장 시세 | KIS inquire-price | Naver Mobile (장외/주말) |
| 재무 펀더멘털 | DART (미연결) | Naver Mobile |

본 ADR 은 LIVE 포지션/체결 동기화에 한정한다. 기타 데이터는 PR-33 (멀티소스 마스터)
와 ADR-0011 (AI 추천 출처 분리) 에서 이미 룰이 정의됨.

### /reconcile live 서브명령 신설

```
/reconcile live           → LIVE 포지션 dry-run (KIS vs 로컬 비교, 변경 없음)
/reconcile live apply     → KIS 값으로 로컬 포지션 캐시 강제 덮어쓰기
```

기존 서브명령 (`apply`, `last`, `status`, `push`) 은 변경 없음.

### 충돌 처리 정책

dry-run 결과는 다음 카테고리로 분류:

| 카테고리 | 의미 | apply 동작 |
|---------|------|-----------|
| **MATCH** | KIS 와 로컬 일치 | no-op |
| **QTY_DIVERGENCE** | KIS 수량 ≠ 로컬 수량 | 로컬 → KIS 값 |
| **GHOST_LOCAL** | 로컬에 있으나 KIS 에 없음 (전량 청산 누락) | 로컬 trade → CLOSED 마킹 |
| **GHOST_KIS** | KIS 에 있으나 로컬에 없음 (체결 누락) | **자동 적용 안 함** — Telegram 경고만 |

**GHOST_KIS 자동 적용 차단 근거**: 로컬 ServerShadowTrade 는 진입 메타(stopLoss,
targetPrice, profileType, signalTime) 를 보유한다. KIS 잔고 정보만으로는 이 메타를
복원할 수 없어 자동 생성 시 후속 exitEngine 의 손절/익절 판정이 망가진다. 운영자가
수동으로 진입 메타를 입력하도록 텔레그램 알림으로 유도.

### 안전장치

1. **마지막 결과 영속화**: 기존 RECONCILE_LAST_FILE 형식과 호환되는 `LIVE` 모드
   기록 추가 (`mode: 'liveDryRun' | 'liveApply'`)
2. **rate limiting**: `/reconcile live apply` 는 최근 60초 내 호출 시 거부 (오타 방지)
3. **KIS 실패 시 fail-closed**: KIS 잔고 조회 실패 → reconciler 는 변경 없이 종료,
   에러 메시지 반환 (로컬 데이터 보호)

## 결과

### 긍정

- **명시적 SSOT**: 향후 분쟁 시 항상 "KIS 가 정답" 룰로 자동 해소
- **CLAUDE.md 절대 규칙 #2 정합**: KIS 단일 통로 원칙을 SSOT 룰로 일관성 확장
- **GHOST_LOCAL 자동 청소**: ADR-0014 의 WRITE 실패 후 사용자가 KIS HTS 로 수동 매도한
  케이스에서 로컬 trade 가 무한 ACTIVE 로 남던 문제 해소
- **GHOST_KIS 안전 분기**: 메타 손실 위험을 자동 적용 차단으로 회피, 사람 판단 위임

### 부정

- 로컬 stopLoss/targetPrice/profileType 은 reconcile 과정에서 영향 없음 (fills[] 만 동기화).
  사용자가 KIS HTS 로 부분 매도한 후 reconcile apply 시 잔량이 줄어들지만 stopLoss 는
  진입 시점 그대로 → exitEngine 이 잔량에 새 손절 적용. 이 동작이 의도이므로 trade-off 수용.
- KIS inquire-balance 가 5xx 인 시간대 (KST 02:00~06:59 정기점검) 에는 reconcile 불가.
  기존 `isKisBalanceQueryAllowed()` 가 자동 차단 — 사용자에게 시간대 안내 필요.

## 후속

- `server/trading/liveReconciler.ts` 신설 — 비교/적용 로직 분리
- `fetchKisHoldings()` 신설 — `inquire-balance` output1[] 파싱
- `webhookHandler` `/reconcile` 핸들러에 `live` 서브명령 분기
- 회귀 테스트 `liveReconciler.test.ts`
- Phase 2 (후속 PR): 오늘 체결 감사 — KIS inquire-daily-ccld 와 로컬 fills[] 대조 리포트
