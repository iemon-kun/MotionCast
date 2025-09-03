import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  VRMHumanBoneName,
  VRMExpressionPresetName,
} from "@pixiv/three-vrm-core";
import type {
  UpperBodyDetail,
  UpperBody3DDetail,
} from "../estimation/usePoseLandmarker";

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
  const upperRef = useRef<UpperBodyDetail | null>(null);
  const upper3dRef = useRef<UpperBody3DDetail | null>(null);

  // Simple EMA smoothing for angles (per key)
  const angleSmootherRef = useRef<Record<string, number>>({});
  const smoothAngle = (key: string, next: number, alpha = 0.3) => {
    const prev = angleSmootherRef.current[key];
    if (typeof prev !== "number") {
      angleSmootherRef.current[key] = next;
      return next;
    }
    const v = prev + alpha * (next - prev);
    angleSmootherRef.current[key] = v;
    return v;
  };

  // Calibration and retargeting state for 3D mapping
  const calibRef = useRef<null | {
    // Trunk basis in VRM world at calibration
    trunkQuatVRM: THREE.Quaternion;
    // Trunk basis in MP world at calibration
    trunkQuatMP0: THREE.Quaternion;
    // Mapping at calibration: VRM <- MP
    trunkMap0: THREE.Quaternion;
    // Default bone world orientations and directions at calibration
    bones: {
      lShoulder?: {
        node: THREE.Object3D;
        child?: THREE.Object3D;
        qWorld0: THREE.Quaternion;
        dirWorld0: THREE.Vector3;
      };
      rShoulder?: {
        node: THREE.Object3D;
        child?: THREE.Object3D;
        qWorld0: THREE.Quaternion;
        dirWorld0: THREE.Vector3;
      };
      lUpperArm?: {
        node: THREE.Object3D;
        child?: THREE.Object3D;
        qWorld0: THREE.Quaternion;
        dirWorld0: THREE.Vector3;
      };
      rUpperArm?: {
        node: THREE.Object3D;
        child?: THREE.Object3D;
        qWorld0: THREE.Quaternion;
        dirWorld0: THREE.Vector3;
      };
      lLowerArm?: {
        node: THREE.Object3D;
        child?: THREE.Object3D;
        qWorld0: THREE.Quaternion;
        dirWorld0: THREE.Vector3;
      };
      rLowerArm?: {
        node: THREE.Object3D;
        child?: THREE.Object3D;
        qWorld0: THREE.Quaternion;
        dirWorld0: THREE.Vector3;
      };
      chest?: {
        node: THREE.Object3D;
        qWorld0: THREE.Quaternion;
      };
    };
  }>(null);

  const tryCalibrate3D = () => {
    const vrm = vrmRef.current;
    const d3 = upper3dRef.current;
    if (!vrm || !d3) return;
    const humanoid = vrm.humanoid;
    if (!humanoid) return;
    // Trunk basis from VRM bones: shoulders and hips
    const lShoulder = humanoid.getNormalizedBoneNode(
      VRMHumanBoneName.LeftShoulder,
    );
    const rShoulder = humanoid.getNormalizedBoneNode(
      VRMHumanBoneName.RightShoulder,
    );
    const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (!lShoulder || !rShoulder || !hips) return;
    const pL = new THREE.Vector3();
    const pR = new THREE.Vector3();
    const pH = new THREE.Vector3();
    lShoulder.getWorldPosition(pL);
    rShoulder.getWorldPosition(pR);
    hips.getWorldPosition(pH);
    const x = new THREE.Vector3().subVectors(pR, pL).normalize();
    const y = new THREE.Vector3()
      .subVectors(
        new THREE.Vector3().addVectors(pL, pR).multiplyScalar(0.5),
        pH,
      )
      .normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    // Re-orthogonalize
    y.crossVectors(z, x).normalize();
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    const trunkQuatVRM = new THREE.Quaternion().setFromRotationMatrix(m);

    // MP trunk basis at calibration from current 3D landmarks
    if (!d3.lShoulder || !d3.rShoulder || !(d3.lHip || d3.rHip)) return;
    const pLs_m = new THREE.Vector3(
      d3.lShoulder.x,
      d3.lShoulder.y,
      d3.lShoulder.z,
    );
    const pRs_m = new THREE.Vector3(
      d3.rShoulder.x,
      d3.rShoulder.y,
      d3.rShoulder.z,
    );
    const pLc_m = d3.lHip
      ? new THREE.Vector3(d3.lHip.x, d3.lHip.y, d3.lHip.z)
      : new THREE.Vector3(d3.rHip!.x, d3.rHip!.y, d3.rHip!.z);
    const pRc_m = d3.rHip
      ? new THREE.Vector3(d3.rHip.x, d3.rHip.y, d3.rHip.z)
      : new THREE.Vector3(d3.lHip!.x, d3.lHip!.y, d3.lHip!.z);
    const pHc_m = new THREE.Vector3()
      .addVectors(pLc_m, pRc_m)
      .multiplyScalar(0.5);
    const x_m0 = new THREE.Vector3().subVectors(pRs_m, pLs_m).normalize();
    const y_m0 = new THREE.Vector3()
      .subVectors(
        new THREE.Vector3().addVectors(pLs_m, pRs_m).multiplyScalar(0.5),
        pHc_m,
      )
      .normalize();
    const z_m0 = new THREE.Vector3().crossVectors(x_m0, y_m0).normalize();
    y_m0.crossVectors(z_m0, x_m0).normalize();
    const m_m0 = new THREE.Matrix4().makeBasis(x_m0, y_m0, z_m0);
    const trunkQuatMP0 = new THREE.Quaternion().setFromRotationMatrix(m_m0);
    const trunkMap0 = trunkQuatVRM
      .clone()
      .multiply(trunkQuatMP0.clone().invert());

    // Cache bone default world rotations and direction vectors
    const get = (name: VRMHumanBoneName) =>
      humanoid.getNormalizedBoneNode(name) || undefined;
    const lShoulderNode = get(VRMHumanBoneName.LeftShoulder);
    const rShoulderNode = get(VRMHumanBoneName.RightShoulder);
    const lUpper = get(VRMHumanBoneName.LeftUpperArm);
    const rUpper = get(VRMHumanBoneName.RightUpperArm);
    const lLower = get(VRMHumanBoneName.LeftLowerArm);
    const rLower = get(VRMHumanBoneName.RightLowerArm);
    const lHand = get(VRMHumanBoneName.LeftHand);
    const rHand = get(VRMHumanBoneName.RightHand);
    const chest =
      get(VRMHumanBoneName.UpperChest) ||
      get(VRMHumanBoneName.Chest) ||
      get(VRMHumanBoneName.Spine);

    const dirOf = (a?: THREE.Object3D, b?: THREE.Object3D) => {
      if (!a || !b) return undefined as unknown as THREE.Vector3;
      const pa = new THREE.Vector3();
      const pb = new THREE.Vector3();
      a.getWorldPosition(pa);
      b.getWorldPosition(pb);
      return new THREE.Vector3().subVectors(pb, pa).normalize();
    };

    const qWorld = (n?: THREE.Object3D) => {
      const q = new THREE.Quaternion();
      n?.getWorldQuaternion(q);
      return q;
    };

    calibRef.current = {
      trunkQuatVRM,
      trunkQuatMP0,
      trunkMap0,
      bones: {
        lShoulder:
          lShoulderNode && lUpper
            ? {
                node: lShoulderNode,
                child: lUpper,
                qWorld0: qWorld(lShoulderNode),
                dirWorld0: dirOf(lShoulderNode, lUpper)!,
              }
            : undefined,
        rShoulder:
          rShoulderNode && rUpper
            ? {
                node: rShoulderNode,
                child: rUpper,
                qWorld0: qWorld(rShoulderNode),
                dirWorld0: dirOf(rShoulderNode, rUpper)!,
              }
            : undefined,
        lUpperArm:
          lUpper && lLower
            ? {
                node: lUpper,
                child: lLower,
                qWorld0: qWorld(lUpper),
                dirWorld0: dirOf(lUpper, lLower)!,
              }
            : undefined,
        rUpperArm:
          rUpper && rLower
            ? {
                node: rUpper,
                child: rLower,
                qWorld0: qWorld(rUpper),
                dirWorld0: dirOf(rUpper, rLower)!,
              }
            : undefined,
        lLowerArm:
          lLower && lHand
            ? {
                node: lLower,
                child: lHand,
                qWorld0: qWorld(lLower),
                dirWorld0: dirOf(lLower, lHand)!,
              }
            : undefined,
        rLowerArm:
          rLower && rHand
            ? {
                node: rLower,
                child: rHand,
                qWorld0: qWorld(rLower),
                dirWorld0: dirOf(rLower, rHand)!,
              }
            : undefined,
        chest: chest
          ? {
              node: chest,
              qWorld0: qWorld(chest),
            }
          : undefined,
      },
    };
  };
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
    // Ensure the canvas fits the container (CSS box) regardless of drawing buffer size
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
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

      // Apply upper-body (chest/shoulder/arm) if available (2D approx)
      // Note: 3Dが利用可能な場合は2Dは適用しない（干渉回避）
      const ub = upperRef.current;
      const u3peek = upper3dRef.current;
      if (ub && !u3peek && vrmRef.current) {
        const humanoid = vrmRef.current.humanoid;
        const chestNode =
          humanoid?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) ??
          humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest) ??
          humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
        const lUpperArm = humanoid?.getNormalizedBoneNode(
          VRMHumanBoneName.LeftUpperArm,
        );
        const rUpperArm = humanoid?.getNormalizedBoneNode(
          VRMHumanBoneName.RightUpperArm,
        );
        const lLowerArm = humanoid?.getNormalizedBoneNode(
          VRMHumanBoneName.LeftLowerArm,
        );
        const rLowerArm = humanoid?.getNormalizedBoneNode(
          VRMHumanBoneName.RightLowerArm,
        );

        // Helpers
        const clamp = (x: number, a: number) => (x < -a ? -a : x > a ? a : x);
        const angleBetween = (
          ax: number,
          ay: number,
          bx: number,
          by: number,
        ) => {
          const al = Math.hypot(ax, ay) || 1;
          const bl = Math.hypot(bx, by) || 1;
          const dot = (ax / al) * (bx / bl) + (ay / al) * (by / bl);
          return Math.acos(Math.max(-1, Math.min(1, dot)));
        };

        // Chest roll from shoulder line tilt (2D近似)
        if (chestNode && ub.lShoulder && ub.rShoulder) {
          const dy = ub.lShoulder.y - ub.rShoulder.y; // +: 左肩が下がる
          // 画面座標(y下向き)→胸のZ回転へ小さく反映
          const rollZ = clamp(dy * 1.5, 0.6); // 約±0.6radに制限
          chestNode.rotation.z = smoothAngle("chest.z", rollZ, 0.25);
        }

        // Upper arm roll from shoulder->elbow vector angle (2D)
        if (lUpperArm && ub.lShoulder && ub.lElbow) {
          const dx = ub.lElbow.x - ub.lShoulder.x;
          const dy = ub.lElbow.y - ub.lShoulder.y;
          const theta = Math.atan2(dy, dx); // 右向き0, 下向き+π/2
          // 腕が下向きで0、真横で±π/2 になるよう調整
          const rollZ = clamp(Math.PI / 2 - theta, 1.0);
          lUpperArm.rotation.z = smoothAngle("lUpperArm.z", rollZ, 0.3);
        }
        if (rUpperArm && ub.rShoulder && ub.rElbow) {
          const dx = ub.rElbow.x - ub.rShoulder.x;
          const dy = ub.rElbow.y - ub.rShoulder.y;
          const theta = Math.atan2(dy, dx);
          const rollZ = clamp(Math.PI / 2 - theta, 1.0);
          rUpperArm.rotation.z = smoothAngle("rUpperArm.z", rollZ, 0.3);
        }

        // Lower arm bend from angle between (shoulder->elbow) and (elbow->wrist)
        if (lLowerArm && ub.lShoulder && ub.lElbow && ub.lWrist) {
          const a = {
            x: ub.lElbow.x - ub.lShoulder.x,
            y: ub.lElbow.y - ub.lShoulder.y,
          };
          const b = {
            x: ub.lWrist.x - ub.lElbow.x,
            y: ub.lWrist.y - ub.lElbow.y,
          };
          const ang = angleBetween(a.x, a.y, b.x, b.y); // 0..π
          const bendX = clamp(-ang, 1.2);
          lLowerArm.rotation.x = smoothAngle("lLowerArm.x", bendX, 0.35);
        }
        if (rLowerArm && ub.rShoulder && ub.rElbow && ub.rWrist) {
          const a = {
            x: ub.rElbow.x - ub.rShoulder.x,
            y: ub.rElbow.y - ub.rShoulder.y,
          };
          const b = {
            x: ub.rWrist.x - ub.rElbow.x,
            y: ub.rWrist.y - ub.rElbow.y,
          };
          const ang = angleBetween(a.x, a.y, b.x, b.y);
          const bendX = clamp(-ang, 1.2);
          rLowerArm.rotation.x = smoothAngle("rLowerArm.x", bendX, 0.35);
        }
      }

      // Apply 3D upper-body if available (preferred)
      const u3 = upper3dRef.current;
      if (u3 && vrmRef.current) {
        if (!calibRef.current) tryCalibrate3D();
        const calib = calibRef.current;
        const humanoid = vrmRef.current.humanoid;
        if (
          calib &&
          humanoid &&
          u3.lShoulder &&
          u3.rShoulder &&
          (u3.lHip || u3.rHip)
        ) {
          // Build trunk basis from MediaPipe world
          const pLs = new THREE.Vector3(
            u3.lShoulder.x,
            u3.lShoulder.y,
            u3.lShoulder.z,
          );
          const pRs = new THREE.Vector3(
            u3.rShoulder.x,
            u3.rShoulder.y,
            u3.rShoulder.z,
          );
          const pLc = u3.lHip
            ? new THREE.Vector3(u3.lHip.x, u3.lHip.y, u3.lHip.z)
            : new THREE.Vector3(u3.rHip!.x, u3.rHip!.y, u3.rHip!.z);
          const pRc = u3.rHip
            ? new THREE.Vector3(u3.rHip.x, u3.rHip.y, u3.rHip.z)
            : new THREE.Vector3(u3.lHip!.x, u3.lHip!.y, u3.lHip!.z);
          const pHc = new THREE.Vector3()
            .addVectors(pLc, pRc)
            .multiplyScalar(0.5);
          const x_m = new THREE.Vector3().subVectors(pRs, pLs).normalize();
          const y_m = new THREE.Vector3()
            .subVectors(
              new THREE.Vector3().addVectors(pLs, pRs).multiplyScalar(0.5),
              pHc,
            )
            .normalize();
          const z_m = new THREE.Vector3().crossVectors(x_m, y_m).normalize();
          y_m.crossVectors(z_m, x_m).normalize();
          const m_m = new THREE.Matrix4().makeBasis(x_m, y_m, z_m);
          const q_m = new THREE.Quaternion().setFromRotationMatrix(m_m);
          const q_v = calib.trunkQuatVRM.clone();
          const q_map = q_v.multiply(q_m.clone().invert()); // maps MP->VRM world

          // Helper: compute target world quaternion for a bone by aligning its default dir to mapped direction
          const calcAxisAngle = (
            a: THREE.Vector3,
            b: THREE.Vector3,
          ): { axis: THREE.Vector3; angle: number } => {
            const an = a.clone().normalize();
            const bn = b.clone().normalize();
            const dot = Math.max(-1, Math.min(1, an.dot(bn)));
            if (dot > 0.9995)
              return { axis: new THREE.Vector3(1, 0, 0), angle: 0 };
            if (dot < -0.9995) {
              // 180deg: choose an arbitrary orthogonal axis
              const axis = new THREE.Vector3(1, 0, 0);
              if (Math.abs(an.dot(axis)) > 0.9) axis.set(0, 1, 0);
              const ortho = new THREE.Vector3()
                .crossVectors(an, axis)
                .normalize();
              return { axis: ortho, angle: Math.PI };
            }
            const axis = new THREE.Vector3().crossVectors(an, bn).normalize();
            const angle = Math.acos(dot);
            return { axis, angle };
          };

          const alignDir = (
            dir0: THREE.Vector3,
            target: THREE.Vector3,
            clampMin = 0,
            clampMax = Math.PI,
          ) => {
            const a = dir0.clone().normalize();
            const b = target.clone().normalize();
            const { axis, angle } = calcAxisAngle(a, b);
            const clamped = Math.max(clampMin, Math.min(clampMax, angle));
            return new THREE.Quaternion().setFromAxisAngle(axis, clamped);
          };

          const applyBone = (
            bone: {
              node: THREE.Object3D;
              qWorld0: THREE.Quaternion;
              dirWorld0: THREE.Vector3;
            },
            parent: THREE.Object3D | null,
            targetA: THREE.Vector3,
            targetB: THREE.Vector3,
            smooth = 0.4,
            angleClamp?: { min: number; max: number },
          ) => {
            // Target direction in MP
            const dir_m = new THREE.Vector3().subVectors(targetB, targetA);
            if (dir_m.lengthSq() < 1e-6) return;
            const dir_v = dir_m.applyQuaternion(q_map); // map to VRM world
            const q_align = alignDir(
              bone.dirWorld0,
              dir_v,
              angleClamp?.min ?? 0,
              angleClamp?.max ?? Math.PI,
            );
            const q_world_target = bone.qWorld0.clone().premultiply(q_align);
            const q_parent_world = new THREE.Quaternion();
            parent?.getWorldQuaternion(q_parent_world);
            const q_local_target = q_parent_world
              .clone()
              .invert()
              .multiply(q_world_target);
            // Slerp for smoothing
            bone.node.quaternion.slerp(q_local_target, smooth);
          };

          const bones = calib.bones;
          const parentOf = (n?: THREE.Object3D | null) =>
            n ? (n.parent as THREE.Object3D | null) : null;

          // Left upper arm: shoulder->elbow
          // Shoulder (clavicle): small share towards shoulder->elbow
          if (bones.lShoulder && u3.lShoulder && u3.lElbow) {
            applyBone(
              bones.lShoulder,
              parentOf(bones.lShoulder.node),
              new THREE.Vector3(u3.lShoulder.x, u3.lShoulder.y, u3.lShoulder.z),
              new THREE.Vector3(u3.lElbow.x, u3.lElbow.y, u3.lElbow.z),
              0.2,
              { min: 0, max: 0.5 },
            );
          }
          if (bones.lUpperArm && u3.lShoulder && u3.lElbow) {
            applyBone(
              bones.lUpperArm,
              parentOf(bones.lUpperArm.node),
              new THREE.Vector3(u3.lShoulder.x, u3.lShoulder.y, u3.lShoulder.z),
              new THREE.Vector3(u3.lElbow.x, u3.lElbow.y, u3.lElbow.z),
              0.35,
              { min: 0, max: 2.1 },
            );
          }
          // Right upper arm: shoulder->elbow
          // Shoulder (clavicle): small share towards shoulder->elbow
          if (bones.rShoulder && u3.rShoulder && u3.rElbow) {
            applyBone(
              bones.rShoulder,
              parentOf(bones.rShoulder.node),
              new THREE.Vector3(u3.rShoulder.x, u3.rShoulder.y, u3.rShoulder.z),
              new THREE.Vector3(u3.rElbow.x, u3.rElbow.y, u3.rElbow.z),
              0.2,
              { min: 0, max: 0.5 },
            );
          }
          if (bones.rUpperArm && u3.rShoulder && u3.rElbow) {
            applyBone(
              bones.rUpperArm,
              parentOf(bones.rUpperArm.node),
              new THREE.Vector3(u3.rShoulder.x, u3.rShoulder.y, u3.rShoulder.z),
              new THREE.Vector3(u3.rElbow.x, u3.rElbow.y, u3.rElbow.z),
              0.35,
              { min: 0, max: 2.1 },
            );
          }
          // Left lower arm: elbow->wrist
          if (bones.lLowerArm && u3.lElbow && u3.lWrist) {
            applyBone(
              bones.lLowerArm,
              parentOf(bones.lLowerArm.node),
              new THREE.Vector3(u3.lElbow.x, u3.lElbow.y, u3.lElbow.z),
              new THREE.Vector3(u3.lWrist.x, u3.lWrist.y, u3.lWrist.z),
              0.45,
              { min: 0, max: 2.62 },
            );
          }
          // Right lower arm: elbow->wrist
          if (bones.rLowerArm && u3.rElbow && u3.rWrist) {
            applyBone(
              bones.rLowerArm,
              parentOf(bones.rLowerArm.node),
              new THREE.Vector3(u3.rElbow.x, u3.rElbow.y, u3.rElbow.z),
              new THREE.Vector3(u3.rWrist.x, u3.rWrist.y, u3.rWrist.z),
              0.45,
              { min: 0, max: 2.62 },
            );
          }
          // Chest: align trunk gently
          if (calib.bones.chest) {
            // Apply trunk delta relative to calibration
            const deltaMP = q_m
              .clone()
              .multiply(calib.trunkQuatMP0.clone().invert());
            const deltaVRM = calib.trunkMap0
              .clone()
              .multiply(deltaMP)
              .multiply(calib.trunkMap0.clone().invert());
            const q_world_target = calib.bones.chest.qWorld0
              .clone()
              .multiply(deltaVRM);
            const q_parent_world = new THREE.Quaternion();
            calib.bones.chest.node.parent?.getWorldQuaternion(q_parent_world);
            const q_local_target = q_parent_world
              .clone()
              .invert()
              .multiply(q_world_target);
            calib.bones.chest.node.quaternion.slerp(q_local_target, 0.25);
          }
        }
      }

      // Publish current upper-body local quaternions for OSC (best-effort)
      try {
        const calib = calibRef.current;
        if (vrmRef.current && calib) {
          const bones = calib.bones;
          const toObj = (n?: THREE.Object3D) => {
            if (!n) return undefined;
            const q = n.quaternion;
            return { x: q.x, y: q.y, z: q.z, w: q.w };
          };
          const payload = {
            chest: toObj(bones.chest?.node),
            l_shoulder: toObj(bones.lShoulder?.node),
            r_shoulder: toObj(bones.rShoulder?.node),
            l_upper_arm: toObj(bones.lUpperArm?.node),
            r_upper_arm: toObj(bones.rUpperArm?.node),
            l_lower_arm: toObj(bones.lLowerArm?.node),
            r_lower_arm: toObj(bones.rLowerArm?.node),
            // wrists are optional (not driven yet)
            l_wrist: undefined,
            r_wrist: undefined,
          };
          window.dispatchEvent(
            new CustomEvent("motioncast:upper-body-quat", { detail: payload }),
          );
        }
      } catch {
        // ignore publish errors
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
    const onUpper = (ev: Event) => {
      const ce = ev as CustomEvent<UpperBodyDetail>;
      if (!ce.detail) return;
      upperRef.current = ce.detail;
    };
    window.addEventListener(
      "motioncast:upper-body-update",
      onUpper as EventListener,
    );
    const onUpper3d = (ev: Event) => {
      const ce = ev as CustomEvent<UpperBody3DDetail>;
      if (!ce.detail) return;
      upper3dRef.current = ce.detail;
    };
    window.addEventListener(
      "motioncast:upper-body-3d",
      onUpper3d as EventListener,
    );

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
      window.removeEventListener(
        "motioncast:upper-body-update",
        onUpper as EventListener,
      );
      window.removeEventListener(
        "motioncast:upper-body-3d",
        onUpper3d as EventListener,
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
        <button
          className="btn"
          onClick={() => {
            // 次フレームで再キャリブレーション（3Dデータが来た時点）
            calibRef.current = null;
          }}
        >
          再キャリブレーション
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
