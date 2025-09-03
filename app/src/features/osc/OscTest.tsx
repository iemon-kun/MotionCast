import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function OscTest() {
  const [addr, setAddr] = useState<string>(() => {
    try {
      return localStorage.getItem("osc.addr") || "192.168.2.103";
    } catch {
      return "192.168.2.103";
    }
  });
  const [port, setPort] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("osc.port"));
      return Number.isFinite(v) && v > 0 ? v : 9000;
    } catch {
      return 9000;
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
  const [schema, setSchema] = useState<string>(() => {
    try {
      return localStorage.getItem("osc.schema") || "minimal";
    } catch {
      return "minimal";
    }
  });
  const [smooth, setSmooth] = useState<string>(() => {
    try {
      return localStorage.getItem("osc.smoothing") || "med";
    } catch {
      return "med";
    }
  });
  // Stabilizer UI state (persisted)
  const [stabEnabled, setStabEnabled] = useState<boolean>(() => {
    try {
      return (localStorage.getItem("stab.enabled") ?? "true") !== "false";
    } catch {
      return true;
    }
  });
  const [visLost, setVisLost] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.visLost"));
      return Number.isFinite(v) ? v : 0.3;
    } catch {
      return 0.3;
    }
  });
  const [holdMs, setHoldMs] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.holdMs"));
      return Number.isFinite(v) ? v : 400;
    } catch {
      return 400;
    }
  });
  const [fadeMs, setFadeMs] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.fadeMs"));
      return Number.isFinite(v) ? v : 800;
    } catch {
      return 800;
    }
  });
  const [reacqMs, setReacqMs] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.reacqMs"));
      return Number.isFinite(v) ? v : 300;
    } catch {
      return 300;
    }
  });
  const [chestMax, setChestMax] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.chestMax"));
      return Number.isFinite(v) ? v : 120;
    } catch {
      return 120;
    }
  });
  const [shoulderMax, setShoulderMax] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.shoulderMax"));
      return Number.isFinite(v) ? v : 180;
    } catch {
      return 180;
    }
  });
  const [armMax, setArmMax] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.armMax"));
      return Number.isFinite(v) ? v : 240;
    } catch {
      return 240;
    }
  });
  const [wristMax, setWristMax] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("stab.wristMax"));
      return Number.isFinite(v) ? v : 360;
    } catch {
      return 360;
    }
  });

  const publishStab = () => {
    try {
      window.dispatchEvent(
        new CustomEvent("motioncast:stabilizer-params", {
          detail: {
            enabled: stabEnabled,
            visLost,
            holdMs,
            fadeMs,
            reacqMs,
            chestMax,
            shoulderMax,
            upperLowerMax: armMax,
            wristMax,
          },
        }),
      );
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    publishStab();
    // persist
    try {
      localStorage.setItem("stab.enabled", String(stabEnabled));
      localStorage.setItem("stab.visLost", String(visLost));
      localStorage.setItem("stab.holdMs", String(holdMs));
      localStorage.setItem("stab.fadeMs", String(fadeMs));
      localStorage.setItem("stab.reacqMs", String(reacqMs));
      localStorage.setItem("stab.chestMax", String(chestMax));
      localStorage.setItem("stab.shoulderMax", String(shoulderMax));
      localStorage.setItem("stab.armMax", String(armMax));
      localStorage.setItem("stab.wristMax", String(wristMax));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stabEnabled,
    visLost,
    holdMs,
    fadeMs,
    reacqMs,
    chestMax,
    shoulderMax,
    armMax,
    wristMax,
  ]);

  useEffect(() => {
    return () => {
      if (sending) void invoke("osc_stop");
    };
  }, [sending]);

  const start = async () => {
    setError("");
    try {
      await invoke("osc_set_schema", { schema });
      const alpha =
        smooth === "off"
          ? 0
          : smooth === "low"
            ? 0.1
            : smooth === "high"
              ? 0.4
              : 0.2;
      await invoke("osc_set_smoothing_alpha", { alpha });
      await invoke("osc_start", { addr, port, rateHz: rate });
      setSending(true);
      try {
        window.dispatchEvent(
          new CustomEvent("motioncast:osc-state", {
            detail: { sending: true, addr, port, rate, schema },
          }),
        );
      } catch {
        /* noop */
      }
      try {
        localStorage.setItem("osc.addr", addr);
        localStorage.setItem("osc.port", String(port));
        localStorage.setItem("osc.rate", String(rate));
        localStorage.setItem("osc.schema", schema);
        localStorage.setItem("osc.smoothing", smooth);
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
      try {
        window.dispatchEvent(
          new CustomEvent("motioncast:osc-state", {
            detail: { sending: false, addr, port, rate, schema },
          }),
        );
      } catch {
        /* noop */
      }
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
        <select
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          aria-label="送信スキーマ"
        >
          <option value="minimal">minimal</option>
          <option value="cluster">cluster-basic</option>
          <option value="mc-upper">mc-upper (head+face+upper-body quat)</option>
          <option value="vmc">vmc (/VMC/Ext/Bone/Pos subset)</option>
        </select>
        <select
          value={smooth}
          onChange={(e) => setSmooth(e.target.value)}
          aria-label="スムージング"
        >
          <option value="off">smoothing: off</option>
          <option value="low">smoothing: low</option>
          <option value="med">smoothing: med</option>
          <option value="high">smoothing: high</option>
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
      <div className="ipc-row" style={{ marginTop: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={stabEnabled}
            onChange={(e) => setStabEnabled(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>安定化を有効化</span>
        </label>
        <label>
          <span className="sr-only">可視性閾値</span>
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={visLost}
            onChange={(e) =>
              setVisLost(Math.max(0, Math.min(1, Number(e.target.value) || 0)))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>vis</span>
        </label>
        <label>
          <input
            type="number"
            min={0}
            max={5000}
            step={50}
            value={holdMs}
            onChange={(e) =>
              setHoldMs(Math.max(0, Number(e.target.value) || 0))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>hold(ms)</span>
        </label>
        <label>
          <input
            type="number"
            min={0}
            max={5000}
            step={50}
            value={fadeMs}
            onChange={(e) =>
              setFadeMs(Math.max(0, Number(e.target.value) || 0))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>fade(ms)</span>
        </label>
        <label>
          <input
            type="number"
            min={0}
            max={5000}
            step={50}
            value={reacqMs}
            onChange={(e) =>
              setReacqMs(Math.max(0, Number(e.target.value) || 0))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>reacq(ms)</span>
        </label>
      </div>
      <div className="ipc-row" style={{ marginTop: 6 }}>
        <label>
          <input
            type="number"
            min={0}
            max={1000}
            step={10}
            value={chestMax}
            onChange={(e) =>
              setChestMax(Math.max(0, Number(e.target.value) || 0))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>chest(deg/s)</span>
        </label>
        <label>
          <input
            type="number"
            min={0}
            max={1000}
            step={10}
            value={shoulderMax}
            onChange={(e) =>
              setShoulderMax(Math.max(0, Number(e.target.value) || 0))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>shoulder</span>
        </label>
        <label>
          <input
            type="number"
            min={0}
            max={1000}
            step={10}
            value={armMax}
            onChange={(e) =>
              setArmMax(Math.max(0, Number(e.target.value) || 0))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>upper/lower</span>
        </label>
        <label>
          <input
            type="number"
            min={0}
            max={1000}
            step={10}
            value={wristMax}
            onChange={(e) =>
              setWristMax(Math.max(0, Number(e.target.value) || 0))
            }
            className="input-number"
          />
          <span style={{ marginLeft: 4 }}>wrist</span>
        </label>
      </div>
      <div className="ipc-row small">
        {schema === "minimal"
          ? "アドレス: /mc/ping, /mc/blink, /mc/mouth, /mc/head(yawDeg,pitchDeg,rollDeg)"
          : schema.startsWith("cluster")
            ? "アドレス: /cluster/face/blink, /cluster/face/jawOpen, /cluster/head/euler(yawDeg,pitchDeg,rollDeg)"
            : schema === "mc-upper"
              ? "アドレス: /mc/ping, /mc/blink, /mc/mouth, /mc/head(...), /mc/ub/(chest|l_shoulder|r_shoulder|l_upper_arm|r_upper_arm|l_lower_arm|r_lower_arm|l_wrist|r_wrist) qx qy qz qw"
              : "アドレス: /VMC/Ext/Bone/Pos [name, px,py,pz, qx,qy,qz,qw]（上半身サブセットのみ送信）"}
      </div>
    </div>
  );
}

export default OscTest;
