//! 하네스 서버 사이드카 (T-063 63.2)
//!
//! 앱이 켜질 때 `harness-x serve --port 0 --exit-with-stdin`을 자식 프로세스로 띄우고,
//! stdout 첫 `{"event":"listening","url":...}` 줄에서 주소를 읽는다. 토큰은 앱이 만들어 환경 변수로 넘긴다.
//! 앱이 끝나면 stdin을 닫아(서버가 스스로 종료) 기다린 뒤, 남아 있으면 강제 종료한다.
//! 앱이 비정상 종료돼도 파이프가 닫히므로 서버는 stdin EOF로 끝난다 (WSL에서는 wsl.exe가 EOF를 전달).

use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
pub struct ServerInfo {
    pub url: String,
    pub token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidecarCommand {
    pub program: String,
    pub args: Vec<String>,
    /// 추가 환경 변수
    pub env: Vec<(String, String)>,
}

/// 서버를 띄울 명령.
/// - `HARNESS_X_SERVER_CMD` (JSON 문자열 배열)이 있으면 그대로
/// - Windows: `wsl.exe -d <HARNESS_X_WSL_DISTRO|Ubuntu> --cd <HARNESS_X_REPO_WSL|/mnt/c/agentCli/harness-x> -e bash -lc ...`
/// - 그 밖: `node <repo>/packages/kernel/dist/cli.js serve ...`
pub fn default_command(get: impl Fn(&str) -> Option<String>) -> SidecarCommand {
    if let Some(raw) = get("HARNESS_X_SERVER_CMD") {
        if let Ok(v) = serde_json::from_str::<Vec<String>>(&raw) {
            if let Some((p, rest)) = v.split_first() {
                return SidecarCommand { program: p.clone(), args: rest.to_vec(), env: vec![] };
            }
        }
    }
    let serve = "serve --port 0 --no-watch --exit-with-stdin --token-file \"${HARNESS_X_HOME:-$HOME/.harness-x}/run/desktop-token\"";
    if cfg!(windows) {
        let distro = get("HARNESS_X_WSL_DISTRO").unwrap_or_else(|| "Ubuntu".into());
        let repo = get("HARNESS_X_REPO_WSL").unwrap_or_else(|| "/mnt/c/agentCli/harness-x".into());
        let script = format!(
            "source scripts/dev/env.sh && exec node --no-warnings packages/kernel/dist/cli.js {serve} --workspace \"$PWD\""
        );
        // 토큰을 WSL 쪽으로 넘긴다 (WSLENV /u = Windows → WSL)
        let wslenv = match get("WSLENV") {
            Some(v) if !v.is_empty() => format!("{v}:HARNESS_X_TOKEN/u"),
            _ => "HARNESS_X_TOKEN/u".into(),
        };
        SidecarCommand {
            program: "wsl.exe".into(),
            args: vec!["-d".into(), distro, "--cd".into(), repo, "-e".into(), "bash".into(), "-lc".into(), script],
            env: vec![("WSLENV".into(), wslenv)],
        }
    } else {
        let repo = get("HARNESS_X_REPO").unwrap_or_else(|| ".".into());
        let mut args = vec![format!("{repo}/packages/kernel/dist/cli.js")];
        args.extend(["serve", "--port", "0", "--no-watch", "--exit-with-stdin"].map(String::from));
        SidecarCommand { program: "node".into(), args, env: vec![] }
    }
}

/// 무작위 세션 토큰 (32바이트 → hex)
pub fn new_token() -> String {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).expect("OS 난수");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// `{"event":"listening","url":"http://127.0.0.1:1234",...}` 줄에서 url
pub fn parse_listening(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("event")?.as_str()? != "listening" {
        return None;
    }
    Some(v.get("url")?.as_str()?.to_string())
}

pub struct Sidecar {
    child: Child,
    stdin: Option<ChildStdin>,
    pub info: ServerInfo,
}

impl Sidecar {
    /// 서버를 띄우고 listening 줄을 기다린다
    pub fn spawn(cmd: &SidecarCommand, token: &str, timeout: Duration) -> Result<Sidecar, String> {
        let mut c = Command::new(&cmd.program);
        c.args(&cmd.args)
            .env("HARNESS_X_TOKEN", token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for (k, v) in &cmd.env {
            c.env(k, v);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            c.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = c.spawn().map_err(|e| format!("서버 실행 실패 ({}): {e}", cmd.program))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("stdout 없음")?;
        let (tx, rx) = mpsc::channel::<String>();
        // stdout은 끝까지 읽어 버린다 (파이프가 차서 서버가 멈추지 않도록)
        thread::spawn(move || {
            let mut sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !sent {
                    if let Some(url) = parse_listening(&line) {
                        let _ = tx.send(url);
                        sent = true;
                    }
                }
            }
        });
        let mut s = Sidecar { child, stdin, info: ServerInfo { url: String::new(), token: token.to_string() } };
        let deadline = Instant::now() + timeout;
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(url) => {
                    s.info.url = url;
                    return Ok(s);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Ok(Some(st)) = s.child.try_wait() {
                        return Err(format!("서버가 준비 전에 종료됨 ({st})"));
                    }
                    if Instant::now() >= deadline {
                        s.stop(Duration::from_millis(500));
                        return Err(format!("서버 기동 시간 초과 ({}초)", timeout.as_secs()));
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let st = s.child.wait().map(|x| x.to_string()).unwrap_or_default();
                    return Err(format!("서버가 준비 전에 종료됨 ({st})"));
                }
            }
        }
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// stdin을 닫고(정상 종료 요청) grace만큼 기다린 뒤, 남아 있으면 강제 종료. 끝나면 true
    pub fn stop(&mut self, grace: Duration) -> bool {
        drop(self.stdin.take());
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return true,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        self.child.wait().is_ok()
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        if self.running() {
            self.stop(Duration::from_secs(3));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 가짜 서버: node 스크립트 (listening 줄 출력 후 stdin EOF에서 종료, 또는 무시)
    fn fake(script: &str) -> SidecarCommand {
        SidecarCommand { program: "node".into(), args: vec!["-e".into(), script.into()], env: vec![] }
    }
    const POLITE: &str = r#"console.log('noise');console.log(JSON.stringify({event:'listening',url:'http://127.0.0.1:4321',tok:process.env.HARNESS_X_TOKEN}));process.stdin.on('end',()=>process.exit(0));process.stdin.resume();"#;
    const STUBBORN: &str = r#"console.log(JSON.stringify({event:'listening',url:'http://127.0.0.1:1'}));process.stdin.on('end',()=>{});process.stdin.resume();setInterval(()=>{},1000);"#;

    #[test]
    fn parse_listening_line() {
        assert_eq!(
            parse_listening(r#"{"event":"listening","url":"http://127.0.0.1:5","port":5}"#),
            Some("http://127.0.0.1:5".into())
        );
        assert_eq!(parse_listening("reloaded x"), None);
        assert_eq!(parse_listening(r#"{"event":"other","url":"x"}"#), None);
    }

    #[test]
    fn start_then_stop_via_stdin_close() {
        let mut s = Sidecar::spawn(&fake(POLITE), "tok123", Duration::from_secs(30)).expect("spawn");
        assert_eq!(s.info, ServerInfo { url: "http://127.0.0.1:4321".into(), token: "tok123".into() });
        assert!(s.running());
        let t = Instant::now();
        assert!(s.stop(Duration::from_secs(10)));
        assert!(!s.running(), "앱 종료 후 서버 프로세스가 남지 않음");
        assert!(t.elapsed() < Duration::from_secs(10), "stdin EOF로 스스로 종료 (강제 종료 전)");
    }

    #[test]
    fn stubborn_server_is_killed() {
        let mut s = Sidecar::spawn(&fake(STUBBORN), "t", Duration::from_secs(30)).expect("spawn");
        assert!(s.stop(Duration::from_millis(500)));
        assert!(!s.running());
    }

    #[test]
    fn drop_stops_server() {
        let s = Sidecar::spawn(&fake(STUBBORN), "t", Duration::from_secs(30)).expect("spawn");
        let pid = s.pid();
        drop(s);
        assert!(!pid_alive(pid), "drop 후 서버 프로세스 없음");
    }

    #[test]
    fn early_exit_is_error() {
        let r = Sidecar::spawn(&fake("process.exit(3)"), "t", Duration::from_secs(30));
        assert!(r.is_err());
    }

    #[test]
    fn default_command_windows_wsl() {
        let env = |k: &str| match k {
            "WSLENV" => Some("FOO".to_string()),
            _ => None,
        };
        let c = default_command(env);
        if cfg!(windows) {
            assert_eq!(c.program, "wsl.exe");
            assert!(c.args.iter().any(|a| a.contains("--exit-with-stdin")));
            assert_eq!(c.env, vec![("WSLENV".to_string(), "FOO:HARNESS_X_TOKEN/u".to_string())]);
        }
        let o = default_command(|k| (k == "HARNESS_X_SERVER_CMD").then(|| r#"["x","y"]"#.to_string()));
        assert_eq!(o, SidecarCommand { program: "x".into(), args: vec!["y".into()], env: vec![] });
        assert_eq!(new_token().len(), 64);
    }

    fn pid_alive(pid: u32) -> bool {
        if cfg!(windows) {
            let out = Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .output()
                .expect("tasklist");
            String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
        } else {
            Command::new("kill").args(["-0", &pid.to_string()]).status().map(|s| s.success()).unwrap_or(false)
        }
    }
}
