import { invoke } from "@tauri-apps/api/core";

const KEYS = [
  "camera.deviceId",
  "camera.resolution",
  "camera.fps",
  "camera.visible",
  "viewer.running",
  "viewer.pixelRatioCap",
  "viewer.targetFps",
  "osc.addr",
  "osc.port",
  "osc.rate",
  "vrm.fileName",
  "vrm.fileSize",
];

export type AppConfig = Record<string, unknown>;

export async function loadConfig(): Promise<AppConfig> {
  const raw = await invoke<string>("config_load");
  try {
    return JSON.parse(raw) as AppConfig;
  } catch {
    return {};
  }
}

export async function hydrateLocalStorageFromConfig(): Promise<void> {
  try {
    const cfg = await loadConfig();
    for (const k of KEYS) {
      if (Object.prototype.hasOwnProperty.call(cfg, k)) {
        try {
          const val = (cfg as Record<string, unknown>)[k];
          localStorage.setItem(k, String(val));
        } catch {
          /* noop */
        }
      }
    }
  } catch {
    /* ignore load failure */
  }
}

export function collectLocalStorageConfig(): AppConfig {
  const out: AppConfig = {};
  for (const k of KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    } catch {
      /* noop */
    }
  }
  return out;
}

export async function saveLocalStorageToConfig(): Promise<void> {
  const cfg = collectLocalStorageConfig();
  await invoke("config_save", { content: JSON.stringify(cfg) });
}
