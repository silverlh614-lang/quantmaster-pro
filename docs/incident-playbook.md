# Incident Playbook — Shadow 모니터링 기간 대응 지침

> 2026-04-20 Shadow 학습 모니터링 진입 후 치명 버그 발생 시 의사결정 트리.
> 시스템이 이미 자동으로 취한 조치(Automated Kill Switch, Sample Quarantine,
> Blast Radius 계산)의 **위에서** 운용자가 내리는 판단만 다룬다.

---

## 자동으로 일어나는 일 (시스템 책임)

사건 감지 시점에 다음이 이미 자동 실행되어 있다. **다시 할 필요 없음.**

1. `incident-log.json` 에 타임스탬프·원인 기록.
2. `setEmergencyStop(true)` — 신규 tick 차단.
3. `cancelAllPendingOrders()` — KIS 미체결 주문 전량 취소 시도.
4. 이후 생성되는 Shadow 샘플은 `incidentFlag` 자동 부착 → 캘리브레이션 자동 격리.
5. Telegram CRITICAL 경보 + Blast Radius 리포트 발송.

---

## 운용자 의사결정 트리

```
Q: 치명 버그 발생 (Telegram CRITICAL 수신)
│
├── 1. 주문이 이미 나갔는가? (Blast Radius 리포트의 "영향받은 Active" 확인)
│   ├── YES → 2-A 로 이동
│   └── NO  → 2-B 로 이동
│
├── 2-A. 이미 LIVE 주문 실행됨
│   ├── cancelAllPendingOrders() 자동 실행 결과 확인 (KIS 포털)
│   ├── 남은 오픈 포지션 수동 손절 판단
│   └── AUTO_TRADE_ENABLED=false 로 env 변경 후 재배포
│
├── 2-B. LIVE 주문 전에 차단됨 (일반적인 경로)
│   └── AUTO_TRADE_ENABLED=false 유지 + 원인 분석만 진행
│
├── 3. 오염 샘플 수는? (Blast Radius "생성된 Shadow" 필드)
│   ├── ≥ 5건 → 격리 + 재개 (incidentFlag 자동 부착으로 통계 제외됨)
│   └── <  5건 → 격리 + 당일 중 재시작 시도 (수정 PR → 검증 → 재배포)
│
├── 4. 캘리브레이션 임박 여부 (D-2 이내?)
│   ├── YES → 이번 달 캘리브레이션 스킵 플래그 고려
│   │   (Blast Radius 의 "이번 달 오염 비중" > 10% 이면 스킵 권고)
│   └── NO  → 통상 월말 캘리브레이션 재개 (격리 샘플 자동 제외됨)
│
└── 5. 재개 조건
    1. 원인 수정 PR 머지 완료
    2. 다음 거래일 08:45 KST Pre-Market Smoke Test 통과 확인
    3. `setEmergencyStop(false)` + Railway redeploy
    4. 첫 수신된 Mutation Canary 알림이 ✅ 통과인지 확인
```

---

## 복구 체크리스트 (재개 직전)

- [ ] Telegram 에 수신된 **마지막** Mutation Canary 결과가 PASS.
- [ ] `incident-log.json` 의 마지막 엔트리 `at` 이 현재 시점보다 2시간 이상 과거.
- [ ] `snapshots/YYYY-MM-DD/` 에서 어제 자정 상태 복원 가능 여부 확인.
- [ ] `orchestrator-state.json` 의 `tradingDate` 가 오늘 날짜로 업데이트됨.
- [ ] Pre-Market Smoke Test Gate: 다음 08:45 KST 실행 결과가 통과.

## 흔한 오판 (안티패턴)

- ❌ 손상된 샘플을 수동으로 `shadow-trades.json` 에서 삭제 → `incidentFlag` 로 자동 격리되므로 불필요. 수동 편집은 오히려 reconciliation 불일치를 유발.
- ❌ 캘리브레이션을 "이번 주말만" 스킵하고 다음 주 진행 → 오염이 주 단위로 이어지면 누적 왜곡. 월 단위 스킵으로 판단.
- ❌ `AUTO_TRADE_ENABLED=true` 로 바로 복귀 → 스모크 테스트 실패 상태에서 LIVE 경로 차단이 유지되는지 먼저 확인할 것.

---

## 관련 모듈

| 역할 | 파일 |
|---|---|
| Pre-Order Kill Switch | `server/trading/preOrderGuard.ts` |
| Incident Log | `server/persistence/incidentLogRepo.ts` |
| Sample Quarantine | `server/trading/buyPipeline.ts` + `server/persistence/shadowTradeRepo.ts` |
| Blast Radius | `server/alerts/contaminationBlastRadius.ts` |
| Mutation Canary | `server/learning/mutationCanary.ts` |
| Smoke Test Gate | `server/trading/preMarketSmokeTest.ts` |
| Backup Ceremony | `server/persistence/dailyBackupCeremony.ts` |
