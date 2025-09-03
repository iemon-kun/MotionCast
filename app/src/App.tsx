import { useEffect, useState } from "react";
import "./App.css";
import { CameraPreview } from "./features/camera/CameraPreview";
import { VrmPlaceholder } from "./features/vrm/VrmPlaceholder";
import { VrmViewer } from "./features/vrm/VrmViewer";
import { IpcPing } from "./features/ipc/IpcPing";
import { OscTest } from "./features/osc/OscTest";
import { EstimatorTest } from "./features/estimation/EstimatorTest";
import { OscBridge } from "./features/osc/OscBridge";
import { saveLocalStorageToConfig } from "./lib/config";

function App() {
  const [showSidebar, setShowSidebar] = useState(true);
  const [openMetrics, setOpenMetrics] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [oscInfo, setOscInfo] = useState<{
    sending: boolean;
    addr?: string;
    port?: number;
    rate?: number;
    schema?: string;
  } | null>(null);

  useEffect(() => {
    const onOsc = (ev: Event) => {
      const ce = ev as CustomEvent<{
        sending: boolean;
        addr?: string;
        port?: number;
        rate?: number;
        schema?: string;
      }>;
      if (!ce.detail) return;
      setOscInfo(ce.detail);
    };
    window.addEventListener("motioncast:osc-state", onOsc as EventListener);
    const onCamOn: EventListener = () => setCameraActive(true);
    const onCamOff: EventListener = () => setCameraActive(false);
    window.addEventListener("motioncast:camera-stream", onCamOn);
    window.addEventListener("motioncast:camera-stopped", onCamOff);
    return () => {
      window.removeEventListener(
        "motioncast:osc-state",
        onOsc as EventListener,
      );
      window.removeEventListener("motioncast:camera-stream", onCamOn);
      window.removeEventListener("motioncast:camera-stopped", onCamOff);
    };
  }, []);

  return (
    <main className="app-root">
      <OscBridge />
      <header className="app-header" data-testid="header">
        <button
          className="btn"
          onClick={() => setShowSidebar((v) => !v)}
          aria-label="サイドバー開閉"
        >
          {showSidebar ? "⟨" : "⟩"}
        </button>
        <h1 className="app-title">MotionCast</h1>
        <div className="spacer" />
        <button
          className="btn"
          onClick={async () => {
            await saveLocalStorageToConfig().catch(() => {});
          }}
        >
          保存
        </button>
      </header>

      <div className="app-container">
        <aside
          className={`sidebar ${showSidebar ? "open" : "closed"}`}
          aria-label="設定サイドバー"
        >
          <div className="sidebar-inner">
            <h2 className="section-title">設定</h2>
            <ul className="sidebar-list">
              <li>カメラ設定（今後サイドバーへ統合）</li>
              <li>VRMモデル（後日）</li>
              <li>OSC送信（後日）</li>
            </ul>
          </div>
        </aside>

        <section className="content">
          <div className="content-grid">
            <div className="box">
              <h2 className="section-title">カメラプレビュー</h2>
              <CameraPreview />
            </div>
            <div className="box">
              <h2 className="section-title">VRMビューア</h2>
              <VrmPlaceholder />
              <div className="viewer-box" aria-label="VRMビューア領域">
                <VrmViewer />
              </div>
            </div>
            <div className="box">
              <h2 className="section-title">推定テスト（スタブ）</h2>
              <EstimatorTest />
            </div>
            <div className="box">
              <h2 className="section-title">デバッグ: IPC Ping</h2>
              <IpcPing />
            </div>
            <div className="box">
              <h2 className="section-title">送信テスト（OSC）</h2>
              <OscTest />
            </div>
          </div>

          <section className="metrics-section">
            <button
              type="button"
              className="metrics-toggle"
              onClick={() => setOpenMetrics((v) => !v)}
              aria-expanded={openMetrics}
              aria-controls="metrics"
            >
              メトリクス / ログ
            </button>
            {openMetrics && (
              <div id="metrics" className="metrics-body">
                <pre className="metrics-pre">
                  {`アプリ起動: OK  カメラ: ${cameraActive ? "稼働中" : "停止中"}  OSC送信: ${
                    oscInfo?.sending
                      ? `送信中 → udp://${oscInfo.addr ?? "?"}:${oscInfo.port ?? "?"} @ ${oscInfo.rate ?? "?"}fps [${oscInfo.schema ?? "?"}]`
                      : "停止中"
                  }`}
                </pre>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

export default App;
