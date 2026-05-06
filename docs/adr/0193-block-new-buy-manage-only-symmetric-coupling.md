# ADR-0193 — manage-only OFF 시 blockNewBuy 자동 해제 (대칭 coupling)

@responsibility EmergencyActionsPanel `manage-only` 토글 OFF 시 `blockNewBuy` 동시 해제 — 신규 매수 차단 영구 고착 결함 차단.

## 컨텍스트

사용자 5/6 보고 — *"신규매수차단 해제기능이 구현안된건가? 해제가 안됨"* (스크린샷 첨부).

코드 audit 결과 `engineRouter.ts:175-187` 의 `/auto-trade/engine/manage-only` 엔드포인트에서 비대칭 coupling 결함 발견:

```typescript
router.post('/auto-trade/engine/manage-only', (req: any, res: any) => {
  const next = req.body?.enabled === undefined
    ? !getManualManageOnly()
    : Boolean(req.body.enabled);
  setManualManageOnly(next);
  // 보유만 관리 ON 이면 신규 매수는 자연스럽게 차단되어야 한다 — 함께 설정.
  if (next) setManualBlockNewBuy(true);  // ← ON 만 coupling
  // ❌ OFF 시 setManualBlockNewBuy(false) 누락 — 신규 매수 차단 영구 고착
  ...
});
```

**사용자 시나리오**:
1. "보유만 관리" 버튼 클릭 → `manageOnly=true` + `blockNewBuy=true` (자동)
2. "보유만 관리 해제" 버튼 클릭 → `manageOnly=false` BUT `blockNewBuy` 그대로 `true`
3. 사용자 입장: "보유만 관리"를 끄면 신규 매수가 재개될 것으로 기대 → 별도 "신규 매수 차단 해제" 버튼이 있다는 사실 모르거나 인지 못 함
4. 결과: 매수 차단 영구 고착 → "해제가 안 됨" 보고

## 결정

### 결정 1 — `manage-only` OFF 시 `blockNewBuy` 자동 해제 (대칭 coupling)

```typescript
router.post('/auto-trade/engine/manage-only', (req: any, res: any) => {
  const next = req.body?.enabled === undefined
    ? !getManualManageOnly()
    : Boolean(req.body.enabled);
  setManualManageOnly(next);
  // ADR-0193: 대칭 coupling — ON 시 차단·OFF 시 해제 양방향.
  setManualBlockNewBuy(next);
  ...
});
```

### 결정 2 — ENV `MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED=true` 우회

기존 비대칭 동작 즉시 복원 (default OFF, ADR-0157 정확 비교). 사용자가
*보유만 관리 해제 후 신규 매수 차단 별도 유지* 를 의도하는 경우 ENV 활성화.

### 결정 3 — 사용자 의도 우선 정책

본 결정은 *사용자의 일반적 의도* 가 *보유만 관리 종료 = 신규 매수 재개* 임을
전제. *보유만 관리 종료 + 신규 매수 차단 별도 유지* 라는 의도가 있다면
사용자가 "보유만 관리 해제" 버튼 클릭 후 "신규 매수 차단" 버튼을 명시적으로
다시 클릭하면 됨. 이 패턴이 더 직관적 (UI 토글의 일관된 의미 보존).

## 안전 invariant 5종

1. **LIVE 매매 본체 0줄 변경** — 엔드포인트 1줄 변경만, 매매 결정/주문/킬스위치 무관.
2. **KIS/KRX 자동매매 quota 0 침범** — 절대 규칙 #2/#3/#4.
3. **ENV default 정책 적용** — 새 동작이 default, ENV 우회 시 기존 동작 복원.
4. **manage-only ON 동작 보존** — `manageOnly=true` 시 `blockNewBuy=true` 동시 설정 유지 (기존 의도 보존).
5. **emergencyStop / autoTradePaused / dataIntegrityBlocked 별도 가드 무영향** — manage-only 와 blockNewBuy 만 coupling.

## 잘못된 해결 방법 영구 차단 4종

1. **origin 추적 (auto vs manual) 도입** — over-engineering. UI 토글의 자연스러운 대칭 의미가 더 직관적.
2. **manage-only OFF 시 모든 가드 (emergencyStop / pause / integrity) 일괄 해제** — 위험. 각 가드는 독립 의미 (비상정지 / 일시정지 / 무결성 차단).
3. **UI 측 자동 해제 mutation 호출 추가** — 서버 SSOT 우선 정책 위반 (책임 분산).
4. **버튼 라벨 "보유만 관리" → "신규 매수 차단 + 보유만 관리"** — UI 라벨 변경은 별도 PR (사용자 명시 요청 아님).

## 회귀 테스트 ≥10 케이스

- `engineRouterManageOnlyAdr0193.test.ts` — 정적 grep 가드 (`setManualBlockNewBuy(next)` 패턴 + ENV 우회 + ADR 추적 주석) + 동작 매트릭스 (manage-only ON → blockNewBuy=true / manage-only OFF → blockNewBuy=false / ENV 우회 시 OFF 시 blockNewBuy 보존 / req.body.enabled 명시 vs 미명시 토글 / blockNewBuy 별도 ON 후 manage-only ON+OFF → 해제 정합).

## 운영자 활성화 절차

본 PR 머지 직후 자동 활성화. 회귀 발견 시 ENV `MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED=true` 1줄 즉시 롤백.

## 결과

1. 사용자 "보유만 관리" → "보유만 관리 해제" 순서 토글 시 신규 매수 자동 재개.
2. 비대칭 coupling 결함 영구 차단.
3. EmergencyActionsPanel UI 직관성 격상 (토글 의미 일관).
