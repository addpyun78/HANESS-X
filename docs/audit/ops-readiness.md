# HARNESS-X 운영 준비 점검표 (2026-11-12)

범위: `harness-x serve`(로컬 서버) + 웹 화면 + Tauri 데스크톱. 결제·개인정보 기능은 범위 밖입니다.
방법: 파일 읽기와 grep만 했습니다. 빌드·테스트·서버 실행은 하지 않았습니다. 그래서 "있음"은 "코드에 있음"이라는 뜻이고, 실제로 동작하는지는 확인하지 않았습니다.
이미 찾은 문제(docs/audit/findings.json)는 번호만 적고 다시 세지 않았습니다(C1-005 지문 문제, C3-003 보관 기본값 0).

## 점수

| 구분                                   | 개수             |
| -------------------------------------- | ---------------- |
| 있음                                   | 2 / 19           |
| 부분                                   | 14 / 19          |
| 없음                                   | 3 / 19           |
| **운영 준비도** (있음 1점, 부분 0.5점) | **9 / 19 = 47%** |
| "꼭 넣을 것"(S·M) 반영                 | 0 / 15 = 0%      |

한 줄 요약: 보안 기본값(루프백만 열기, 무작위 토큰)과 크래시 뒤 이어하기는 잘 되어 있습니다. 반면 **서버가 죽었을 때 다시 켜 주는 장치가 없고**, **같은 서버를 두 번 켜는 것을 막지 못하며**, **서버 로그가 켤 때마다 지워집니다**. 회사에서 운영하려면 이 세 가지부터 채워야 합니다.

---

## 1. 점검표

표기: 상태(있음/부분/없음) · 근거(파일:줄) · 빠진 것 → 구현 방법 · 작업량(S = 반나절 이하, M = 1~3일, L = 1주 이상) · 위험

### 1) 상태 확인(health·readiness) — 부분

- 근거: `packages/kernel/src/api/server.ts:173` `GET /api/health` 는 `{ok:true, port}` 만 돌려줍니다. 토큰 검사(`server.ts:168`)보다 뒤에 있어서 토큰 없이는 401이 납니다.
- 빠진 것:
  - "준비됨(readiness)" 검사가 없습니다. 플러그인 로드 결과, 이벤트 기록 DB(index.sqlite), 디스크 여유 공간, 키체인 사용 가능 여부를 보지 않습니다.
  - 실행기 `scripts/launcher/start.sh:15` 의 `api_up` 은 `curl -s` 만 쓰고 `-f` 는 쓰지 않습니다. 그래서 **401이나 403 응답도 "서버가 켜져 있음"으로 판단합니다**. 3790 포트를 다른 프로그램이 쓰고 있거나, 토큰이 다른 옛 서버가 남아 있어도 "실행 중"이라고 말합니다.
- 구현: ① `api_up` 에 `-f` 를 넣습니다. ② `GET /api/health/live` 를 토큰 없이 열고 `{ok, version, pid, startedAt}` 만 돌려주게 합니다(루프백·Host 검사는 그대로 둡니다). ③ `GET /api/ready`(토큰 필요)를 추가해 `{plugins:{active, rejected}, db:'ok'|'error', diskFreeMb, keychain:'os'|'volatile'|'none'}` 를 돌려주고, 하나라도 나쁘면 503을 돌려줍니다.
- 작업량 S · 위험: 낮음. live 응답에 비밀 정보를 넣지 않는 것만 지키면 됩니다.

### 2) 자동 재시작·감시(프로세스가 죽으면) — 없음

- 근거:
  - `start.sh:54` 는 `setsid -f` 로 한 번만 띄웁니다. 감시하는 장치가 없습니다.
  - 데스크톱 `apps/desktop/src-tauri/src/lib.rs:43` 은 한 번만 띄웁니다. 그 뒤 서버가 죽어도 상태가 `Ready` 로 남고, 화면은 "다시 연결 중"에서 멈춥니다.
  - `packages/kernel/src/cli.ts` 에는 `uncaughtException`·`unhandledRejection` 처리기가 없습니다. 테스트용 처리기만 `scripts/audit/unhandled-setup.ts` 에 있습니다.
- 구현:
  - ① cli.ts의 `main()` 앞에서 두 처리기를 등록합니다. 처리기는 `~/.harness-x/run/crash-<시각>.log` 에 스택을 쓰고(비밀은 `maskDeep` 로 가림) 종료 코드 70으로 끝냅니다.
  - ② start.sh에서 서버를 감시 반복문으로 감쌉니다. 예시는 `while :; do node … serve; code=$?; [ $code = 0 ] && break; 재시작 횟수 기록; 1분 안에 5번 넘으면 멈추고 안내; sleep $((2**n)); done` 입니다.
  - ③ 데스크톱은 감시 스레드를 둡니다. `Sidecar::running()`(sidecar.rs:150)을 5초마다 확인하고, 서버가 죽었으면 `ServerStatus::Restarting` 을 거쳐 다시 띄웁니다(백오프, 최대 5회). 웹 화면은 상태를 다시 읽어 새 주소와 토큰으로 접속합니다.
- 작업량 M · 위험: 계속 죽는 상황에서 무한 재시작에 빠질 수 있습니다. 횟수 상한과 "그만두고 안내"가 반드시 필요합니다.

### 3) 기동 실패 시 쉬운 말 안내 — 부분

