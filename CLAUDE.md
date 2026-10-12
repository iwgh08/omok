# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

렌주룰을 적용한 실시간 온라인 오목이다. 대국자 2명과 관전자가 참여할 수 있다. 서버는 Node.js + Express + Socket.IO이고, 클라이언트는 빌드 과정 없는 순수 HTML/CSS/JS다. 화면 문구와 코드 주석은 한국어로 작성한다. Render 무료 플랜에 배포한다(Build `npm install`, Start `npm start`, 서버는 `process.env.PORT`를 사용).

Windows PowerShell에서는 실행 정책 때문에 `npm`이 막힐 수 있다. 그럴 때는 `npm.cmd`를 쓴다.

## 명령어

- `npm install`: 의존성 설치
- `npm start`: http://localhost:3000 에서 서버 실행 (`PORT`로 포트 변경 가능)
- `npm test`: 렌주 판정 단위 테스트(`test/renju.test.js`)와 서버 통합 테스트(`test/server.test.js`) 실행. 서버 테스트는 `server.js`를 무작위 포트(3900번대)로 직접 띄우고 `socket.io-client`(devDependency)로 접속해 대국 흐름을 확인한다.
- 테스트 하나만 실행: `node --test --test-name-pattern="4-4" test/renju.test.js`
- `/ship`: 바뀐 코드 검토 → 테스트 → `git add/commit/push`를 한 번에 진행하는 프로젝트 명령어 (`.claude/skills/ship/SKILL.md`)

린터와 번들러는 없다. 로컬에서 대국을 시험하려면 일반 창과 시크릿 창을 하나씩 연다. 플레이어는 localStorage에 저장된 `clientId`로 구분하므로, 같은 브라우저 프로필의 두 탭은 같은 플레이어로 취급된다.

## 구조

**렌주 규칙은 `shared/renju.js` 한 곳에만 있다.** UMD 모듈이라서 서버는 `require`로 불러오고, 브라우저는 `/shared/renju.js`에서 전역 `Renju`로 불러온다. 규칙 판정의 최종 권한은 서버에 있다. 클라이언트는 같은 모듈을 금수 자리 ✕ 표시와 미리 안내하는 용도로만 쓴다. 규칙을 바꿀 때는 서버와 브라우저 양쪽이 모두 동작하는지 확인해야 한다.

- 보드는 길이 `SIZE*SIZE`(15×15)의 1차원 배열이고, 인덱스는 `y*SIZE+x`다. 값은 `0` 빈칸, `1` 흑, `2` 백이다.
- `forbiddenType(board, x, y)`는 흑돌을 임시로 놓고 금수인지 검사한 뒤 보드를 원래대로 되돌린다. 반환값은 `'33' | '44' | 'overline' | null`이다.
- 정확한 5목은 모든 금수보다 우선한다.
- "삼"은 한 수 더 두었을 때 열린 사(4)가 되고, **그 한 수가 금수가 아닐 때만** 삼으로 친다. 이 검사는 `forbiddenType`을 재귀로 다시 호출하며, 깊이는 `MAX_DEPTH`로 제한한다. 거짓 3-3은 이 재귀로 걸러낸다.
- 사(4)는 `fivePoints`로 방향마다 센다. 5목 완성점 두 개가 5칸 떨어져 있으면 열린 사 하나로 보고, 그 외에 완성점이 두 개면 사 두 개로 본다. 그래서 한 줄에 생기는 `X_XXX_X` 형태의 4-4도 잡아낸다.
- 흑은 정확히 5목일 때만 이기고, 백은 5목 이상이면 이긴다.

**`server.js`는 모든 게임 상태를 메모리에 둔다.** 방은 6자리 코드를 키로 하는 `rooms` Map에 저장된다. 아무것도 저장하지 않으므로, 서버가 재시작되거나 Render에서 잠들면 모든 방이 사라진다.

