import { useEffect, useState } from "react";

type Props = {
  showSidebar: boolean;
  onToggleSidebar: () => void;
};

export function SideRail({ showSidebar, onToggleSidebar }: Props) {
  const [camVisible, setCamVisible] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("camera.visible");
      return raw == null ? true : raw !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("camera.visible", String(camVisible));
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(
        new CustomEvent("motioncast:camera-update-settings", {
          detail: { visible: camVisible },
        }),
      );
      // レイアウト変化の可能性もあるため通知
      window.dispatchEvent(new CustomEvent("motioncast:layout-changed"));
    } catch {
      /* noop */
    }
  }, [camVisible]);

  return (
    <nav className="side-rail" aria-label="クイック操作">
      <button
        type="button"
        className={`icon-btn ${camVisible ? "active" : ""}`}
        aria-pressed={camVisible}
        onClick={() => setCamVisible((v) => !v)}
        aria-label={camVisible ? "カメラを非表示" : "カメラを表示"}
        title={camVisible ? "カメラを非表示" : "カメラを表示"}
      >
        Cam
      </button>
      <button
        type="button"
        className={`icon-btn ${showSidebar ? "active" : ""}`}
        aria-pressed={showSidebar}
        onClick={onToggleSidebar}
        aria-label={showSidebar ? "設定を閉じる" : "設定を開く"}
        title={showSidebar ? "設定を閉じる" : "設定を開く"}
      >
        設
      </button>
    </nav>
  );
}

export default SideRail;
