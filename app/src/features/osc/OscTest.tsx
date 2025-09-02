import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function OscTest() {
  const [addr, setAddr] = useState<string>(() => {
    try {
      return localStorage.getItem("osc.addr") || "127.0.0.1";
    } catch {
      return "127.0.0.1";
    }
  });
  const [port, setPort] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("osc.port"));
      return Number.isFinite(v) && v > 0 ? v : 39540;
    } catch {
      return 39540;
    }
  });
  const [rate, setRate] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("osc.rate"));
      return Number.isFinite(v) && v > 0 ? v : 30;
    } catch {
      return 30;
    }
  });
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    return () => {
      if (sending) void invoke("osc_stop");
    };
  }, [sending]);

  const start = async () => {
    setError("");
    try {
      await invoke("osc_start", { addr, port, rateHz: rate });
      setSending(true);
      try {
        localStorage.setItem("osc.addr", addr);
        localStorage.setItem("osc.port", String(port));
        localStorage.setItem("osc.rate", String(rate));
      } catch {
        void 0;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setError(`送信開始に失敗しました: ${msg}`);
    }
  };
  const stop = async () => {
    setError("");
    try {
      await invoke("osc_stop");
      setSending(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "不明なエラー";
      setError(`送信停止に失敗しました: ${msg}`);
    }
  };

  return (
    <div>
      <div className="ipc-row">
        <input
          className="input-text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          aria-label="送信先アドレス"
        />
        <input
          className="input-text"
          style={{ width: 90 }}
          value={port}
          onChange={(e) => setPort(Number(e.target.value) || 0)}
          aria-label="送信ポート"
        />
        <select
          value={String(rate)}
          onChange={(e) => setRate(Number(e.target.value) || 30)}
        >
          <option value="15">15fps</option>
          <option value="30">30fps</option>
          <option value="60">60fps</option>
        </select>
        {sending ? (
          <button className="btn" onClick={stop}>
            停止
          </button>
        ) : (
          <button className="btn primary" onClick={start}>
            開始
          </button>
        )}
      </div>
      <div className="ipc-row small">
        状態: {sending ? "送信中" : "停止中"} / 宛先 udp://{addr}:{port} @{" "}
        {rate}fps
      </div>
      {error && (
        <div className="camera-error" role="alert">
          {error}
        </div>
      )}
      <div className="ipc-row small">
        アドレス: /mc/ping, /mc/blink, /mc/mouth, /mc/head(yaw,pitch,roll)
      </div>
    </div>
  );
}

export default OscTest;
