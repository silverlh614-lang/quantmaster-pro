// @responsibility index 텔레그램 모듈
// @responsibility: commands/system/* 13개 .cmd.ts 파일을 로드해 commandRegistry 자동 등록 트리거.
//
// ADR-0017 §Stage 2 Phase A — 본 파일을 import 하기만 해도 read-only 명령들이
// commandRegistry 에 등록된다. 새 read-only 명령 추가 시 파일을 떨구고 본 barrel 에
// 한 줄을 추가하면 webhookHandler 가 자동으로 인식한다.

import './aiStatus.cmd.js';
import './coherenceAudit.cmd.js';
import './conditionAttributionShadow.cmd.js';
import './conditionLifecycle.cmd.js';
import './dataVerificationReview.cmd.js';
import './health.cmd.js';
import './learningHistory.cmd.js';
import './learningLoopHealth.cmd.js';
import './learningStatus.cmd.js';
import './market.cmd.js';
import './refreshSectorMap.cmd.js';
import './refreshWatchlistSectors.cmd.js';
import './regime.cmd.js';
import './rejected.cmd.js';
import './scanBlockers.cmd.js';
import './scanIndices.cmd.js';
import './scheduler.cmd.js';
import './shadowWalkForward.cmd.js';
import './signalStatus.cmd.js';
import './status.cmd.js';
import './todaylog.cmd.js';
import './twins.cmd.js';
import './walkForward.cmd.js';

export {}; // 본 파일은 side-effect import 전용. 명시적 export 없음.
