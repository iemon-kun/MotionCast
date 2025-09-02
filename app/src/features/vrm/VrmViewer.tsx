import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

export function VrmViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const [status, setStatus] = useState<string>("未読み込み");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.2, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    const resize = () => {
      const w = el.clientWidth || 640;
      const h = el.clientHeight || 360;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      cube.rotation.y += 0.01;
      const dt = clock.getDelta();
      // VRM があれば update する
      const v = vrmRef.current as unknown as {
        update?: (dt: number) => void;
      } | null;
      v?.update?.(dt);
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

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener(
        "motioncast:vrm-select",
        onSelect as EventListener,
      );
      window.removeEventListener("motioncast:vrm-reset", onReset);
      el.removeChild(renderer.domElement);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="viewer-canvas-wrap">
      <div
        ref={containerRef}
        className="viewer-canvas"
        aria-label="VRMビューア"
      />
      <div className="viewer-status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

export default VrmViewer;
