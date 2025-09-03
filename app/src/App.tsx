import { CameraPreview } from "./features/camera/CameraPreview";
import { VrmPlaceholder } from "./features/vrm/VrmPlaceholder";
import { VrmViewer } from "./features/vrm/VrmViewer";
import { IpcPing } from "./features/ipc/IpcPing";
import { OscTest } from "./features/osc/OscTest";
import { EstimatorTest } from "./features/estimation/EstimatorTest";
import { OscBridge } from "./features/osc/OscBridge";
import React, { useEffect, useState } from "react";

// ===============================
// UIデモ専用：機能は未実装。見た目確認のためのスタブ。
// three / mediapipe / tauri 等の実装は含みません。
// ===============================

// ---- 小物 ----
function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-2 py-1 rounded-xl bg-white/50 backdrop-blur border text-xs flex items-center gap-1 shadow-sm">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  );
}

function SimpleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white/70 backdrop-blur p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ---- 永続化ユーティリティ（localStorage） ----
function useStickyState<T>(key: string, defaultValue: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue; // ストレージ不可でも問題なく動作
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // 失敗しても無視（任意機能）
    }
  }, [key, state]);
  return [state, setState] as const;
}

export default function App() {
  // ---- 状態 ----
  const [sending, setSending] = useStickyState("ui.sending", false);
  const [cam, setCam] = useStickyState("ui.cam", "FaceTime HD Camera");
  const [res, setRes] = useStickyState("ui.res", "1280x720");
  const [fps, setFps] = useStickyState("ui.fps", 30);
  const [vrmName, setVrmName] = useStickyState("ui.vrm", "未読み込み");
  const [preset, setPreset] = useStickyState(
    "ui.preset",
    "MVP: 上半身+基本表情",
  );
  const [addr, setAddr] = useStickyState("ui.addr", "127.0.0.1");
  const [port, setPort] = useStickyState("ui.port", 39540);
  const [blink, setBlink] = useStickyState("ui.blink", 0.5);
  const [mouth, setMouth] = useStickyState("ui.mouth", 0.25);
  const [showCamera, setShowCamera] = useStickyState("ui.showCamera", true);
  const [openMetrics, setOpenMetrics] = useStickyState("ui.openMetrics", true);
  const [showSidebar, setShowSidebar] = useStickyState("ui.showSidebar", true); // デフォルト表示、収納でビューア拡大

  useEffect(() => {
    const onVrmSelect = (
      ev: Event & { detail: { name: string; url: string } },
    ) => {
      if (ev.detail?.name) {
        setVrmName(ev.detail.name);
      }
    };
    window.addEventListener(
      "motioncast:vrm-select",
      onVrmSelect as EventListener,
    );
    return () =>
      window.removeEventListener(
        "motioncast:vrm-select",
        onVrmSelect as EventListener,
      );
  }, [setVrmName]);

  // --- 簡易スモークテスト（最小テストケース） ---
  useEffect(() => {
    const makeLogText = () => {
      return [
        "[info] UI demo booted.",
        `[info] Camera: ${cam} @ ${res} ${fps}fps`,
        `[info] VRM: ${vrmName}`,
        `[info] OSC: ${sending ? "enabled" : "disabled"} → udp://${addr}:${port}`,
        "[warn] this is a mock. no actual tracking/three/osc.",
      ].join("\n");
    };

    try {
      console.assert(
        typeof cam === "string" && cam.length > 0,
        "[test] cam should be non-empty string",
      );
      console.assert(
        typeof res === "string" && /\d+x\d+/.test(res),
        "[test] res should be WxH string",
      );
      console.assert(
        typeof fps === "number" && fps >= 15 && fps <= 60,
        "[test] fps within [15,60]",
      );
      console.assert(
        typeof addr === "string" && addr.length > 0,
        "[test] addr non-empty",
      );
      console.assert(
        typeof port === "number" && port > 0,
        "[test] port positive",
      );
      const allowed = new Set([
        "MVP: 上半身+基本表情",
        "表情のみ",
        "上半身のみ",
        "将来: PerfectSync (52BS)",
        "将来: 全身トラッキング",
      ]);
      console.assert(
        allowed.has(preset),
        "[test] preset should be in allowed set",
      );
      console.assert(
        typeof showCamera === "boolean",
        "[test] showCamera is boolean",
      );
      const log = makeLogText();
      console.assert(
        !log.includes(">"),
        "[test] log should not contain raw '>' char",
      );
      console.info("[tests] smoke passed");
    } catch (e) {
      console.error("[tests] smoke failed", e);
    }
  }, [
    cam,
    res,
    fps,
    addr,
    port,
    preset,
    showCamera,
    sending,
    showSidebar,
    vrmName,
  ]);

  const logText = [
    "[info] UI demo booted.",
    `[info] Camera: ${cam} @ ${res} ${fps}fps`,
    `[info] VRM: ${vrmName}`,
    `[info] OSC: ${sending ? "enabled" : "disabled"} → udp://${addr}:${port}`,
    "[warn] this is a mock. no actual tracking/three/osc.",
  ].join("\n");

  const oscBtnClasses = sending
    ? "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600"
    : "bg-rose-500 text-white border-rose-600 hover:bg-rose-600";
  const oscBtnLabel = sending ? "送信停止" : "送信開始";

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-indigo-50 to-emerald-50 text-gray-800">
      <OscBridge />
      {/* ヘッダー */}
      <header
        className="sticky top-0 z-20 border-b backdrop-blur bg-white/60"
        data-testid="header"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* サイドバー開閉（同一レイヤーのカラム開閉） */}
          <button
            className="px-2 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs shadow-sm"
            onClick={() => setShowSidebar((v) => !v)}
            aria-label="サイドバー開閉"
          >
            {showSidebar ? "⟨" : "⟩"}
          </button>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-400 shadow-inner" />
          <div>
            <h1 className="text-base font-bold leading-tight">
              VRMトラッキング送信アプリ（UIデモ）
            </h1>
            <p className="text-xs text-gray-500 -mt-0.5">
              カメラ→推定→VRM→最小OSC（デモは見た目のみ）
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatChip label="VRM" value={vrmName} />
            <StatChip label="FPS" value={`${fps}`} />
            <StatChip label="遅延" value="~ 18 ms" />
            <button className="px-3 py-1.5 rounded-xl text-sm font-semibold shadow-sm border bg-white hover:bg-gray-50">
              保存
            </button>
          </div>
        </div>
      </header>

      {/* コンテンツ（同一レイヤー：サイドバー幅をアニメーションし、ビューアが連動拡大） */}
      <main className="max-w-7xl mx-auto p-4">
        <div className="flex gap-4 items-stretch">
          {/* サイドバー：幅をアニメーション */}
          <div
            className={`relative overflow-hidden transition-all duration-300 ease-out`}
            style={{ width: showSidebar ? 320 : 0 }}
          >
            {/* インナーはパディングもアニメーション */}
            <div
              className={`h-full transition-all duration-300 ${
                showSidebar ? "opacity-100 px-0" : "opacity-0 px-0"
              }`}
            >
              <div className="space-y-4 w-[320px] pr-1">
                <SimpleSection title="カメラ設定">
                  <Field label="デバイス">
                    <select
                      value={cam}
                      onChange={(e) => setCam(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 bg-white"
                    >
                      <option>FaceTime HD Camera</option>
                      <option>USB Camera</option>
                      <option>VirtualCam</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="解像度">
                      <select
                        value={res}
                        onChange={(e) => setRes(e.target.value)}
                        className="w-full rounded-lg border px-3 py-2 bg-white"
                      >
                        <option>1920x1080</option>
                        <option>1280x720</option>
                        <option>960x540</option>
                      </select>
                    </Field>
                    <Field label="FPS">
                      <input
                        type="number"
                        min={15}
                        max={60}
                        value={fps}
                        onChange={(e) => setFps(Number(e.target.value))}
                        className="w-full rounded-lg border px-3 py-2 bg-white"
                      />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 px-3 py-2 rounded-lg border bg-white hover:bg-gray-50">
                      テスト撮影
                    </button>
                    <button className="flex-1 px-3 py-2 rounded-lg border bg-white hover:bg-gray-50">
                      再読込
                    </button>
                  </div>
                </SimpleSection>

                <SimpleSection title="VRMモデル">
                  <VrmPlaceholder />
                  <Field label="スケール">
                    <input
                      type="range"
                      min={50}
                      max={150}
                      defaultValue={100}
                      className="w-full"
                    />
                  </Field>
                  <Field label="向き">
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      defaultValue={0}
                      className="w-full"
                    />
                  </Field>
                </SimpleSection>

                <SimpleSection title="トラッキング">
                  <Field label="推定プリセット">
                    <select
                      value={preset}
                      onChange={(e) => setPreset(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 bg-white"
                    >
                      <option>MVP: 上半身+基本表情</option>
                      <option>表情のみ</option>
                      <option>上半身のみ</option>
                      <option>将来: PerfectSync (52BS)</option>
                      <option>将来: 全身トラッキング</option>
                    </select>
                  </Field>
                  <Field label="スムージング（OneEuro/EMAのイメージ）">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      defaultValue={60}
                      className="w-full"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="まばたき">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={blink * 100}
                        onChange={(e) => setBlink(Number(e.target.value) / 100)}
                        className="w-full"
                      />
                    </Field>
                    <Field label="口の開閉">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={mouth * 100}
                        onChange={(e) => setMouth(Number(e.target.value) / 100)}
                        className="w-full"
                      />
                    </Field>
                  </div>
                </SimpleSection>

                <SimpleSection title="OSC送信先">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="アドレス">
                      <input
                        value={addr}
                        onChange={(e) => setAddr(e.target.value)}
                        className="w-full rounded-lg border px-3 py-2 bg-white"
                      />
                    </Field>
                    <Field label="ポート">
                      <input
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                        className="w-full rounded-lg border px-3 py-2 bg-white"
                      />
                    </Field>
                    <Field label="スキーマ">
                      <select className="w-full rounded-lg border px-3 py-2 bg-white">
                        <option>cluster最小セット</option>
                        <option>VRM/一般</option>
                      </select>
                    </Field>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-600">
                      UDPで送信（デモでは未送信）
                    </div>
                  </div>
                </SimpleSection>

                <SimpleSection title="ステータス">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border bg-white p-2">
                      推定: <b>待機中</b>
                    </div>
                    <div className="rounded-lg border bg-white p-2">
                      VRM: <b>{vrmName}</b>
                    </div>
                    <div className="rounded-lg border bg-white p-2">
                      OSC: <b>{sending ? "送信中" : "停止中"}</b>
                    </div>
                    <div className="rounded-lg border bg-white p-2">
                      ログ: <b>正常</b>
                    </div>
                  </div>
                </SimpleSection>
              </div>
            </div>
            {/* 右端取っ手（収納） */}
            {showSidebar && (
              <button
                onClick={() => setShowSidebar(false)}
                className="absolute -right-3 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md border bg-white text-xs shadow"
                aria-label="サイドバーを収納"
              >
                ⟨
              </button>
            )}
          </div>

          {/* メインビュー：flex-1で横幅を占有、サイドバーと同時にアニメーション */}
          <div className="flex-1 transition-all duration-300 ease-out">
            <div
              className={`grid ${
                showCamera ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"
              } gap-4`}
            >
              {/* カメラプレビュー */}
              <div
                className={`relative rounded-2xl border overflow-hidden bg-white/60 backdrop-blur shadow-sm transition-all duration-300 ${
                  showCamera
                    ? "opacity-100 scale-[1.00]"
                    : "opacity-0 scale-[0.98] pointer-events-none h-0"
                }`}
                style={{ height: showCamera ? undefined : 0 }}
              >
                {showCamera && <CameraPreview />}
              </div>

              {/* VRMビュー */}
              <div
                className={`relative rounded-2xl border overflow-hidden bg-white/60 backdrop-blur shadow-sm transition-all duration-300 ${
                  showCamera ? "" : "xl:col-span-2"
                }`}
              >
                <VrmViewer />
                <div className="absolute bottom-2 left-2 flex gap-2">
                  <StatChip
                    label="BlendShape/表情"
                    value={`Blink:${blink.toFixed(2)} / Mouth:${mouth.toFixed(
                      2,
                    )}`}
                  />
                </div>
                <div className="absolute top-2 right-2 flex gap-2">
                  <button
                    className="px-2.5 py-1.5 rounded-lg border bg-white/80 hover:bg-white text-xs shadow-sm"
                    onClick={() => setShowCamera((v) => !v)}
                  >
                    {showCamera ? "カメラ非表示" : "カメラ表示"}
                  </button>
                  <button
                    aria-pressed={sending}
                    onClick={() => setSending((v) => !v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm border transition ${oscBtnClasses}`}
                  >
                    {oscBtnLabel}
                  </button>
                  {!showSidebar && (
                    <button
                      className="px-2.5 py-1.5 rounded-lg border bg-white/80 hover:bg-white text-xs shadow-sm"
                      onClick={() => setShowSidebar(true)}
                    >
                      設定を表示
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 下段：ログ/メトリクス（トグル化） */}
            <section className="rounded-2xl border bg-white/70 backdrop-blur shadow-sm overflow-hidden mt-4">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 select-none"
                onClick={() => setOpenMetrics((v) => !v)}
                aria-expanded={openMetrics}
                aria-controls="metrics"
              >
                <div className="text-sm font-semibold text-gray-700">
                  メトリクス / ログ（ダミー）
                </div>
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs bg-white transition-transform ${
                    openMetrics ? "rotate-90" : "rotate-0"
                  }`}
                >
                  ▶
                </span>
              </button>
              <div
                className={`transition-all duration-300 ${
                  openMetrics
                    ? "opacity-100 max-h-[400px]"
                    : "opacity-0 max-h-0"
                }`}
              >
                {openMetrics && (
                  <div id="metrics" className="p-3 pt-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-lg border bg-gray-50 p-2">
                        <div className="mb-1 text-gray-600">推定FPS</div>
                        <div className="text-lg font-semibold">{fps}</div>
                      </div>
                      <div className="rounded-lg border bg-gray-50 p-2">
                        <div className="mb-1 text-gray-600">平均遅延</div>
                        <div className="text-lg font-semibold">18 ms</div>
                      </div>
                      <div className="rounded-lg border bg-gray-50 p-2">
                        <div className="mb-1 text-gray-600">送信パケット</div>
                        <div className="text-lg font-semibold">~ 60 / 秒</div>
                      </div>
                    </div>
                    <pre className="mt-3 rounded-lg border bg-gray-50 p-2 h-28 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                      {logText}
                    </pre>
                    <div className="mt-3">
                      <SimpleSection title="デバッグコンポーネント">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="rounded-lg border bg-gray-50 p-2">
                            <h4 className="text-xs font-semibold mb-1">
                              IPC Ping
                            </h4>
                            <IpcPing />
                          </div>
                          <div className="rounded-lg border bg-gray-50 p-2">
                            <h4 className="text-xs font-semibold mb-1">
                              OSC Test
                            </h4>
                            <OscTest />
                          </div>
                          <div className="rounded-lg border bg-gray-50 p-2">
                            <h4 className="text-xs font-semibold mb-1">
                              Estimator Test
                            </h4>
                            <EstimatorTest />
                          </div>
                        </div>
                      </SimpleSection>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* フッター */}
      <footer className="border-t bg-white/60 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-2 text-xs text-gray-500 flex items-center gap-2">
          <span>要件: MVP(カメラ・上半身/表情推定・VRM反映・最小OSC)</span>
          <span className="mx-1">/</span>
          <span>
            アーキテクチャ: React + Three.js + Tauri(Rust) + rosc +
            MediaPipe（本デモはUIのみ）
          </span>
        </div>
      </footer>
    </div>
  );
}
