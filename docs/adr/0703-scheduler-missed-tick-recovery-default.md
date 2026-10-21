# ADR-0703: 정시 작업의 지연된 틱을 기본으로 한 번 복구 (주문 경로 제외)

Status: Accepted · 2026-10-21

node-cron 3.0.3은 작업마다 1초 간격으로 시각을 확인하고, 확인이 정해진 초를 넘겨 늦어지면 그 틱을 기록 없이 건너뛴다(`recoverMissedExecutions`가 꺼진 경우). 지금 서버는 매분 0초에 Shadow 관측 작업이 무겁게 돌아 이런 지연이 잦다. `/cron_status` 확인 결과, 10.20~21에 KRX 종목 목록 갱신(06:00), 일일 백업(01:00·03:00), KIS 토큰 갱신(20:30), 주도주 갱신(08:10·장중)을 포함한 정시 작업 대부분이 실행 기록 없이 빠졌다. 같은 분에 잡힌 작업 중에서도 확인 타이밍에 따라 일부만 돌았다. 기존에는 합쳐지는 관측 작업만 복구하도록 opt-in이었다. 사용자 결정(2026-10-21 "둘다진행")에 따라 다음을 정한다.

- `scheduledJob`은 옵션이 없으면 지연된 틱을 한 번 복구한다. 중복 방지는 기존 복구 경로(같은 초 재방출 차단)를 그대로 쓴다.
- 주문 경로 작업은 기존 동작(건너뜀)을 유지한다: `orchestrator_tick`·`oco_confirm`·`oco_survival`·`oco_recovery_round`·`portfolio_risk_check`·`cancel_all_active_oco`·`sell_poll_start`·`sell_poll_stop`·`kis_stream_start`·`kis_stream_stop`·`kis_stream_watchdog`. 실매매를 다시 켤 때 따로 정한다.
- 작업별 명시 옵션이 기본값보다 우선한다. 30초 뒤 다음 확인이 오는 `paper_holding_prices`는 `false`로 건너뜀을 유지한다.
- `SCHEDULER_MISSED_TICK_RECOVERY_DISABLED=true`이면 이전 기본값(명시 opt-in만 복구)으로 돌아간다.

검증: 지연된 경계에서 일반 작업 1회 복구, 주문 경로와 명시 false는 건너뜀, 다음 경계 1회 실행, 차단 스위치로 이전 기본값 복원.

복구: 환경변수 한 줄(`SCHEDULER_MISSED_TICK_RECOVERY_DISABLED=true`) 후 재시작.
