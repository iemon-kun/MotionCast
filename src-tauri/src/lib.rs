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

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct Pose {
  yaw: f32,
  pitch: f32,
  roll: f32,
  blink: f32,
  mouth: f32,
}

struct SenderCtrl {
  stop: Arc<AtomicBool>,
  handle: Option<JoinHandle<()>>,
}

struct AppState {
  sender: Mutex<Option<SenderCtrl>>,
  pose: Arc<Mutex<Pose>>, // latest pose shared between IPC and sender thread
  schema: Arc<Mutex<Schema>>, // current OSC schema
  smoothing_alpha: Arc<Mutex<f32>>, // EMA alpha [0..1]
  upper: Arc<Mutex<UpperBody>>, // latest upper-body quaternions
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      sender: Mutex::new(None),
      pose: Arc::new(Mutex::new(Pose::default())),
      schema: Arc::new(Mutex::new(Schema::Minimal)),
      smoothing_alpha: Arc::new(Mutex::new(0.2)),
      upper: Arc::new(Mutex::new(UpperBody::default())),
    }
  }
}

#[derive(Clone, Copy, Debug)]
enum Schema {
  Minimal,
  ClusterBasic,
  McUpper, // Minimal + upper-body quaternions under /mc/ub/*
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct Quat {
  x: f32,
  y: f32,
  z: f32,
  w: f32,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct UpperBody {
  chest: Option<Quat>,
  l_shoulder: Option<Quat>,
  r_shoulder: Option<Quat>,
  l_upper_arm: Option<Quat>,
  r_upper_arm: Option<Quat>,
  l_lower_arm: Option<Quat>,
  r_lower_arm: Option<Quat>,
  l_wrist: Option<Quat>,
  r_wrist: Option<Quat>,
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
    let shared_pose = state.pose.clone();
    let shared_schema = state.schema.clone();
    let shared_alpha = state.smoothing_alpha.clone();
    let shared_upper = state.upper.clone();
    let handle = thread::spawn(move || {
      let sock = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return,
      };
      let rate = if rate_hz == 0 { 30 } else { rate_hz.min(240) };
      let interval = Duration::from_secs_f64(1.0 / (rate as f64));
      let mut next = Instant::now();
      // Initialize smoothed pose with the first target
      let mut smoothed = Pose::default();
      if let Ok(p) = shared_pose.lock() { smoothed = (*p).clone(); }

      loop {
        if stop_clone.load(Ordering::SeqCst) { break; }
        // 最新値を読み取り（短時間ロック）
        let (yaw, pitch, roll, blink, mouth) = {
          if let Ok(p) = shared_pose.lock() {
            (p.yaw, p.pitch, p.roll, p.blink, p.mouth)
          } else {
            (0.0, 0.0, 0.0, 0.0, 0.0)
          }
        };
        let upper = shared_upper.lock().ok().cloned().unwrap_or_default();

        // Smoothing (EMA)
        let alpha = shared_alpha.lock().ok().map(|g| *g).unwrap_or(0.2);
        let a = if alpha < 0.0 { 0.0 } else if alpha > 1.0 { 1.0 } else { alpha };
        smoothed.yaw += a * (yaw - smoothed.yaw);
        smoothed.pitch += a * (pitch - smoothed.pitch);
        smoothed.roll += a * (roll - smoothed.roll);
        smoothed.blink += a * (blink - smoothed.blink);
        smoothed.mouth += a * (mouth - smoothed.mouth);

        // Build content according to schema; convert radians to degrees for readability
        let (yaw_deg, pitch_deg, roll_deg) = (smoothed.yaw.to_degrees(), smoothed.pitch.to_degrees(), smoothed.roll.to_degrees());
        let schema = shared_schema.lock().ok().map(|g| *g).unwrap_or(Schema::Minimal);
        let mut content: Vec<OscPacket> = match schema {
          Schema::Minimal => vec![
            OscPacket::Message(OscMessage { addr: "/mc/ping".to_string(), args: vec![OscType::String("ok".into())] }),
            OscPacket::Message(OscMessage { addr: "/mc/blink".to_string(), args: vec![OscType::Float(smoothed.blink)] }),
            OscPacket::Message(OscMessage { addr: "/mc/mouth".to_string(), args: vec![OscType::Float(smoothed.mouth)] }),
            OscPacket::Message(OscMessage { addr: "/mc/head".to_string(), args: vec![OscType::Float(yaw_deg), OscType::Float(pitch_deg), OscType::Float(roll_deg)] }),
          ],
          Schema::ClusterBasic => vec![
            OscPacket::Message(OscMessage { addr: "/cluster/face/blink".to_string(), args: vec![OscType::Float(smoothed.blink)] }),
            OscPacket::Message(OscMessage { addr: "/cluster/face/jawOpen".to_string(), args: vec![OscType::Float(smoothed.mouth)] }),
            OscPacket::Message(OscMessage { addr: "/cluster/head/euler".to_string(), args: vec![OscType::Float(yaw_deg), OscType::Float(pitch_deg), OscType::Float(roll_deg)] }),
          ],
          Schema::McUpper => vec![
            OscPacket::Message(OscMessage { addr: "/mc/ping".to_string(), args: vec![OscType::String("ok".into())] }),
            OscPacket::Message(OscMessage { addr: "/mc/blink".to_string(), args: vec![OscType::Float(smoothed.blink)] }),
            OscPacket::Message(OscMessage { addr: "/mc/mouth".to_string(), args: vec![OscType::Float(smoothed.mouth)] }),
            OscPacket::Message(OscMessage { addr: "/mc/head".to_string(), args: vec![OscType::Float(yaw_deg), OscType::Float(pitch_deg), OscType::Float(roll_deg)] }),
          ],
        };
        if let Schema::McUpper = schema {
          let mut push_q = |addr: &str, q: &Option<Quat>| {
            if let Some(qv) = q {
              content.push(OscPacket::Message(OscMessage {
                addr: addr.to_string(),
                args: vec![
                  OscType::Float(qv.x),
                  OscType::Float(qv.y),
                  OscType::Float(qv.z),
                  OscType::Float(qv.w),
                ],
              }));
            }
          };
          push_q("/mc/ub/chest", &upper.chest);
          push_q("/mc/ub/l_shoulder", &upper.l_shoulder);
          push_q("/mc/ub/r_shoulder", &upper.r_shoulder);
          push_q("/mc/ub/l_upper_arm", &upper.l_upper_arm);
          push_q("/mc/ub/r_upper_arm", &upper.r_upper_arm);
          push_q("/mc/ub/l_lower_arm", &upper.l_lower_arm);
          push_q("/mc/ub/r_lower_arm", &upper.r_lower_arm);
          push_q("/mc/ub/l_wrist", &upper.l_wrist);
          push_q("/mc/ub/r_wrist", &upper.r_wrist);
        }
        for p in content {
          if let Ok(buf) = encoder::encode(&p) { let _ = sock.send_to(&buf, &target); }
        }

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

#[tauri::command]
fn osc_update(state: tauri::State<AppState>, pose: Pose) -> Result<(), String> {
  let clamp01 = |x: f32| if x < 0.0 { 0.0 } else if x > 1.0 { 1.0 } else { x };
  let clamp_rad = |x: f32| {
    let limit = std::f32::consts::FRAC_PI_2; // ±90deg
    if x < -limit { -limit } else if x > limit { limit } else { x }
  };
  if let Ok(mut p) = state.pose.lock() {
    p.yaw = clamp_rad(pose.yaw);
    p.pitch = clamp_rad(pose.pitch);
    p.roll = clamp_rad(pose.roll);
    p.blink = clamp01(pose.blink);
    p.mouth = clamp01(pose.mouth);
  }
  Ok(())
}

#[tauri::command]
fn osc_update_upper(state: tauri::State<AppState>, upper: UpperBody) -> Result<(), String> {
  if let Ok(mut u) = state.upper.lock() {
    *u = upper;
  }
  Ok(())
}

#[tauri::command]
fn osc_set_schema(state: tauri::State<AppState>, schema: String) -> Result<(), String> {
  let mut s = state.schema.lock().map_err(|_| "lock error")?;
  let normalized = schema.to_lowercase();
  *s = match normalized.as_str() {
    "cluster" | "cluster-basic" | "cluster_basic" => Schema::ClusterBasic,
    "upper" | "mc-upper" | "mc_upper" | "ub" => Schema::McUpper,
    _ => Schema::Minimal,
  };
  Ok(())
}

#[tauri::command]
fn osc_set_smoothing_alpha(state: tauri::State<AppState>, alpha: f32) -> Result<(), String> {
  let mut a = state.smoothing_alpha.lock().map_err(|_| "lock error")?;
  let x = if alpha.is_nan() { 0.0 } else { alpha };
  *a = if x < 0.0 { 0.0 } else if x > 1.0 { 1.0 } else { x };
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
        Err(_e) => {
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
  let _v: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("無効なJSONです: {}", e))?;
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
    .invoke_handler(tauri::generate_handler![
      ping,
      osc_start,
      osc_stop,
      osc_update,
      osc_update_upper,
      osc_set_schema,
      osc_set_smoothing_alpha,
      config_load,
      config_save,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
