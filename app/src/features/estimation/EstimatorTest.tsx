import { useState } from "react";
import { useEstimator } from "./useEstimator";
import { useFaceLandmarker } from "./useFaceLandmarker";

export function EstimatorTest() {
  const [enabled, setEnabled] = useState(true);
  const [fps, setFps] = useState(30);
  const [useMP, setUseMP] = useState(false);
  const { frame } = useEstimator(enabled && !useMP, fps);
  const { loaded, error } = useFaceLandmarker(enabled && useMP);

  return (
    <div>
      <div className="ipc-row">
        <button className="btn" onClick={() => setEnabled((v) => !v)}>
          {enabled ? "推定停止" : "推定開始"}
        </button>
        <label>
          <span className="sr-only">FPS</span>
          <select
            value={String(fps)}
            onChange={(e) => setFps(Number(e.target.value) || 30)}
          >
            <option value="15">15fps</option>
            <option value="30">30fps</option>
            <option value="60">60fps</option>
          </select>
        </label>
      </div>
      <div className="ipc-row small">
        <div>
          yaw: {frame ? frame.yaw.toFixed(2) : "-"} / pitch:{" "}
          {frame ? frame.pitch.toFixed(2) : "-"} / roll:{" "}
          {frame ? frame.roll.toFixed(2) : "-"} / blink:{" "}
          {frame ? frame.blink.toFixed(2) : "-"} / mouth:{" "}
          {frame ? frame.mouth.toFixed(2) : "-"}
        </div>
      </div>
      <div className="ipc-row small">
        <label>
          <input
            type="checkbox"
            checked={useMP}
            onChange={(e) => setUseMP(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>MediaPipeを使用（要カメラ）</span>
        </label>
        {useMP && (
          <span style={{ marginLeft: 8 }}>
            {error
              ? `読み込み失敗: ${error}`
              : loaded
                ? "準備完了"
                : "読み込み中..."}
          </span>
        )}
      </div>
    </div>
  );
}

export default EstimatorTest;
