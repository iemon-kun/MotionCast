import { useState } from "react";
import "./App.css";
import { CameraPreview } from "./features/camera/CameraPreview";

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
        <button className="btn">保存</button>
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
              <div
                className="viewer-box"
                aria-label="VRMビューア（プレースホルダ）"
              >
                <p>VRMビューア（プレースホルダ）</p>
              </div>
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
