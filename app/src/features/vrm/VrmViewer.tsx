import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  VRMHumanBoneName,
  VRMExpressionPresetName,
} from "@pixiv/three-vrm-core";

export function VrmViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const [status, setStatus] = useState<string>("未読み込み");
  const [running, setRunning] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("viewer.running");
      return raw == null ? true : raw !== "false";
    } catch {
      return true;
    }
  });
  const [pixelRatioCap, setPixelRatioCap] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("viewer.pixelRatioCap"));
      return Number.isFinite(v) && v > 0 ? v : 2;
    } catch {
      return 2;
    }
  });
  const [targetFps, setTargetFps] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("viewer.targetFps"));
      return Number.isFinite(v) && v > 0 ? v : 60;
    } catch {
      return 60;
    }
  });

  const runningRef = useRef<boolean>(true);
  const fpsRef = useRef<number>(60);
  const poseRef = useRef<{
    yaw?: number;
    pitch?: number;
    roll?: number;
    blink?: number;
    mouth?: number;
  } | null>(null);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    fpsRef.current = targetFps;
  }, [targetFps]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.2, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    const applySize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      // Clamp device pixel ratio so that drawing buffer does not explode
      const maxBuffer = 4096; // safe upper bound
      const cap = Math.max(1, pixelRatioCap);
      let pr = Math.min(window.devicePixelRatio || 1, cap);
      pr = Math.min(pr, maxBuffer / w, maxBuffer / h);
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    el.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(1, 2, 3);
    scene.add(light, new THREE.AmbientLight(0xffffff, 0.4));

    const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x64748b });
    const cube = new THREE.Mesh(geo, mat);
    cube.position.y = 1.0;
    scene.add(cube);

    let raf = 0;
    applySize();
    let pending = 0;
    const onResize = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        applySize();
      });
    };
    window.addEventListener("resize", onResize);
    // Observe container size changes (sidebar toggle etc.)
    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);

    const clock = new THREE.Clock();
    let acc = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      acc += dt;
      if (!runningRef.current) return;
      const minInterval = 1 / Math.max(1, fpsRef.current);
      if (acc < minInterval) return;
      acc = 0;
      cube.rotation.y += 0.01;
      // VRM があれば update する
      const v = vrmRef.current as unknown as {
        update?: (dt: number) => void;
      } | null;
      v?.update?.(dt);
      // Apply head/neck rotation & expressions if available
      const p = poseRef.current;
      const vrm = vrmRef.current;
      if (p && vrm) {
        const humanoid = vrm.humanoid;
        const head = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
        const neck = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck);
        if (head) {
          head.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
        }
        if (neck) {
          // Neck follows with smaller weight for natural motion
          neck.rotation.set(
            (p.pitch ?? 0) * 0.4,
            (p.yaw ?? 0) * 0.4,
            (p.roll ?? 0) * 0.4,
          );
        }
        const em = vrm.expressionManager;
        if (em) {
          const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
          if (typeof p.blink === "number") {
            em.setValue(VRMExpressionPresetName.Blink, clamp01(p.blink));
          }
          if (typeof p.mouth === "number") {
            em.setValue(VRMExpressionPresetName.Aa, clamp01(p.mouth));
          }
        }
      }
      renderer.render(scene, camera);
    };
    animate();

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const disposeCurrent = () => {
      const current = vrmRef.current;
      if (current) {
        scene.remove(current.scene);
        VRMUtils.deepDispose(current.scene);
        vrmRef.current = null;
      }
    };

    const loadFromURL = async (url: string) => {
      setStatus("読み込み中...");
      try {
        disposeCurrent();
        const gltf = await loader.loadAsync(url);
        // three-vrm プラグインにより userData.vrm に格納される
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          setStatus("VRMではありません（0.x想定）");
          URL.revokeObjectURL(url);
          return;
        }
        VRMUtils.rotateVRM0(vrm); // 0.x を three の座標系に調整（v3 util）
        vrm.scene.position.set(0, 0, 0);
        scene.add(vrm.scene);
        vrmRef.current = vrm;
        setStatus("読み込み完了");
      } catch (e) {
        setStatus(
          e instanceof Error ? `読み込み失敗: ${e.message}` : "読み込み失敗",
        );
      } finally {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    };

    const onSelect = (ev: Event) => {
      const ce = ev as CustomEvent<{ url: string; name: string; size: number }>;
      if (!ce.detail?.url) return;
      void loadFromURL(ce.detail.url);
    };
    const onReset = () => {
      disposeCurrent();
      setStatus("未読み込み");
    };
    window.addEventListener("motioncast:vrm-select", onSelect as EventListener);
    window.addEventListener("motioncast:vrm-reset", onReset);
    const onPose = (ev: Event) => {
      const ce = ev as CustomEvent<{
        yaw?: number;
        pitch?: number;
        roll?: number;
        blink?: number;
        mouth?: number;
      }>;
      if (!ce.detail) return;
      poseRef.current = ce.detail;
    };
    window.addEventListener("motioncast:pose-update", onPose as EventListener);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (pending) cancelAnimationFrame(pending);
      ro.disconnect();
      window.removeEventListener(
        "motioncast:vrm-select",
        onSelect as EventListener,
      );
      window.removeEventListener("motioncast:vrm-reset", onReset);
      window.removeEventListener(
        "motioncast:pose-update",
        onPose as EventListener,
      );
      el.removeChild(renderer.domElement);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    };
  }, []);

  // Note: pixelRatioCap は初期化時のみ適用（将来必要なら renderer を ref に保持して動的反映）

  return (
    <div className="viewer-canvas-wrap">
      <div
        ref={containerRef}
        className="viewer-canvas"
        aria-label="VRMビューア"
      />
      <div className="viewer-controls">
        <button
          className="btn"
          aria-pressed={running}
          onClick={() => {
            const next = !running;
            setRunning(next);
            try {
              localStorage.setItem("viewer.running", String(next));
            } catch {
              void 0;
            }
          }}
        >
          {running ? "描画停止" : "描画再開"}
        </button>
        <label>
          <span className="sr-only">PixelRatio上限</span>
          <select
            value={String(pixelRatioCap)}
            onChange={(e) => {
              const v = Number(e.target.value) || 1;
              setPixelRatioCap(v);
              try {
                localStorage.setItem("viewer.pixelRatioCap", String(v));
              } catch {
                void 0;
              }
            }}
          >
            <option value="1">PR 1.0</option>
            <option value="1.5">PR 1.5</option>
            <option value="2">PR 2.0</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Target FPS</span>
          <select
            value={String(targetFps)}
            onChange={(e) => {
              const v = Number(e.target.value) || 30;
              setTargetFps(v);
              try {
                localStorage.setItem("viewer.targetFps", String(v));
              } catch {
                void 0;
              }
            }}
          >
            <option value="30">30fps</option>
            <option value="45">45fps</option>
            <option value="60">60fps</option>
          </select>
        </label>
      </div>
      <div className="viewer-status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

export default VrmViewer;