- 근거:
  - 서버 기동 실패는 `cli.ts:868` 에서 영어 원문(`listen EADDRINUSE …`)을 그대로 보여 줍니다.
  - `new EventLog`(cli.ts:368)는 try 밖에 있습니다. index.sqlite가 깨졌거나 Node 버전이 낮아(`node:sqlite`) 실패하면 스택 전체가 출력됩니다(cli.ts:919).
  - start.sh는 120초를 기다린 뒤 "기동 시간 초과 (로그: $RUN)"만 말하고 로그 내용은 보여 주지 않습니다(start.sh:17).
  - 데스크톱은 서버 오류 출력을 버립니다(`sidecar.rs:95` `stderr(Stdio::null())`). 실패 문구는 "서버가 준비 전에 종료됨 (exit status: 1)" 뿐입니다.
- 구현:
  - ① `explainStartupError(err)` 함수를 만듭니다. 오류 종류별 안내는 다음과 같습니다.
    - `EADDRINUSE`: "3790 포트를 다른 프로그램이 쓰고 있어요. 이미 켜진 HARNESS-X가 있으면 stop.sh로 끄거나 --port 0으로 켜세요."
    - `EACCES`: 권한 문제 안내
    - `SQLITE_CORRUPT`: index.sqlite를 옆에 백업해 두고 다시 만든다는 안내
    - Node 버전이 22.19 미만: 버전 안내
    - `MODULE_NOT_FOUND`: "pnpm -r build 필요" 안내
  - ② cli.ts의 바깥 catch와 기동 catch에서 이 함수를 쓰고, 원문은 로그 파일에만 남깁니다.
  - ③ start.sh에서 서버가 일찍 죽으면(pid가 사라지면) 120초를 기다리지 말고 곧바로 `tail -n 20 server.log` 를 보여 줍니다.
  - ④ 데스크톱은 stderr를 `run/desktop-server.log` 에 쓰고, 실패 문구에 마지막 5줄을 붙입니다.
- 작업량 S(①②③) + S(④) · 위험: 낮음

### 4) 로그 회전·크기 상한 — 없음

- 근거:
  - `start.sh:54` 의 `>"$0/server.out" 2>"$0/server.log"` 는 켤 때마다 파일을 **덮어씁니다**. 그래서 서버가 죽은 뒤 다시 켜면 **원인 로그가 사라집니다**. 켜 둔 채로는 크기 상한도 없습니다.
  - `server.ts:137` 에서 Fastify logger가 기본으로 꺼져 있어 요청 오류(500)가 어디에도 남지 않습니다.
- 구현:
  - ① start.sh에서 띄우기 전에 회전합니다. 예: `for i in 4 3 2 1; do mv server.log.$i server.log.$((i+1)); done; mv server.log server.log.1`. 그리고 `>>` 로 이어 씁니다.
  - ② 커널 안에 `run/server.log` 를 쓰는 작은 기록기를 둡니다. 10MB를 넘으면 `.1`~`.5` 로 넘깁니다. Fastify에는 `logger: {level:'warn', stream}` 을 넘기고, `setErrorHandler` 에서 500 오류를 `maskDeep` 를 거쳐 기록합니다.
- 작업량 S(①) / M(②) · 위험: 로그에 비밀이 섞이지 않게 기존 `maskDeep`·`redactSecrets` 를 거쳐야 합니다.
- 참고: The Twelve-Factor App "Logs" https://12factor.net/logs

### 5) 이벤트 기록 보관·정리 — 부분 (C3-003 참고)

- 근거:
  - `packages/kernel/src/settings/data-cleanup.ts:41-47` 은 "보관한 작업"만 정리합니다.
  - 기본값이 0(지우지 않음)입니다(`settings/registry.ts:797`, `:804`).
  - `logs/sessions/kernel`·`index.sqlite`·`approvals.jsonl` 은 정리 대상이 아닙니다. 기록 크기 상한도 없습니다.
- 구현:
  - ① `data.maxLogMb`(기본 2048) 설정을 추가합니다. 시작 때 logs 폴더 크기가 상한을 넘으면 설정 화면에 경고를 띄웁니다. 자동으로 지우지는 않습니다(0B.30 원칙 유지).
  - ② `kernel` 세션 기록을 날짜별로 나눕니다(`kernel-YYYY-MM`).
  - ③ 정리한 뒤 `VACUUM` 을 한 달에 한 번 돌립니다.
- 작업량 S(①) / M(②③) · 위험: 감사 기록(18번)까지 지우면 안 됩니다. 감사 기록은 정리 대상에서 빼야 합니다.

### 6) 설정·데이터 백업과 복원 — 부분

- 근거:
  - `packages/kernel/src/settings/transfer.ts:13-24` 는 `settings.yaml` 만 내보내고 가져옵니다(`api/settings-routes.ts:130-141`).
  - engines.json, plugins.lock, workspaces.json, 프로젝트·세션 색인, 이벤트 기록, approvals.jsonl, agents 폴더는 백업 수단이 없습니다.
- 구현:
  - ① `harness-x backup [--out file]` 을 만듭니다. `~/.harness-x` 를 tar.gz로 묶되 `run/` 은 빼고, 키체인 값은 넣지 않습니다. 묶기 전에 SQLite는 `VACUUM INTO` 로 일관된 복사본을 만들고, `manifest.json`(버전, 시각, 파일 목록, sha256)을 함께 넣습니다.
  - ② `harness-x restore <file>` 은 서버가 꺼져 있을 때만 동작합니다(12번 잠금 파일로 확인). 지금 홈은 `~/.harness-x.bak-<시각>` 으로 옮긴 뒤 풉니다.
  - ③ 설정 화면에 [백업 만들기] 버튼을 둡니다.
