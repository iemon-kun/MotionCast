import "./App.css";
import { CameraPreview } from "./features/camera/CameraPreview";

function App() {
  return (
    <main className="app-root">
      <h1>MotionCast</h1>
      <p>初期化済みの空画面です。</p>
      <section className="block mt-4">
        <h2 className="section-title">カメラ</h2>
        <CameraPreview />
      </section>
    </main>
  );
}

export default App;
