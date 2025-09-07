import { useEffect, useState } from "react";
import { useEstimator } from "./useEstimator";
import { useFaceLandmarker } from "./useFaceLandmarker";
import { usePoseLandmarker } from "./usePoseLandmarker";
import { useHandLandmarker } from "./useHandLandmarker";

export function EstimatorTest() {
  const [enabled, setEnabled] = useState(true);
  const [fps, setFps] = useState(30);
  const [useMP, setUseMP] = useState(false);
  const { frame } = useEstimator(enabled && !useMP, fps);
  const { loaded, error } = useFaceLandmarker(enabled && useMP);
  const [usePose, setUsePose] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("pose.enabled");
      return v == null ? true : v !== "false";
    } catch {
      return true;
    }
  });
  const pose = usePoseLandmarker(enabled && usePose, 15);
  const [poseInfo, setPoseInfo] = useState<string>("-");
  const [useHands, setUseHands] = useState(false);
  const hands = useHandLandmarker(enabled && useHands, 24);
  const [handInfo, setHandInfo] = useState<string>("-");

  useEffect(() => {
    if (!usePose) return;
    const onPose = (ev: Event) => {
      const ce = ev as CustomEvent<{
        lWrist?: { x: number; y: number };
        rWrist?: { x: number; y: number };
      }>;
      const lw = ce.detail?.lWrist;
      const rw = ce.detail?.rWrist;
      const fmt = (p?: { x: number; y: number }) =>
        p ? `${(p.x * 100).toFixed(1)}%, ${(p.y * 100).toFixed(1)}%` : "-";
      setPoseInfo(`LWrist: ${fmt(lw)} / RWrist: ${fmt(rw)}`);
    };
    window.addEventListener(
      "motioncast:upper-body-update",
      onPose as EventListener,
    );
    return () =>
      window.removeEventListener(
        "motioncast:upper-body-update",
        onPose as EventListener,
      );
  }, [usePose]);

  useEffect(() => {
    try {
      localStorage.setItem("pose.enabled", String(usePose));
    } catch {
      /* noop */
    }
  }, [usePose]);

  useEffect(() => {
    if (!useHands) return;
    const onHands = (ev: Event) => {
      const ce = ev as CustomEvent<
        Array<{
          handed: "Left" | "Right";
          curls: { thumb: number; index: number; middle: number; ring: number; pinky: number };
        }>
      >;
      const hands = ce.detail || [];
      const avg = (o: { [k: string]: number }) =>
        Object.values(o).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(o).length);
      const L = hands.find((h) => h.handed === "Left");
      const R = hands.find((h) => h.handed === "Right");
      setHandInfo(
        `L:${L ? avg(L.curls).toFixed(2) : "-"} / R:${R ? avg(R.curls).toFixed(2) : "-"}`,
      );
    };
    window.addEventListener("motioncast:hands-3d", onHands as EventListener);
    return () =>
      window.removeEventListener("motioncast:hands-3d", onHands as EventListener);
  }, [useHands]);

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
      <div className="ipc-row small">
        <label>
          <input
            type="checkbox"
            checked={usePose}
            onChange={(e) => setUsePose(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>Pose(上半身)を使用（~15fps）</span>
        </label>
        {usePose && (
          <span style={{ marginLeft: 8 }}>
            {pose.error
              ? `読み込み失敗: ${pose.error}`
              : pose.loaded
                ? poseInfo
                : "読み込み中..."}
          </span>
        )}
      </div>
      <div className="ipc-row small">
        <label>
          <input
            type="checkbox"
            checked={useHands}
            onChange={(e) => setUseHands(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>Hands(両手)を使用（~24fps）</span>
        </label>
        {useHands && (
          <span style={{ marginLeft: 8 }}>
            {hands.error
              ? `読み込み失敗: ${hands.error}`
              : hands.loaded
                ? `平均カール: ${handInfo}`
                : "読み込み中..."}
          </span>
        )}
      </div>
    </div>
  );
}

export default EstimatorTest;