- 작업량 M · 위험: 복원하면 지금 데이터를 덮어씁니다. 반드시 먼저 옆에 보관하고, 사람이 클릭했다는 토큰(gesture)을 요구해야 합니다.

### 7) 크래시 복구 — 있음

- 근거:
  - `packages/kernel/src/recover.ts:66-80` `repairSessionTail` 이 잘린 마지막 줄에 줄바꿈을 붙입니다.
  - `recover.ts:93-97` 에서 미종료 세션을 찾고, `cli.ts:458` 에서 시작 때 탐지해 `GET /api/recovery` "이어서 하기" 카드를 보여 줍니다.
  - `event-log.ts:203-213` 은 다시 읽을 때 잘린 줄을 건너뜁니다. 설정 파일은 tmp 파일에 쓴 뒤 이름을 바꾸는 방식으로 원자적으로 저장합니다(`settings/store.ts:120` 등).
- 남은 틈:
  - ① index.sqlite가 깨지면 서버가 기동하지 못합니다. JSONL에서 다시 만드는 경로가 없습니다(3번에서 다룸).
  - ② 승인 기록 `plugins-core/approvals/src/store.ts:329-334` `records()` 가 잘린 줄에서 `JSON.parse` 예외를 냅니다.
- 구현: ② `records()` 에 try를 넣어 깨진 줄을 건너뜁니다(S). ① EventLog 생성자에서 `PRAGMA quick_check` 가 실패하면 파일을 `index.sqlite.broken-<시각>` 으로 옮기고 JSONL에서 다시 만듭니다(M).

### 8) 업데이트 후 기본 플러그인 지문 문제 — 부분 (C1-005, 참고만)

- 근거: `loader.ts:244` 에서 "plugins.lock 불일치: 파일이 변조됨"으로 막힙니다. 이를 우회하는 코드는 실행기 `start.sh:25-45` 에만 있습니다. 데스크톱과 직접 `serve` 로 켜는 경로에는 없습니다.
- 해결 방법은 C1-005에서 다룹니다. 여기서는 운영 관점만 적습니다. 업데이트 절차서(9번 아래 "업데이트" 항목)에 "업데이트 뒤 첫 기동 확인"을 넣어야 합니다.

### 9) 포트 충돌 — 부분

- 근거:
  - 데스크톱은 `--port 0` 으로 임의 포트를 써서 충돌하지 않습니다(`sidecar.rs:40`, `:60`).
  - 실행기는 3790에 고정입니다(`start.sh:11`, `cli.ts:464`).
  - **`server.ts:135` 가 listen(`:298`)보다 먼저 토큰 파일을 덮어씁니다.** 그래서 두 번째 serve가 포트 충돌로 실패해도 `run/token` 은 이미 바뀌어 있습니다. 결과적으로 **켜져 있던 첫 서버를 실행기와 브라우저가 더 이상 열지 못합니다**(401).
- 구현:
  - ① 토큰 파일은 listen에 성공한 다음에 씁니다(writeTokenFile을 `server.ts:298` 아래로 옮김).
  - ② EADDRINUSE가 나면 3번 쉬운 말 안내를 보여 줍니다.
  - ③ (선택) `--port auto` 옵션을 만듭니다. 3790을 쓸 수 없으면 3791~3799를 시도하고, 정해진 포트를 `run/server.json` 에 적습니다. start.sh는 그 파일에서 포트를 읽습니다.
- 작업량 S(①②) / S(③) · 위험: ① 이 가장 시급합니다. 지금 상태에서는 사용자가 바로가기를 두 번 누르기만 해도 생길 수 있습니다.

### 10) 토큰·인증 기본값(루프백만) — 있음

- 근거:
  - 루프백이 아닌 주소에 바인딩하면 거부합니다(`server.ts:118-120`, `:133`).
  - Host 헤더를 검사해 DNS 리바인딩을 막습니다(`server.ts:144-151`).
  - 32바이트 무작위 토큰을 쓰고 비교는 timingSafeEqual로 합니다(`server.ts:134`, `:314-326`).
  - 토큰 파일 권한은 600입니다(`server.ts:121-129`). CORS는 Tauri 출처만 허용합니다(`server.ts:113`).
  - 환경변수 토큰은 32자 이상이어야 받습니다(`cli.ts:848`).
- 남은 틈(낮음):
  - Windows의 /mnt/c는 600 권한이 적용되지 않을 수 있습니다. 다만 홈이 WSL 리눅스 쪽에 있으면 문제없습니다.
  - start.sh가 토큰을 주소 `?token=` 으로 넘기므로 브라우저 방문 기록에 남을 수 있습니다. 화면이 주소창에서 지운다는 주석은 있지만, 방문 기록에서 지워지는지는 확인하지 않았습니다.
- 구현(선택): 일회용 교환 코드를 씁니다. `?code=` 로 넘기고, 화면이 `POST /api/session/exchange` 로 진짜 토큰과 바꿉니다. 코드는 30초가 지나면 무효가 됩니다. 작업량 S.

### 11) 비밀 저장(키체인) — 부분

