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
  const onChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
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
    try {
      const url = URL.createObjectURL(f);
      // Viewer 側が読み込み後に revoke する前提
      window.dispatchEvent(
        new CustomEvent("motioncast:vrm-select", {
          detail: { url, name: f.name, size: f.size },
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
        <span className="vrm-note">（プレースホルダ。読み込みは未実装）</span>
      </div>
    </div>
  );
}

export default VrmPlaceholder;