- 자리와 색은 따로 관리한다. `room.seats[0..1]`에 대국자가 앉고, `room.blackSeat`가 흑을 두는 자리를 가리킨다. 첫 대국에서는 무작위로 정하고, 재대국이나 새 대국마다 바꾼다.
- `room.members`는 socketId → `{clientId, name}` 맵이다. `members`에 있지만 자리에 앉지 않은 사람이 관전자다.
- 상태가 바뀔 때마다 `broadcast(room)`가 `stateFor`로 소켓별 `state`를 만들어 보낸다. 소켓마다 `you` 필드가 다르기 때문에 방 전체에 한 번에 보내지 않고 소켓 하나씩 보낸다.
- 클라이언트는 받은 전체 상태로 화면을 다시 그린다. 변경분만 보내는 방식은 쓰지 않는다.
- 방 상태는 `waiting → playing → ended` 순서로 바뀐다. 대국이 끝난 뒤 자리가 비면 다시 `waiting`이 된다. 그러면 `fillSeats`가 가장 먼저 들어온 관전자를 대국자로 올리고, 두 자리가 차면 자동으로 대국을 시작한다.
- **나가기와 연결 끊김은 다르게 처리한다.**
  - `leaveRoom`(직접 나가기): 대국 중이면 패배하고, 자리는 바로 비워진다.
  - 소켓 `disconnect`(연결 끊김): `RECONNECT_GRACE_MS`(30초) 동안 자리를 `connected: false`로 남겨 둔다. 같은 `clientId`로 다시 들어오면 자리를 되찾는다. 대국 중에 유예 시간이 지나면 기권패 처리된다.
  - 같은 `clientId`로 두 번째 탭에서 같은 방에 들어오면 먼저 연결된 소켓은 내보낸다.
- 제한 시간은 체스 시계 방식이다. 각자 `room.totalTime`초(5/10/20분)를 받고, `room.clocks[색]`에 남은 ms를 저장한다. `startClock`은 차례 시작 시각(`turnStartedAt`)을 기록하고 시간 초과 타이머를 건다. `stopClock`은 쓴 시간을 빼고 시계를 멈춘다. 착수·무르기·종료 직전에는 반드시 `stopClock`을 먼저 호출해야 시간이 올바르게 계산된다.
- 클라이언트는 `state.clocks`를 받은 시각을 기준으로, 현재 차례인 쪽 시계만 화면에서 줄여 보여준다.
- 무르기는 상대가 수락해야 한다. 상대 차례면 1수, 요청한 사람 차례면 2수를 되돌린다. 흑의 첫 수(천원)는 무를 수 없다.

**소켓 이벤트** (서버 핸들러는 받은 데이터를 `data || {}`로 꺼낸다. 인자 기본값 `({ x } = {})`은 `null`을 막지 못해서, `null` 하나로 서버 전체가 꺼질 수 있다.)
- 클라이언트 → 서버: `createRoom`, `joinRoom`(둘 다 응답 콜백 사용), `leaveRoom`, `place`, `undoRequest`, `undoReply`, `resign`, `rematch`, `chat`
- 서버 → 클라이언트: `state`, `chat`, `chatHistory`, `errorMsg`, `kicked`, `stonePlaced`

**`public/client.js`**는 canvas에 바둑판을 그린다. devicePixelRatio에 맞춰 해상도를 조정하고, ResizeObserver로 크기 변화를 따라간다. 터치 기기에서는 같은 자리를 두 번 탭해야 돌이 놓이고, 마우스는 한 번 클릭하면 놓인다. 소켓이 다시 연결되면 `currentRoom`에 자동으로 다시 입장한다.

**차례·요청 표시 (`public/client.js`)**
- 화면은 `render()`가 현재 상태만 보고 다시 그린다. 상태가 "바뀌는 순간"에 한 번만 보여 줄 것들은 `notifyChanges(prev, s)`가 이전 상태와 비교해서 처리한다. 대국 시작, 내 차례, 승패 배지(`showBadge`), 내 무르기 요청 결과 토스트가 여기에 해당한다. 관전자에게는 표시하지 않는다.
- 내 차례에는 `#statusBar`와 `#boardStage`에 `my-turn` 클래스를 붙여 주황색 표시줄과 바둑판 테두리 빛을 켠다.
- 상대의 무르기·재대국 요청은 바둑판 위의 `#requestCard` 하나로 보여 준다. `requestMode`(`'undo' | 'rematch'`)에 따라 `#requestYes`/`#requestNo` 버튼의 동작이 바뀐다. 재대국 카드는 '나중에'를 누르면 `rematchDismissed`로 숨긴다.
- 사용자 결정: 돌 놓는 소리는 처음의 삼각파 '뚁' 소리(`playClick`)를 유지한다. 잡음으로 만든 '탁' 소리는 시도했다가 되돌렸다. '띵동' 알림음과 탭 제목 깜빡임도 넣었다가 사용자가 원하지 않아 뺐으니 다시 넣지 않는다.