- 근거: `packages/kernel/src/secrets.ts:44-58` 은 `@napi-rs/keyring` 을 씁니다. 이 라이브러리는 리눅스에서 **Secret Service가 없으면 커널 keyutils로 말없이 바꿉니다**. 설명서(`node_modules/.pnpm/@napi-rs+keyring@2.1.2/.../README.md` 20-45줄)에 "keyutils 저장소는 메모리에만 있고 재부팅하면 사라진다"고 적혀 있습니다.
- 지금 쓰는 곳은 **WSL(Ubuntu)이고 보통 gnome-keyring이 없습니다**. 따라서 저장한 API 키가 **`wsl --shutdown` 이나 PC를 재부팅하면 사라질 가능성이 큽니다**. 진단 파일과 설정 화면은 "있음/없음"만 보여 줘서, 사용자는 왜 키가 사라졌는지 알 수 없습니다.
- 구현:
  - ① 시작 때 키체인 종류를 알아냅니다. Secret Service D-Bus가 있는지(`DBUS_SESSION_BUS_ADDRESS` 와 `org.freedesktop.secrets`) 확인합니다.
  - ② 메모리 저장소일 때는 설정 화면의 키 칸, 진단 파일, `/api/ready` 에 "이 PC에서는 키가 재부팅 뒤 사라져요"라고 표시합니다.
  - ③ (M) WSL에서는 Windows 자격 증명 관리자를 쓰는 백엔드를 추가합니다. PowerShell `CredRead`/`CredWrite` 호출이나 Windows 쪽 helper를 쓰는 방식이고, `SecretBackend` 인터페이스(secrets.ts:19-25)에 맞춰 넣습니다.
- 작업량 S(①②) / M(③) · 위험: ③ 은 키 원문이 명령줄 인자로 새지 않게 stdin으로 넘겨야 합니다.

### 12) 동시 실행 방지(이미 켜진 서버 감지) — 없음

- 근거:
  - cli.ts에 잠금 파일이나 pid 파일 검사가 없습니다(grep 결과 0건). `server.pid` 는 실행기만 씁니다(`start.sh:54`).
  - 데스크톱(port 0, `desktop-token`)과 실행기(3790, `token`)가 **같은 `~/.harness-x` 를 동시에 쓸 수 있습니다**. 이 경우 index.sqlite, settings.json, 세션 색인, approvals.jsonl을 두 프로세스가 함께 씁니다.
  - 데스크톱 앱 자체도 두 번 켤 수 있습니다(Tauri single-instance 플러그인이 없음, `Cargo.toml`).
- 구현:
  - ① serve가 시작될 때 `run/server.lock` 을 `openSync(…, 'wx')` 로 만들고 `{pid, port, startedAt, version}` 을 적습니다.
  - ② 파일이 이미 있으면 pid가 살아 있는지(`process.kill(pid, 0)`)와 health live를 확인합니다. 살아 있으면 "이미 켜져 있어요: 주소 …"를 보여 주고 종료 코드 3으로 끝납니다. 죽어 있으면 남은 잠금 파일로 보고 지운 뒤 다시 잡습니다.
  - ③ 종료할 때 잠금 파일을 지웁니다.
  - ④ 데스크톱은 `tauri-plugin-single-instance` 를 추가합니다. 실행기가 켠 서버가 이미 있으면 그 서버에 붙을지 묻습니다.
- 작업량 M · 위험: 남은 잠금 파일 때문에 서버가 영영 켜지지 않는 일이 없도록 pid 확인과 health 확인을 둘 다 해야 합니다.

### 13) 리소스 한도(동시 세션·메모리) — 부분

- 근거:
  - 첨부 동시 처리 수만 제한합니다(`settings/registry.ts:580` `attachments.concurrency` 1~8).
  - `Dispatcher`(`dispatch.ts:282~`)에는 동시 세션 상한이 없습니다.
  - 메모리 상한(`--max-old-space-size`)과 WebSocket 연결 수 상한이 없습니다. 요청 본문은 Fastify 기본값 1MB입니다.
  - 사용량·비용 한도는 엔진 쿼터로만 다룹니다(`quota.ts`).
- 구현:
  - ① `sessions.maxConcurrent` 설정을 추가합니다(기본 3, 1~16). 넘으면 POST /api/sessions가 429와 "지금 작업 3개가 돌고 있어요. 하나가 끝나면 시작할게요"를 돌려주거나, 대기열에 넣습니다.
  - ② start.sh와 데스크톱 명령에 `--max-old-space-size=2048` 을 넣습니다.
  - ③ `/api/ready` 에 `process.memoryUsage().rss` 를 넣고, 1.5GB를 넘으면 경고를 이벤트로 남깁니다.
- 작업량 S(②③) / M(①) · 위험: ① 대기열로 만들면 정지·이어하기(stop.ts)와 맞물리므로 테스트가 필요합니다.

### 14) 오류 보고·진단 파일 내보내기 — 부분

- 근거:
  - `settings/diagnostics.ts:45-69` 에 버전, OS, Node, 플러그인, 엔진, 설정 값이 들어갑니다. 키는 "있음/없음"만 넣고 키 모양 글자는 가립니다(`:21-37`).
  - `GET /api/settings/diagnostics`(`api/settings-routes.ts:120`)로 내려받습니다.
