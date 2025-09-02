import { useState } from "react";
import "./App.css";
import { CameraPreview } from "./features/camera/CameraPreview";
import { VrmPlaceholder } from "./features/vrm/VrmPlaceholder";
import { VrmViewer } from "./features/vrm/VrmViewer";
import { IpcPing } from "./features/ipc/IpcPing";
import { OscTest } from "./features/osc/OscTest";
import { saveLocalStorageToConfig } from "./lib/config";

function App() {
  const [showSidebar, setShowSidebar] = useState(true);
  const [openMetrics, setOpenMetrics] = useState(true);

  return (
    <main className="app-root">
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
                  アプリ起動: OK カメラ: 状態はUIを参照 OSC送信: 未実装
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
