import { useState } from "react";
import { useEstimator } from "./useEstimator";

export function EstimatorTest() {
  const [enabled, setEnabled] = useState(true);
  const [fps, setFps] = useState(30);
  const { frame } = useEstimator(enabled, fps);

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
    </div>
  );
}

export default EstimatorTest;