- 빠진 것: 서버 로그 마지막 부분, 최근 오류 이벤트, 거부된 플러그인 목록(`loader.rejections`), 미종료 세션 수, 디스크·로그 크기, 키체인 종류(11번), 크래시 파일 목록이 없습니다.
- 구현: `DiagnosticsInput` 에 `extras()` 를 추가합니다. 서버 로그 마지막 200줄과 최근 error 이벤트 20개는 `redactSecrets` 를 거쳐 넣고, `rejected`, `unfinished`, `logsMb`, `keychain`, `crashFiles` 도 함께 넣습니다. 설정 화면의 [진단 파일 저장] 버튼은 그대로 씁니다.
- 작업량 S · 위험: 대화 내용이 섞이지 않게 해야 합니다. error 이벤트는 `message`·`code` 만 넣습니다.

### 15) 정상 종료(신호 처리) — 부분

- 근거:
  - `cli.ts:896-905` 에서 SIGINT·SIGTERM을 받으면 `abortAll` → 재로더 정지 → `server.close` → `log.close` → exit 순서로 끝냅니다.
  - 데스크톱은 stdin을 닫고 5초 뒤 강제 종료합니다(`lib.rs:60-65`, `cli.ts:338-341`).
  - stop.sh는 `kill` 만 보내고 기다리지 않습니다.
- 빠진 것:
  - ① 종료에 시간 제한이 없습니다. 열린 WebSocket이나 끝나지 않는 엔진 때문에 `server.close` 가 걸리면 영영 끝나지 않습니다.
  - ② `abortAll` 은 신호만 보내고, 엔진 자식 프로세스가 끝날 때까지 기다리지 않습니다. 그래서 고아 프로세스가 남을 수 있습니다.
  - ③ Windows 콘솔에서 창을 닫을 때(SIGHUP/SIGBREAK)는 처리하지 않습니다.
- 구현:
  - `stop()` 에서 `setTimeout(() => process.exit(1), 10_000).unref()` 를 먼저 겁니다.
  - `dispatch.abortAll()` 다음에 `Promise.race([모든 live.done, 5초])` 로 기다립니다. 종료 이벤트 `kernel_shutdown` 을 기록하고, SIGHUP도 받습니다.
  - stop.sh는 kill 뒤 최대 10초까지 `kill -0` 으로 확인하고, 그래도 살아 있으면 `kill -9` 를 보냅니다.
- 작업량 S · 위험: 낮음
- 참고: Node.js process signal events https://nodejs.org/api/process.html#signal-events

### 16) 버전 표시·호환성 — 부분

- 근거:
  - 버전은 `settings/runtime.ts:56-64` `kernelVersion()` 으로 읽고, `/api/settings/about` 과 진단 파일에 나옵니다.
  - 하지만 kernel과 루트 package.json 버전이 **0.0.0**이고, 데스크톱은 0.1.0입니다(`tauri.conf.json:4`). 서로 맞지 않습니다.
  - `harness-x --version` 이 없습니다.
  - 실행할 때 Node 버전(>=22.19, `package.json:7-8`)을 검사하지 않습니다.
  - 업데이트 확인(`checkUpdate`)은 cli.ts에 연결되어 있지 않습니다(grep 0건).
  - 데이터 형식 버전(settings·세션 색인 스키마 버전) 표시와 이전(migration) 규칙이 흩어져 있습니다.
- 구현:
  - ① 버전 하나를 기준으로 삼습니다. 릴리스 때 루트 버전을 kernel과 desktop에 복사하는 스크립트를 둡니다.
  - ② `--version` 과 `serve` 의 listening 줄에 `version` 을 넣습니다.
  - ③ cli.ts 첫 줄에서 `process.versions.node` 를 검사하고, 쉬운 말로 안내합니다.
  - ④ `~/.harness-x/VERSION` 에 마지막으로 실행한 버전을 적습니다. 더 높은 버전이 쓴 데이터를 낮은 버전이 열려고 하면 "새 버전으로 만든 데이터예요"라고 경고합니다.
- 작업량 S(②③④) / S(①) · 위험: 낮음

### 17) 오프라인 동작 — 부분 (실제 동작은 확인하지 않음)

- 근거:
  - 서버는 로컬에서만 돕니다. 업데이트 확인은 확인할 곳이 주입됐을 때만 네트워크를 씁니다(`api/settings-routes.ts:27`). 글꼴(pretendard)은 패키지에 들어 있습니다.
  - 웹 화면은 연결이 끊기면 다시 연결합니다(`apps/web/src/api/client.ts:322`).
  - 클라우드 엔진(claude/codex/gemini)은 네트워크가 있어야 합니다. 하지만 "인터넷이 끊겼어요"를 따로 구분해 안내하지 않습니다. `navigator.onLine` 을 쓰는 곳도 0건입니다.
- 구현:
  - 엔진 오류를 분류할 때 `ENOTFOUND`·`ECONNREFUSED`·`ETIMEDOUT` 을 "인터넷 연결" 종류로 묶습니다.
  - 화면 위쪽 띠에 "인터넷이 끊겨 AI가 답하지 못해요. 연결되면 [이어서 하기]"를 보여 줍니다. 이어하기 카드(7번)는 그대로 씁니다.
- 작업량 S · 위험: 낮음

### 18) 감사 기록(누가 무엇을 승인했나) — 부분

- 근거:
  - 승인 결정은 `plugins-core/approvals/src/store.ts:160-163`, `:271-283` 에서 `approvals.jsonl` 에 `{ts, cardId, choice, remember, by, text}` 로 추가만 하는 방식으로 남습니다.
  - API를 거친 승인의 `by` 는 항상 `'api'` 입니다(`api/approvals-routes.ts:76`, `:89`). 화면에서 누른 것인지 CLI에서 한 것인지 구분할 수 없습니다.
  - 다음 일은 기록하지 않습니다: 설정 변경(PUT /api/settings), 키 저장·삭제, 플러그인 신뢰 승격(`server.ts` `/api/plugins/:id/promote`), 가져오기(import), 데이터 정리.
  - 이벤트 기록은 보관 정리 때 지워질 수 있습니다.
