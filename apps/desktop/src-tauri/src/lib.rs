//! HARNESS-X 데스크톱 (T-063)
//! - 웹 앱 번들(apps/web/dist)을 임베드
//! - 하네스 서버를 사이드카로 실행·종료 (sidecar.rs)
//! - 폴더 선택은 tauri-plugin-dialog (웹 쪽에서 open({ directory: true }))

pub mod sidecar;

use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum ServerStatus {
    Starting,
    Ready { url: String, token: String },
    Failed { message: String },
}

struct AppState {
    status: Mutex<ServerStatus>,
    server: Mutex<Option<sidecar::Sidecar>>,
}

/// 웹 앱이 서버 주소·토큰을 묻는다 (준비될 때까지 starting)
#[tauri::command]
fn server_info(state: tauri::State<'_, AppState>) -> ServerStatus {
    state.status.lock().expect("status").clone()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { status: Mutex::new(ServerStatus::Starting), server: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![server_info])
        .setup(|app| {
            let handle = app.handle().clone();
            thread::spawn(move || {
                let cmd = sidecar::default_command(|k| std::env::var(k).ok());
                let token = sidecar::new_token();
                let state = handle.state::<AppState>();
                match sidecar::Sidecar::spawn(&cmd, &token, Duration::from_secs(120)) {
                    Ok(s) => {
                        *state.status.lock().expect("status") =
                            ServerStatus::Ready { url: s.info.url.clone(), token: s.info.token.clone() };
                        *state.server.lock().expect("server") = Some(s);
                    }
                    Err(message) => {
                        *state.status.lock().expect("status") = ServerStatus::Failed { message };
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("HARNESS-X 데스크톱 시작 실패")
        .run(|app, ev| {
            // 앱 종료 → 서버 종료 (stdin 닫기 → 5초 뒤 강제 종료)
            if let RunEvent::Exit = ev {
                let taken = app.state::<AppState>().server.lock().ok().and_then(|mut g| g.take());
                if let Some(mut s) = taken {
                    s.stop(Duration::from_secs(5));
                }
            }
        });
}
