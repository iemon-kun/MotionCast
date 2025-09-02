import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function IpcPing() {
  const [input, setInput] = useState<string>("hello");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const doPing = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await invoke<string>("ping", { payload: input });
      setResult(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setError(`IPC通信に失敗しました: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="ipc-row">
        <input
          className="input-text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="ping入力"
        />
        <button className="btn" onClick={doPing} disabled={busy}>
          {busy ? "送信中..." : "Ping"}
        </button>
      </div>
      <div className="ipc-row small">
        <div>結果: {result || "(未受信)"}</div>
      </div>
      {error && (
        <div className="camera-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export default IpcPing;