- 구현:
  - ① `~/.harness-x/audit/audit-YYYY-MM.jsonl` 에 추가만 하는 감사 기록기를 둡니다. 형식은 `{ts, actor:'web'|'desktop'|'cli'|'plugin:<id>', action, target, before?, after?}` 이고 값은 마스킹합니다.
  - ② 위 5가지 경로와 승인 경로에서 이 기록기를 부릅니다. `by` 는 요청 출처(Origin, 토큰 종류: desktop-token과 token, gesture 토큰 유무)로 정합니다.
  - ③ 데이터 정리(5번)에서 감사 기록은 뺍니다.
  - ④ 설정 > 데이터·보안 화면에 "최근 변경 50개"를 읽기 전용으로 보여 줍니다.
- 작업량 M · 위험: before/after 값에 비밀이 섞이지 않게 키체인 칸은 "바뀜"이라고만 적습니다.

### 19) CI 품질 문 — 부분

- 근거: `.github/workflows/` 에는 `dead-buttons.yml` 하나만 있습니다(웹 린트와 "전부 눌러 보기"). 타입 검사, 전체 테스트, `prettier --check`, 빌드, `pnpm audit`(C1-008·C1-009 같은 취약점), Rust `cargo test`(sidecar.rs 테스트)는 CI에서 돌지 않습니다.
- 구현: `ci.yml` 을 추가합니다.
  - job ① `pnpm install --frozen-lockfile` → `pnpm -r build` → `pnpm lint` → `pnpm exec tsc -p tsconfig.test.json --noEmit` → `pnpm test`
  - job ② `pnpm audit --prod --audit-level high`(실패하면 막기)
  - job ③ `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`(리눅스, tauri 의존 패키지 설치 필요)
  - 흔들리는 테스트(C1-010)는 `retry: 2` 로 우선 감쌉니다.
  - main 브랜치 보호 규칙에서 ci와 dead-buttons 통과를 필수로 지정합니다.
- 작업량 S(①②) / M(③) · 위험: 지금 빨간불(C1-001~003 타입 오류)이 있으면 첫날부터 막힙니다. 처음 2주는 `continue-on-error` 를 켜고, 고친 뒤 끕니다.

### (부록) 업데이트 절차 — 문서 없음

- 근거: README에 실행기나 업데이트 안내가 없습니다(C6-004).
- 구현: `docs/ops/runbook.md` 에 다음 순서를 적습니다(S). 백업(6번) → 서버 끄기(stop.sh) → `git pull` → `pnpm install --frozen-lockfile` → `pnpm -r build` → 켜기 → `/api/ready` 확인 → 문제가 있으면 복원.
- 참고: Kubernetes liveness/readiness 개념(같은 구분을 로컬 서버에 적용) https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

---

## 2. 꼭 넣을 것 (우선순위 순, 작업량 S·M만) — 0 / 15

| 순위 | 항목                                                                    | 작업량 | 왜 먼저인가                                                      |
| ---- | ----------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| 1    | 토큰 파일을 listen 성공 뒤에 쓰기(9번 ①)                                | S      | 바로가기를 두 번 누르기만 해도 켜져 있던 서버를 못 쓰게 됩니다   |
| 2    | start.sh `api_up` 에 `curl -f` 넣기(1번 ①)                              | S      | 401·403도 "켜짐"으로 잘못 판단합니다                             |
| 3    | 동시 실행 방지 잠금 파일(12번)                                          | M      | 두 서버가 같은 DB와 설정을 동시에 쓰면 데이터가 깨질 수 있습니다 |
| 4    | 서버 로그 덮어쓰기를 멈추고 회전하기(4번 ①)                             | S      | 지금은 죽은 원인 로그가 다시 켤 때 사라집니다                    |
| 5    | 잡히지 않은 예외를 crash 파일로 남기기 + 실행기 자동 재시작(2번 ①②)     | M      | 죽으면 아무도 다시 켜지 않습니다                                 |
| 6    | 기동 실패 쉬운 말 안내 + 일찍 죽으면 로그 꼬리 보여 주기(3번 ①②③)       | S      | 초보 사용자가 원인을 알 수 있어야 합니다                         |
| 7    | 키체인이 휘발성(WSL keyutils)인지 감지하고 경고(11번 ①②)                | S      | 재부팅 뒤 키가 "사라지는" 문제의 원인을 보여 줍니다              |
| 8    | 정상 종료 시간 제한 10초 + stop.sh가 종료 확인(15번)                    | S      | 종료가 걸리거나 고아 프로세스가 남는 것을 막습니다               |
| 9    | `/api/health/live` + `/api/ready`(1번 ②③)                               | S      | 감시(2번)와 업데이트 확인이 이 검사를 씁니다                     |
| 10   | 진단 파일에 로그 꼬리·거부 플러그인·키체인 종류 넣기(14번)              | S      | 문제를 보고할 때 이 파일 하나면 되게 합니다                      |
| 11   | CI에 빌드·타입·테스트·audit 추가(19번 ①②)                               | S      | 회귀와 취약점을 머지 전에 막습니다                               |
| 12   | `--version` + Node 버전 검사 + 버전 통일(16번)                          | S      | 지원 요청 때 버전부터 알아야 합니다                              |
| 13   | 데스크톱 stderr를 파일로 남기고 서버가 죽으면 다시 띄우기(3번 ④, 2번 ③) | M      | 데스크톱에서는 지금 실패 원인을 전혀 볼 수 없습니다              |
| 14   | 감사 기록(설정·키·신뢰 승격·승인 출처)(18번)                            | M      | "누가 무엇을 바꿨나"에 답할 수 있어야 합니다                     |
| 15   | `harness-x backup`/`restore`(6번)                                       | M      | 업데이트 전에 되돌릴 길이 있어야 합니다                          |

