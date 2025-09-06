import { useRef, useState } from "react";

export function VrmPlaceholder() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>(() => {
    try {
      return localStorage.getItem("vrm.fileName") || "未読み込み";
    } catch {
      return "未読み込み";
    }
  });
  const [fileSize, setFileSize] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem("vrm.fileSize");
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });

  const onPick = () => inputRef.current?.click();
  const onChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setFileSize(f.size);
    try {
      localStorage.setItem("vrm.fileName", f.name);
      localStorage.setItem("vrm.fileSize", String(f.size));
    } catch {
      // ignore
    }
    // 互換目的: URL と ArrayBuffer の両方を通知（環境により blob: URL が読めない場合に備える）
    let url: string | undefined;
    try {
      url = URL.createObjectURL(f);
    } catch {
      url = undefined;
    }
    let buffer: ArrayBuffer | undefined;
    try {
      buffer = await f.arrayBuffer();
    } catch {
      buffer = undefined;
    }
    try {
      window.dispatchEvent(
        new CustomEvent("motioncast:vrm-select", {
          detail: { url, buffer, name: f.name, size: f.size, type: f.type },
        }),
      );
      document.dispatchEvent(
        new CustomEvent("motioncast:vrm-select", {
          detail: { url, buffer, name: f.name, size: f.size, type: f.type },
        }),
      );
    } catch {
      // ignore
    }
  };
  const onReset = () => {
    setFileName("未読み込み");
    setFileSize(null);
    try {
      localStorage.removeItem("vrm.fileName");
      localStorage.removeItem("vrm.fileSize");
    } catch {
      // ignore
    }
    if (inputRef.current) inputRef.current.value = "";
    try {
      window.dispatchEvent(new CustomEvent("motioncast:vrm-reset"));
      document.dispatchEvent(new CustomEvent("motioncast:vrm-reset"));
    } catch {
      // ignore
    }
  };

  return (
    <div className="vrm-placeholder">
      <div className="vrm-actions">
        <input
          ref={inputRef}
          type="file"
          accept=".vrm,.glb"
          onChange={onChange}
          style={{ display: "none" }}
        />
        <button className="btn" onClick={onPick}>
          ファイルを選択
        </button>
        <button className="btn" onClick={onReset}>
          リセット
        </button>
      </div>
      <div className="vrm-info" aria-live="polite">
        VRM: <b>{fileName}</b>
        {fileSize != null ? `（${Math.round(fileSize / 1024)}KB）` : ""}
        <span className="vrm-note">ファイル選択でビューアに表示</span>
      </div>
    </div>
  );
}

export default VrmPlaceholder;
