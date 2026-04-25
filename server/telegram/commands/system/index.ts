// @responsibility: commands/system/* 9개 .cmd.ts 파일을 로드해 commandRegistry 자동 등록 트리거.
//
// ADR-0017 §Stage 2 Phase A — 본 파일을 import 하기만 해도 9개 read-only 명령이
// commandRegistry 에 등록된다. 새 read-only 명령 추가 시 파일을 떨구고 본 barrel 에
// 한 줄을 추가하면 webhookHandler 가 자동으로 인식한다.

import './aiStatus.cmd.js';
import './health.cmd.js';
import './learningHistory.cmd.js';
import './learningStatus.cmd.js';
import './market.cmd.js';
import './regime.cmd.js';
import './scheduler.cmd.js';
import './status.cmd.js';
import './todaylog.cmd.js';

export {}; // 본 파일은 side-effect import 전용. 명시적 export 없음.