그 밖의 S·M 항목(동시 세션 상한 13번, 승인 기록의 깨진 줄 건너뛰기 7번 ②, 오프라인 안내 17번, 기록 크기 경고 5번 ①, 운영 절차서)은 위 15개 다음에 넣습니다.

---

## 3. 원자 체크리스트

형식: `- [ ] I.2.<짧은이름> 동사 1개·결과물 1개 — 검증: ...`

### 순위 1~4

- [ ] I.2.token-after-listen 옮긴다: `server.ts` 의 `writeTokenFile` 호출을 `app.listen` 성공 뒤로 — 검증: 3790을 점유한 상태에서 serve를 실행해 실패하게 한 뒤 `run/token` 의 수정 시각과 내용이 그대로인지 확인하는 테스트
- [ ] I.2.health-curl-f 고친다: `start.sh` 의 `api_up` 에 `-f` 추가 — 검증: 401을 돌려주는 가짜 서버를 3790에 띄우면 `api_up` 이 실패(종료 코드 22)
- [ ] I.2.single-lock 만든다: serve 시작 때 `run/server.lock`(`wx`, `{pid,port,version}`) — 검증: 두 번째 serve가 종료 코드 3과 "이미 켜져 있어요" 문구를 냄. 첫 서버를 kill -9로 죽인 뒤에는 남은 잠금 파일을 지우고 정상 기동
- [ ] I.2.single-lock-release 지운다: 정상 종료 때 `server.lock` — 검증: SIGTERM 뒤 파일 없음
- [ ] I.2.desktop-single 추가한다: `tauri-plugin-single-instance` — 검증: 앱을 두 번 실행하면 첫 창이 앞으로 오고, 서버 프로세스는 1개
- [ ] I.2.log-rotate-launcher 바꾼다: `start.sh` 에서 띄우기 전 `server.log` → `.1`~`.5` 회전, 그리고 `>>` 로 이어 쓰기 — 검증: 두 번 기동한 뒤 `server.log.1` 에 첫 기동 로그가 남아 있음

### 순위 5~8

- [ ] I.2.crash-handler 등록한다: cli.ts에 `uncaughtException`·`unhandledRejection` → `run/crash-<시각>.log`(마스킹) — 검증: 일부러 throw하는 테스트 라우트에서 파일이 생기고, 종료 코드 70, 파일 안에 `sk-` 패턴 0개
- [ ] I.2.launcher-watchdog 만든다: start.sh 서버 감시 반복문(백오프, 1분에 5회 상한) — 검증: kill -9 뒤 10초 안에 `/api/health/live` 가 다시 200. 6번째 죽음에서는 멈추고 안내 문구
- [ ] I.2.startup-explain 만든다: `explainStartupError()`(EADDRINUSE·EACCES·SQLITE_CORRUPT·Node 버전·MODULE_NOT_FOUND) — 검증: 경우별 단위 테스트 5개. 쉬운 말 검사기(`checkPlainKorean`) 통과
- [ ] I.2.eventlog-in-try 옮긴다: `new EventLog` 를 기동 try 안으로 — 검증: 깨진 index.sqlite로 기동하면 스택 없이 안내 문구 1줄과 종료 코드 1
- [ ] I.2.launcher-early-tail 보여 준다: start.sh에서 서버 pid가 사라지면 `tail -n 20 server.log` — 검증: 포트 충돌 상황에서 5초 안에 안내가 나옴(120초 대기 없음)
- [ ] I.2.keychain-kind 알아낸다: 시작 때 키체인 종류(`os`·`volatile`·`none`) — 검증: DBUS 변수가 없는 WSL에서 `volatile`
- [ ] I.2.keychain-warn 표시한다: 설정 화면 키 칸에 "재부팅 뒤 사라져요" 경고 — 검증: `volatile` 일 때 화면 테스트에서 문구가 보임
- [ ] I.2.shutdown-timeout 건다: `stop()` 첫 줄에 10초 강제 종료 타이머 — 검증: 닫히지 않는 WebSocket을 열어 둔 채 SIGTERM을 보내면 11초 안에 종료
- [ ] I.2.shutdown-wait-sessions 기다린다: `abortAll` 뒤 세션 종료(최대 5초) — 검증: 실행 중인 가짜 엔진 자식 프로세스가 종료 뒤 남지 않음(`pgrep` 0)
- [ ] I.2.stop-sh-confirm 고친다: stop.sh가 10초 동안 `kill -0` 으로 확인하고 그래도 살아 있으면 `-9` — 검증: SIGTERM을 무시하는 가짜 프로세스도 12초 안에 사라짐

### 순위 9~12

