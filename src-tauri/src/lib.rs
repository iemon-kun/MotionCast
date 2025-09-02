#[tauri::command]
fn ping(payload: String) -> String {
  format!("pong: {}", payload)
}

use std::net::UdpSocket;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use std::fs;
use std::path::PathBuf;
use std::env;

struct SenderCtrl {
  stop: Arc<AtomicBool>,
  handle: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct AppState {
  sender: Mutex<Option<SenderCtrl>>,
}

#[tauri::command]
fn osc_start(state: tauri::State<AppState>, addr: String, port: u16, rate_hz: u32) -> Result<(), String> {
  // 既存があれば停止
  if let Ok(mut guard) = state.sender.lock() {
    if let Some(ctrl) = guard.take() {
      ctrl.stop.store(true, Ordering::SeqCst);
      if let Some(h) = ctrl.handle { let _ = h.join(); }
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let target = format!("{}:{}", addr, port);
    let handle = thread::spawn(move || {
      let sock = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return,
      };
      let rate = if rate_hz == 0 { 30 } else { rate_hz.min(240) };
      let interval = Duration::from_secs_f64(1.0 / (rate as f64));
      let mut tick: u64 = 0;
      let mut next = Instant::now();
      loop {
        if stop_clone.load(Ordering::SeqCst) { break; }
        // スタブ値: Blink/Mouth/Head(Yaw/Pitch/Roll)
        let blink = ((tick % 120) as f32 / 120.0).sin().abs();
        let mouth = (((tick + 30) % 120) as f32 / 120.0).sin().abs() * 0.6;
        let yaw = (((tick) % 360) as f32).to_radians().sin() * 0.2;
        let pitch = (((tick + 60) % 360) as f32).to_radians().sin() * 0.15;
        let roll = (((tick + 120) % 360) as f32).to_radians().sin() * 0.1;

        let packets = vec![
          OscPacket::Message(OscMessage { addr: "/mc/ping".to_string(), args: vec![OscType::String("ok".into())] }),
          OscPacket::Message(OscMessage { addr: "/mc/blink".to_string(), args: vec![OscType::Float(blink)] }),
          OscPacket::Message(OscMessage { addr: "/mc/mouth".to_string(), args: vec![OscType::Float(mouth)] }),
          OscPacket::Message(OscMessage { addr: "/mc/head".to_string(), args: vec![OscType::Float(yaw), OscType::Float(pitch), OscType::Float(roll)] }),
        ];

        for p in packets {
          if let Ok(buf) = encoder::encode(&p) {
            let _ = sock.send_to(&buf, &target);
          }
        }

        tick = tick.wrapping_add(1);
        next += interval;
        let now = Instant::now();
        if next > now { thread::sleep(next - now); } else { next = now; }
      }
    });

    *guard = Some(SenderCtrl { stop, handle: Some(handle) });
  }
  Ok(())
}

#[tauri::command]
fn osc_stop(state: tauri::State<AppState>) -> Result<(), String> {
  if let Ok(mut guard) = state.sender.lock() {
    if let Some(ctrl) = guard.take() {
      ctrl.stop.store(true, Ordering::SeqCst);
      if let Some(h) = ctrl.handle { let _ = h.join(); }
    }
  }
  Ok(())
}

fn config_file_path() -> PathBuf {
  // APPDATA (Windows) → HOME/.config (Unix) → current dir
  let mut base = if let Ok(dir) = env::var("APPDATA") {
    PathBuf::from(dir)
  } else if let Ok(home) = env::var("HOME") {
    let mut p = PathBuf::from(home);
    p.push(".config");
    p
  } else {
    PathBuf::from(".")
  };
  base.push("MotionCast");
  let _ = fs::create_dir_all(&base);
  base.push("config.json");
  base
}

#[tauri::command]
fn config_load() -> Result<String, String> {
  let path = config_file_path();
  match fs::read_to_string(&path) {
    Ok(s) => {
      // validate JSON
      match serde_json::from_str::<serde_json::Value>(&s) {
        Ok(_) => Ok(s),
        Err(e) => {
          // backup and return defaults
          let _ = fs::copy(&path, path.with_extension("json.bak"));
          Ok("{}".to_string())
        }
      }
    }
    Err(_) => Ok("{}".to_string()),
  }
}

#[tauri::command]
fn config_save(content: String) -> Result<(), String> {
  // validate
  let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("無効なJSONです: {}", e))?;
  let path = config_file_path();
  let tmp = path.with_extension("json.tmp");
  fs::write(&tmp, content.as_bytes()).map_err(|e| format!("一時ファイル書き込みに失敗しました: {}", e))?;
  fs::rename(&tmp, &path).map_err(|e| format!("保存に失敗しました: {}", e))?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![ping, osc_start, osc_stop, config_load, config_save])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