- [ ] I.2.health-live 추가한다: 토큰 없는 `GET /api/health/live` `{ok,version,pid,startedAt}` — 검증: 토큰 없이 200. Host가 외부 주소면 403. 응답에 token 글자 없음
- [ ] I.2.ready 추가한다: `GET /api/ready`(plugins·db·diskFreeMb·keychain·rss) — 검증: 플러그인이 거부되거나 DB 오류가 나면 503
- [ ] I.2.diag-extras 넣는다: 진단 파일에 로그 꼬리 200줄·거부 플러그인·미종료 수·logsMb·keychain·crash 목록 — 검증: `countSecretPatterns(text) === 0`, 대화 본문 0
- [ ] I.2.ci-workflow 추가한다: `.github/workflows/ci.yml`(build·lint·tsc·test) — 검증: PR에 ci 체크가 표시됨
- [ ] I.2.ci-audit 추가한다: ci.yml에 `pnpm audit --prod --audit-level high` job — 검증: 취약 버전을 고정한 테스트 브랜치에서 실패
- [ ] I.2.version-flag 추가한다: `harness-x --version` — 검증: 버전 숫자 1줄 출력, 종료 코드 0
- [ ] I.2.node-check 넣는다: cli.ts 맨 앞에 Node 22.19 이상인지 검사 — 검증: 낮은 버전 흉내(함수 주입) 테스트에서 쉬운 말 안내
- [ ] I.2.version-sync 만든다: 루트 버전을 kernel·desktop(`tauri.conf.json`, `Cargo.toml`)에 복사하는 스크립트 — 검증: 실행 뒤 세 곳의 버전이 같음

### 순위 13~15

- [ ] I.2.desktop-stderr 바꾼다: `sidecar.rs:95` 의 stderr를 `run/desktop-server.log` 로 — 검증: 일찍 종료하는 가짜 서버의 오류 문구가 파일과 Failed 메시지에 나옴
- [ ] I.2.desktop-restart 만든다: 데스크톱 사이드카 감시 스레드(5초 간격, 최대 5회) — 검증: 서버 pid를 kill하면 상태가 Restarting을 거쳐 Ready로 바뀌고, url이 새 값
- [ ] I.2.audit-writer 만든다: `~/.harness-x/audit/audit-YYYY-MM.jsonl` 추가 전용 기록기 — 검증: 기록 1건이 정확히 1줄이고, 비밀 칸 값은 "바뀜"
- [ ] I.2.audit-hooks 연결한다: 설정 PUT·키 저장/삭제·promote·import·cleanup에 감사 기록 — 검증: 경로마다 1건씩 생김(테스트 5개)
- [ ] I.2.audit-actor 정한다: 승인 `by` 를 요청 출처(web·desktop·cli)로 — 검증: desktop-token으로 승인하면 `by:'desktop'`
- [ ] I.2.audit-keep 뺀다: data-cleanup 대상에서 audit 폴더 — 검증: retentionDays=1 정리 뒤에도 audit 파일이 그대로
- [ ] I.2.backup-cmd 만든다: `harness-x backup`(run 제외, `VACUUM INTO`, manifest sha256) — 검증: 압축을 푼 manifest의 해시가 모두 일치하고, 키 원문 0
- [ ] I.2.restore-cmd 만든다: `harness-x restore`(서버가 꺼져 있을 때만, 기존 홈 `.bak-<시각>` 보관) — 검증: 서버가 켜져 있으면 거부. 복원 뒤 세션 목록이 백업 시점과 같음

### 그 밖

- [ ] I.2.approvals-skip-broken 고친다: `approvals/src/store.ts` 의 `records()` 에서 깨진 줄 건너뛰기 — 검증: 잘린 마지막 줄이 있어도 앞의 기록 N개를 돌려줌
- [ ] I.2.max-sessions 추가한다: 설정 `sessions.maxConcurrent`(기본 3)와 429 쉬운 말 — 검증: 4번째 POST /api/sessions가 429
- [ ] I.2.heap-cap 넣는다: start.sh와 데스크톱 명령에 `--max-old-space-size=2048` — 검증: `/api/ready` 의 heap 한도 값 ≈ 2048MB
- [ ] I.2.offline-kind 분류한다: 엔진 네트워크 오류를 "인터넷 연결" 종류로 — 검증: ENOTFOUND를 흉내 내면 안내 띠 문구가 나옴
- [ ] I.2.logs-size-warn 추가한다: 설정 `data.maxLogMb` 를 넘으면 경고(자동 삭제 없음) — 검증: 상한을 1MB로 두면 설정 화면에 경고
- [ ] I.2.runbook 쓴다: `docs/ops/runbook.md`(켜기·끄기·업데이트·백업·복원·로그 위치) — 검증: 처음 보는 사람이 문서만 보고 업데이트와 복원을 해냄

## 출처

- 코드: 위 각 항목의 파일:줄 (저장소 /mnt/c/agentCli/harness-x)
- @napi-rs/keyring 2.1.2 README "Linux backend selection" — node_modules/.pnpm/@napi-rs+keyring@2.1.2/node_modules/@napi-rs/keyring/README.md 20-45줄 (keyutils는 메모리에만 있고 재부팅하면 사라짐)
- Node.js process signal events: https://nodejs.org/api/process.html#signal-events
- The Twelve-Factor App, Logs: https://12factor.net/logs
- Kubernetes liveness/readiness/startup probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- (이 점검에서는 웹 링크를 새로 열어 보지 않았습니다. 위 링크는 널리 쓰이는 공식 문서입니다.)
