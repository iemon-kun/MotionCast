import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRMHumanBoneName, VRMExpressionPresetName } from "@pixiv/three-vrm-core";

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
  const [invertChestPitch, setInvertChestPitch] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("viewer.invertChestPitch");
      return raw == null ? false : raw !== "false";
    } catch {
      return false;
    }
  });
  const invertPitchRef = useRef<boolean>(false);
  useEffect(() => {
    invertPitchRef.current = invertChestPitch;
  }, [invertChestPitch]);
  const [showCube, setShowCube] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem("viewer.showCube");
      return s == null ? true : s !== "false";
    } catch {
      return true;
    }
  });

  const runningRef = useRef<boolean>(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  // 3D上半身リターゲット用の最新値とキャリブレーション
  type P3 = { x: number; y: number; z: number };
  type Upper3D = {
    lShoulder?: P3; rShoulder?: P3; lElbow?: P3; rElbow?: P3;
    lWrist?: P3; rWrist?: P3; lHip?: P3; rHip?: P3;
  };
  const upper3dRef = useRef<Upper3D | null>(null);
  const last3DAtRef = useRef<number>(0);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cubeRef = useRef<THREE.Mesh | null>(null);
  // 2D上半身（フォールバック）
  type P2 = { x: number; y: number };
  type Upper2D = {
    lShoulder?: P2; rShoulder?: P2;
    lElbow?: P2; rElbow?: P2;
    lWrist?: P2; rWrist?: P2;
  };
  const upper2dRef = useRef<Upper2D | null>(null);
  const last2DAtRef = useRef<number>(0);
  const calibRef = useRef<null | {
    trunkQuatVRM: THREE.Quaternion;
    bones: {
      lShoulder?: { node: THREE.Object3D; child?: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion; dirWorld0: THREE.Vector3 };
      rShoulder?: { node: THREE.Object3D; child?: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion; dirWorld0: THREE.Vector3 };
      lUpperArm?: { node: THREE.Object3D; child?: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion; dirWorld0: THREE.Vector3 };
      rUpperArm?: { node: THREE.Object3D; child?: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion; dirWorld0: THREE.Vector3 };
      lLowerArm?: { node: THREE.Object3D; child?: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion; dirWorld0: THREE.Vector3 };
      rLowerArm?: { node: THREE.Object3D; child?: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion; dirWorld0: THREE.Vector3 };
      chest?: { node: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion };
      neck?: { node: THREE.Object3D; qWorld0: THREE.Quaternion; qLocal0: THREE.Quaternion };
    };
  }>(null);
  const restRef = useRef<typeof calibRef.current>(null);
  const recalibHoldRef = useRef<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Clean container to avoid duplicate canvases
    while (el.firstChild) el.removeChild(el.firstChild);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.2, 3);
    camera.lookAt(0, 1.0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const applySize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const maxBuffer = 4096;
      const cap = Math.max(1, pixelRatioCap);
      let pr = Math.min(window.devicePixelRatio || 1, cap);
      pr = Math.min(pr, maxBuffer / w, maxBuffer / h);
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    // VRM/オブジェクト全体が収まるようにカメラを合わせる
    const fitCameraToObject = (
      object: THREE.Object3D,
      margin = 1.2, // 20%の余白
    ) => {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const fov = (camera.fov * Math.PI) / 180;
      const aspect = camera.aspect || 16 / 9;
      const halfH = size.y / 2;
      const halfW = size.x / 2;
      const distV = halfH / Math.tan(fov / 2);
      const distH = halfW / Math.tan(Math.atan(Math.tan(fov / 2) * aspect));
      const dist = Math.max(distV, distH) * margin + size.z;
      camera.position.set(center.x, center.y + size.y * 0.05, center.z + dist);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
    };

    el.appendChild(renderer.domElement);
    try { el.setAttribute("data-has-canvas", "true"); } catch {}

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(1, 2, 3);
    scene.add(dir);

    if (showCube) {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x64748b }),
      );
      cube.position.y = 1.0;
      scene.add(cube);
      cubeRef.current = cube;
    } else {
      cubeRef.current = null;
    }

    applySize();
    let raf = 0;
    let pending = 0;
    const onResize = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        applySize();
      });
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);

    const clock = new THREE.Clock();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const v = vrmRef.current as unknown as { update?: (dt: number) => void } | null;
      v?.update?.(dt);
      if (runningRef.current && cubeRef.current) cubeRef.current.rotation.y += 0.01;
      // Optional: apply latest 3D mapping each frame if available
      try {
        const u3 = upper3dRef.current;
        const vrm = vrmRef.current;
        const now = performance.now();
        const active3D = u3 && now - last3DAtRef.current < 180;
        if (active3D && vrm) {
          // Prefer 3D over 2D (2D handlers won't run here)
          // Ensure calibration from REST snapshot, not current posed skeleton
          if (!calibRef.current && restRef.current) {
            calibRef.current = {
              trunkQuatVRM: restRef.current.trunkQuatVRM.clone(),
              bones: {
                lShoulder: restRef.current.bones.lShoulder ? { node: restRef.current.bones.lShoulder.node, child: restRef.current.bones.lShoulder.child, qWorld0: restRef.current.bones.lShoulder.qWorld0.clone(), dirWorld0: restRef.current.bones.lShoulder.dirWorld0.clone() } : undefined,
                rShoulder: restRef.current.bones.rShoulder ? { node: restRef.current.bones.rShoulder.node, child: restRef.current.bones.rShoulder.child, qWorld0: restRef.current.bones.rShoulder.qWorld0.clone(), dirWorld0: restRef.current.bones.rShoulder.dirWorld0.clone() } : undefined,
                lUpperArm: restRef.current.bones.lUpperArm ? { node: restRef.current.bones.lUpperArm.node, child: restRef.current.bones.lUpperArm.child, qWorld0: restRef.current.bones.lUpperArm.qWorld0.clone(), dirWorld0: restRef.current.bones.lUpperArm.dirWorld0.clone() } : undefined,
                rUpperArm: restRef.current.bones.rUpperArm ? { node: restRef.current.bones.rUpperArm.node, child: restRef.current.bones.rUpperArm.child, qWorld0: restRef.current.bones.rUpperArm.qWorld0.clone(), dirWorld0: restRef.current.bones.rUpperArm.dirWorld0.clone() } : undefined,
                lLowerArm: restRef.current.bones.lLowerArm ? { node: restRef.current.bones.lLowerArm.node, child: restRef.current.bones.lLowerArm.child, qWorld0: restRef.current.bones.lLowerArm.qWorld0.clone(), dirWorld0: restRef.current.bones.lLowerArm.dirWorld0.clone() } : undefined,
                rLowerArm: restRef.current.bones.rLowerArm ? { node: restRef.current.bones.rLowerArm.node, child: restRef.current.bones.rLowerArm.child, qWorld0: restRef.current.bones.rLowerArm.qWorld0.clone(), dirWorld0: restRef.current.bones.rLowerArm.dirWorld0.clone() } : undefined,
                chest: restRef.current.bones.chest ? { node: restRef.current.bones.chest.node, qWorld0: restRef.current.bones.chest.qWorld0.clone() } : undefined,
              },
            };
            recalibHoldRef.current = 8; // few frames to relax-to-rest
          }
          const calib = calibRef.current;
          if (calib && u3.lShoulder && u3.rShoulder && (u3.lHip || u3.rHip)) {
            // Build trunk basis from MP
            const pLs = new THREE.Vector3(u3.lShoulder.x, u3.lShoulder.y, u3.lShoulder.z);
            const pRs = new THREE.Vector3(u3.rShoulder.x, u3.rShoulder.y, u3.rShoulder.z);
            const pLc = u3.lHip ? new THREE.Vector3(u3.lHip.x, u3.lHip.y, u3.lHip.z) : new THREE.Vector3(u3.rHip!.x, u3.rHip!.y, u3.rHip!.z);
            const pRc = u3.rHip ? new THREE.Vector3(u3.rHip.x, u3.rHip.y, u3.rHip.z) : new THREE.Vector3(u3.lHip!.x, u3.lHip!.y, u3.lHip!.z);
            const pHc = new THREE.Vector3().addVectors(pLc, pRc).multiplyScalar(0.5);
            const x_m_raw = new THREE.Vector3().subVectors(pRs, pLs).normalize();
            const y_m_raw = new THREE.Vector3().subVectors(new THREE.Vector3().addVectors(pLs, pRs).multiplyScalar(0.5), pHc).normalize();
            const z_m_raw = new THREE.Vector3().crossVectors(x_m_raw, y_m_raw).normalize();
            y_m_raw.crossVectors(z_m_raw, x_m_raw).normalize();
            // Auto sign alignment vs VRM trunk basis
            const x_v = new THREE.Vector3(1, 0, 0).applyQuaternion(calib.trunkQuatVRM).normalize();
            const y_v = new THREE.Vector3(0, 1, 0).applyQuaternion(calib.trunkQuatVRM).normalize();
            const z_v = new THREE.Vector3(0, 0, 1).applyQuaternion(calib.trunkQuatVRM).normalize();
            const sx = x_v.dot(x_m_raw) < 0 ? -1 : 1;
            const sy = y_v.dot(y_m_raw) < 0 ? -1 : 1;
            const x_m = x_m_raw.clone().multiplyScalar(sx);
            let y_m = y_m_raw.clone().multiplyScalar(sy);
            let z_m = new THREE.Vector3().crossVectors(x_m, y_m).normalize();
            y_m.crossVectors(z_m, x_m).normalize();
            if (z_v.dot(z_m) < 0) {
              y_m.multiplyScalar(-1);
              z_m = new THREE.Vector3().crossVectors(x_m, y_m).normalize();
              y_m.crossVectors(z_m, x_m).normalize();
            }
            const m_m = new THREE.Matrix4().makeBasis(x_m, y_m, z_m);
            const q_m = new THREE.Quaternion().setFromRotationMatrix(m_m);
            const q_map = calib.trunkQuatVRM.clone().multiply(q_m.clone().invert()); // MP -> VRM world

            const calcAxisAngle = (a: THREE.Vector3, b: THREE.Vector3) => {
              const an = a.clone().normalize();
              const bn = b.clone().normalize();
              const dot = Math.max(-1, Math.min(1, an.dot(bn)));
              if (dot > 0.9995) return { axis: new THREE.Vector3(1, 0, 0), angle: 0 };
              if (dot < -0.9995) {
                const axis = new THREE.Vector3(1, 0, 0);
                if (Math.abs(an.dot(axis)) > 0.9) axis.set(0, 1, 0);
                const ortho = new THREE.Vector3().crossVectors(an, axis).normalize();
                return { axis: ortho, angle: Math.PI };
              }
              const axis = new THREE.Vector3().crossVectors(an, bn).normalize();
              const angle = Math.acos(dot);
              return { axis, angle };
            };

            const applyBone = (
              bone: { node: THREE.Object3D; qWorld0: THREE.Quaternion; dirWorld0: THREE.Vector3 },
              parent: THREE.Object3D | null,
              targetA: THREE.Vector3,
              targetB: THREE.Vector3,
              smooth = 0.35,
              clamp?: { min: number; max: number }
            ) => {
              const dir_m = new THREE.Vector3().subVectors(targetB, targetA);
              if (dir_m.lengthSq() < 1e-6) return;
              const dir_v = dir_m.applyQuaternion(q_map);
              const { axis, angle } = calcAxisAngle(bone.dirWorld0, dir_v);
              const ang = clamp ? Math.max(clamp.min, Math.min(clamp.max, angle)) : angle;
              const q_align = new THREE.Quaternion().setFromAxisAngle(axis, ang);
              const q_world_target = bone.qWorld0.clone().premultiply(q_align);
              const q_parent_world = new THREE.Quaternion();
              parent?.getWorldQuaternion(q_parent_world);
              const q_local_target = q_parent_world.clone().invert().multiply(q_world_target);
              bone.node.quaternion.slerp(q_local_target, smooth);
            };

            const humanoid = vrm.humanoid;
            const get = (name: VRMHumanBoneName) => humanoid?.getNormalizedBoneNode(name) || undefined;
            const parentOf = (n?: THREE.Object3D | null) => (n ? (n.parent as THREE.Object3D | null) : null);
            const bones = calib.bones;
            const slerpRest = (node?: THREE.Object3D, qLocal0?: THREE.Quaternion, rate = 0.2) => {
              if (!node || !qLocal0) return;
              node.quaternion.slerp(qLocal0, rate);
            };
            if (recalibHoldRef.current > 0) {
              recalibHoldRef.current -= 1;
              slerpRest(bones.lUpperArm?.node, bones.lUpperArm?.qLocal0, 0.35);
              slerpRest(bones.rUpperArm?.node, bones.rUpperArm?.qLocal0, 0.35);
              slerpRest(bones.lLowerArm?.node, bones.lLowerArm?.qLocal0, 0.4);
              slerpRest(bones.rLowerArm?.node, bones.rLowerArm?.qLocal0, 0.4);
              slerpRest(bones.chest?.node, bones.chest?.qLocal0, 0.3);
            } else if (bones.lUpperArm && u3.lShoulder && u3.lElbow) {
              applyBone(
                bones.lUpperArm,
                parentOf(bones.lUpperArm.node),
                new THREE.Vector3(u3.lShoulder.x, u3.lShoulder.y, u3.lShoulder.z),
                new THREE.Vector3(u3.lElbow.x, u3.lElbow.y, u3.lElbow.z),
                0.35,
                { min: 0, max: 2.1 },
              );
            } else {
              slerpRest(bones.lUpperArm?.node, bones.lUpperArm?.qWorld0, 0.2);
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
            } else {
              slerpRest(bones.rUpperArm?.node, bones.rUpperArm?.qWorld0, 0.2);
            }
            if (bones.lLowerArm && u3.lElbow && u3.lWrist) {
              applyBone(
                bones.lLowerArm,
                parentOf(bones.lLowerArm.node),
                new THREE.Vector3(u3.lElbow.x, u3.lElbow.y, u3.lElbow.z),
                new THREE.Vector3(u3.lWrist.x, u3.lWrist.y, u3.lWrist.z),
                0.45,
                { min: 0, max: 2.62 },
              );
            } else {
              slerpRest(bones.lLowerArm?.node, bones.lLowerArm?.qWorld0, 0.25);
            }
            if (bones.rLowerArm && u3.rElbow && u3.rWrist) {
              applyBone(
                bones.rLowerArm,
                parentOf(bones.rLowerArm.node),
                new THREE.Vector3(u3.rElbow.x, u3.rElbow.y, u3.rElbow.z),
                new THREE.Vector3(u3.rWrist.x, u3.rWrist.y, u3.rWrist.z),
                0.45,
                { min: 0, max: 2.62 },
              );
            } else {
              slerpRest(bones.rLowerArm?.node, bones.rLowerArm?.qWorld0, 0.25);
            }

            // Chest: align trunk gently (lock yaw; apply pitch/roll only)
            if (bones.chest) {
              const q_delta = calib.trunkQuatVRM
                .clone()
                .multiply(q_m.clone().invert())
                .multiply(calib.trunkQuatVRM.clone().invert());
              // Extract yaw around world Y and remove it from q_delta
              const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q_delta);
              const yaw = Math.atan2(fwd.x, fwd.z); // world-Y yaw
              const q_yaw = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                yaw,
              );
              let q_noYaw = q_yaw.clone().invert().multiply(q_delta);
              // Optional: invert pitch sign only (development toggle)
              if (invertPitchRef.current) {
                const e = new THREE.Euler().setFromQuaternion(q_noYaw, "XYZ");
                e.x = -e.x; // invert pitch
                const q_adj = new THREE.Quaternion().setFromEuler(e);
                q_noYaw = q_adj;
              }
              const q_world_target = bones.chest.qWorld0.clone().multiply(q_noYaw);
              const q_parent_world = new THREE.Quaternion();
              bones.chest.node.parent?.getWorldQuaternion(q_parent_world);
              const q_local_target = q_parent_world
                .clone()
                .invert()
                .multiply(q_world_target);
              bones.chest.node.quaternion.slerp(q_local_target, 0.25);
            }
          }
        } else {
          // 2D fallback or relax
          const u2 = upper2dRef.current;
          const active2D = u2 && now - last2DAtRef.current < 180;
          const vrm2 = vrmRef.current;
          const calib = calibRef.current;
          const humanoid = vrm2?.humanoid;
          if (active2D && vrm2 && humanoid) {
            const chestNode =
              humanoid.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) ||
              humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest) ||
              humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
            const lUpperArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
            const rUpperArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
            const lLowerArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
            const rLowerArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);
            const slerpToRest = (node?: THREE.Object3D, qLocal0?: THREE.Quaternion, rate = 0.2) => {
              if (!node || !qLocal0) return;
              node.quaternion.slerp(qLocal0, rate);
            };
            const clamp = (x: number, a: number) => (x < -a ? -a : x > a ? a : x);
            const angleBetween = (ax: number, ay: number, bx: number, by: number) => {
              const al = Math.hypot(ax, ay) || 1;
              const bl = Math.hypot(bx, by) || 1;
              const dot = (ax / al) * (bx / bl) + (ay / al) * (by / bl);
              return Math.acos(Math.max(-1, Math.min(1, dot)));
            };
            if (chestNode && u2!.lShoulder && u2!.rShoulder) {
              const dy = u2!.lShoulder.y - u2!.rShoulder.y;
              chestNode.rotation.z = clamp(dy * 1.5, 0.6);
            } else {
              slerpToRest(chestNode, calib?.bones.chest?.qLocal0, 0.2);
            }
            if (lUpperArm && u2!.lShoulder && u2!.lElbow) {
              const dx = u2!.lElbow.x - u2!.lShoulder.x;
              const dy = u2!.lElbow.y - u2!.lShoulder.y;
              lUpperArm.rotation.z = clamp(Math.PI / 2 - Math.atan2(dy, dx), 1.0);
            } else {
              slerpToRest(lUpperArm, calib?.bones.lUpperArm?.qLocal0, 0.2);
            }
            if (rUpperArm && u2!.rShoulder && u2!.rElbow) {
              const dx = u2!.rElbow.x - u2!.rShoulder.x;
              const dy = u2!.rElbow.y - u2!.rShoulder.y;
              rUpperArm.rotation.z = clamp(Math.PI / 2 - Math.atan2(dy, dx), 1.0);
            } else {
              slerpToRest(rUpperArm, calib?.bones.rUpperArm?.qLocal0, 0.2);
            }
            if (lLowerArm && u2!.lShoulder && u2!.lElbow && u2!.lWrist) {
              const ax = u2!.lElbow.x - u2!.lShoulder.x;
              const ay = u2!.lElbow.y - u2!.lShoulder.y;
              const bx = u2!.lWrist.x - u2!.lElbow.x;
              const by = u2!.lWrist.y - u2!.lElbow.y;
              lLowerArm.rotation.x = clamp(-angleBetween(ax, ay, bx, by), 1.2);
            } else {
              slerpToRest(lLowerArm, calib?.bones.lLowerArm?.qLocal0, 0.25);
            }
            if (rLowerArm && u2!.rShoulder && u2!.rElbow && u2!.rWrist) {
              const ax = u2!.rElbow.x - u2!.rShoulder.x;
              const ay = u2!.rElbow.y - u2!.rShoulder.y;
              const bx = u2!.rWrist.x - u2!.rElbow.x;
              const by = u2!.rWrist.y - u2!.rElbow.y;
              rLowerArm.rotation.x = clamp(-angleBetween(ax, ay, bx, by), 1.2);
            } else {
              slerpToRest(rLowerArm, calib?.bones.rLowerArm?.qLocal0, 0.25);
            }
          } else if (calib && vrm2) {
            // Relax towards rest pose when no recent data
            const slerp = (node?: THREE.Object3D, qWorld0?: THREE.Quaternion, rate = 0.15) => {
              if (!node || !qWorld0) return;
              const q_parent_world = new THREE.Quaternion();
              node.parent?.getWorldQuaternion(q_parent_world);
              const q_local_target = q_parent_world.clone().invert().multiply(qWorld0);
              node.quaternion.slerp(q_local_target, rate);
            };
            const b = calib.bones;
            slerp(b.chest?.node, b.chest?.qWorld0, 0.2);
            slerp(b.lUpperArm?.node, b.lUpperArm?.qWorld0, 0.2);
            slerp(b.rUpperArm?.node, b.rUpperArm?.qWorld0, 0.2);
            slerp(b.lLowerArm?.node, b.lLowerArm?.qWorld0, 0.25);
            slerp(b.rLowerArm?.node, b.rLowerArm?.qWorld0, 0.25);
          }
        }
      } catch {}
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

    const onLoadedVRM = (vrm: VRM) => {
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.position.set(0, 0, 0);
      scene.add(vrm.scene);
      vrmRef.current = vrm;
      setStatus("読み込み完了");
      try { applySize(); renderer.render(scene, camera); } catch {}
      try {
        fitCameraToObject(vrm.scene, 1.25);
        renderer.render(scene, camera);
      } catch {}
      // 骨の初期ワールド姿勢とデフォルト方向をキャッシュ（リラックス基準）
      try {
        const humanoid = vrm.humanoid;
        const get = (name: VRMHumanBoneName) => humanoid?.getNormalizedBoneNode(name) || undefined;
        const lShoulderNode = get(VRMHumanBoneName.LeftShoulder);
        const rShoulderNode = get(VRMHumanBoneName.RightShoulder);
        const hips = get(VRMHumanBoneName.Hips);
        if (lShoulderNode && rShoulderNode && hips) {
          const pL = new THREE.Vector3(); const pR = new THREE.Vector3(); const pH = new THREE.Vector3();
          lShoulderNode.getWorldPosition(pL); rShoulderNode.getWorldPosition(pR); hips.getWorldPosition(pH);
          const x = new THREE.Vector3().subVectors(pR, pL).normalize();
          const y = new THREE.Vector3().subVectors(new THREE.Vector3().addVectors(pL, pR).multiplyScalar(0.5), pH).normalize();
          const z = new THREE.Vector3().crossVectors(x, y).normalize();
          y.crossVectors(z, x).normalize();
          const m = new THREE.Matrix4().makeBasis(x, y, z);
          const trunkQuatVRM = new THREE.Quaternion().setFromRotationMatrix(m);

        const neckNode = get(VRMHumanBoneName.Neck);
        const lUpper = get(VRMHumanBoneName.LeftUpperArm);
        const rUpper = get(VRMHumanBoneName.RightUpperArm);
        const lLower = get(VRMHumanBoneName.LeftLowerArm);
        const rLower = get(VRMHumanBoneName.RightLowerArm);
        const lHand = get(VRMHumanBoneName.LeftHand);
        const rHand = get(VRMHumanBoneName.RightHand);
        const chest = get(VRMHumanBoneName.UpperChest) || get(VRMHumanBoneName.Chest) || get(VRMHumanBoneName.Spine);
        const qWorld = (n?: THREE.Object3D) => { const q = new THREE.Quaternion(); n?.getWorldQuaternion(q); return q; };
        const qLocal = (n?: THREE.Object3D) => (n ? n.quaternion.clone() : new THREE.Quaternion());
        const dirOf = (a?: THREE.Object3D, b?: THREE.Object3D) => {
          if (!a || !b) return new THREE.Vector3(0, 1, 0);
          const pa = new THREE.Vector3(); const pb = new THREE.Vector3(); a.getWorldPosition(pa); b.getWorldPosition(pb);
          return new THREE.Vector3().subVectors(pb, pa).normalize();
        };
        const rig = {
          trunkQuatVRM,
          bones: {
            neck: neckNode ? { node: neckNode, qWorld0: qWorld(neckNode), qLocal0: qLocal(neckNode) } : undefined,
            lShoulder: lShoulderNode && lUpper ? { node: lShoulderNode, child: lUpper, qWorld0: qWorld(lShoulderNode), qLocal0: qLocal(lShoulderNode), dirWorld0: dirOf(lShoulderNode, lUpper) } : undefined,
            rShoulder: rShoulderNode && rUpper ? { node: rShoulderNode, child: rUpper, qWorld0: qWorld(rShoulderNode), qLocal0: qLocal(rShoulderNode), dirWorld0: dirOf(rShoulderNode, rUpper) } : undefined,
            lUpperArm: lUpper && lLower ? { node: lUpper, child: lLower, qWorld0: qWorld(lUpper), qLocal0: qLocal(lUpper), dirWorld0: dirOf(lUpper, lLower) } : undefined,
            rUpperArm: rUpper && rLower ? { node: rUpper, child: rLower, qWorld0: qWorld(rUpper), qLocal0: qLocal(rUpper), dirWorld0: dirOf(rUpper, rLower) } : undefined,
            lLowerArm: lLower && lHand ? { node: lLower, child: lHand, qWorld0: qWorld(lLower), qLocal0: qLocal(lLower), dirWorld0: dirOf(lLower, lHand) } : undefined,
            rLowerArm: rLower && rHand ? { node: rLower, child: rHand, qWorld0: qWorld(rLower), qLocal0: qLocal(rLower), dirWorld0: dirOf(rLower, rHand) } : undefined,
            chest: chest ? { node: chest, qWorld0: qWorld(chest), qLocal0: qLocal(chest) } : undefined,
          },
        };
        restRef.current = {
          trunkQuatVRM: rig.trunkQuatVRM.clone(),
          bones: {
            neck: rig.bones.neck ? { node: rig.bones.neck.node, qWorld0: rig.bones.neck.qWorld0.clone(), qLocal0: rig.bones.neck.qLocal0.clone() } : undefined,
            lShoulder: rig.bones.lShoulder ? { node: rig.bones.lShoulder.node, child: rig.bones.lShoulder.child, qWorld0: rig.bones.lShoulder.qWorld0.clone(), qLocal0: rig.bones.lShoulder.qLocal0.clone(), dirWorld0: rig.bones.lShoulder.dirWorld0.clone() } : undefined,
            rShoulder: rig.bones.rShoulder ? { node: rig.bones.rShoulder.node, child: rig.bones.rShoulder.child, qWorld0: rig.bones.rShoulder.qWorld0.clone(), qLocal0: rig.bones.rShoulder.qLocal0.clone(), dirWorld0: rig.bones.rShoulder.dirWorld0.clone() } : undefined,
            lUpperArm: rig.bones.lUpperArm ? { node: rig.bones.lUpperArm.node, child: rig.bones.lUpperArm.child, qWorld0: rig.bones.lUpperArm.qWorld0.clone(), qLocal0: rig.bones.lUpperArm.qLocal0.clone(), dirWorld0: rig.bones.lUpperArm.dirWorld0.clone() } : undefined,
            rUpperArm: rig.bones.rUpperArm ? { node: rig.bones.rUpperArm.node, child: rig.bones.rUpperArm.child, qWorld0: rig.bones.rUpperArm.qWorld0.clone(), qLocal0: rig.bones.rUpperArm.qLocal0.clone(), dirWorld0: rig.bones.rUpperArm.dirWorld0.clone() } : undefined,
            lLowerArm: rig.bones.lLowerArm ? { node: rig.bones.lLowerArm.node, child: rig.bones.lLowerArm.child, qWorld0: rig.bones.lLowerArm.qWorld0.clone(), qLocal0: rig.bones.lLowerArm.qLocal0.clone(), dirWorld0: rig.bones.lLowerArm.dirWorld0.clone() } : undefined,
            rLowerArm: rig.bones.rLowerArm ? { node: rig.bones.rLowerArm.node, child: rig.bones.rLowerArm.child, qWorld0: rig.bones.rLowerArm.qWorld0.clone(), qLocal0: rig.bones.rLowerArm.qLocal0.clone(), dirWorld0: rig.bones.rLowerArm.dirWorld0.clone() } : undefined,
            chest: rig.bones.chest ? { node: rig.bones.chest.node, qWorld0: rig.bones.chest.qWorld0.clone(), qLocal0: rig.bones.chest.qLocal0.clone() } : undefined,
          },
        };
        // 初期キャリブレーションはrestのクローンを使用
        calibRef.current = {
          trunkQuatVRM: restRef.current!.trunkQuatVRM.clone(),
          bones: {
            neck: restRef.current!.bones.neck ? { node: restRef.current!.bones.neck.node, qWorld0: restRef.current!.bones.neck.qWorld0.clone(), qLocal0: restRef.current!.bones.neck.qLocal0.clone() } : undefined,
            lShoulder: restRef.current!.bones.lShoulder ? { node: restRef.current!.bones.lShoulder.node, child: restRef.current!.bones.lShoulder.child, qWorld0: restRef.current!.bones.lShoulder.qWorld0.clone(), qLocal0: restRef.current!.bones.lShoulder.qLocal0.clone(), dirWorld0: restRef.current!.bones.lShoulder.dirWorld0.clone() } : undefined,
            rShoulder: restRef.current!.bones.rShoulder ? { node: restRef.current!.bones.rShoulder.node, child: restRef.current!.bones.rShoulder.child, qWorld0: restRef.current!.bones.rShoulder.qWorld0.clone(), qLocal0: restRef.current!.bones.rShoulder.qLocal0.clone(), dirWorld0: restRef.current!.bones.rShoulder.dirWorld0.clone() } : undefined,
            lUpperArm: restRef.current!.bones.lUpperArm ? { node: restRef.current!.bones.lUpperArm.node, child: restRef.current!.bones.lUpperArm.child, qWorld0: restRef.current!.bones.lUpperArm.qWorld0.clone(), qLocal0: restRef.current!.bones.lUpperArm.qLocal0.clone(), dirWorld0: restRef.current!.bones.lUpperArm.dirWorld0.clone() } : undefined,
            rUpperArm: restRef.current!.bones.rUpperArm ? { node: restRef.current!.bones.rUpperArm.node, child: restRef.current!.bones.rUpperArm.child, qWorld0: restRef.current!.bones.rUpperArm.qWorld0.clone(), qLocal0: restRef.current!.bones.rUpperArm.qLocal0.clone(), dirWorld0: restRef.current!.bones.rUpperArm.dirWorld0.clone() } : undefined,
            lLowerArm: restRef.current!.bones.lLowerArm ? { node: restRef.current!.bones.lLowerArm.node, child: restRef.current!.bones.lLowerArm.child, qWorld0: restRef.current!.bones.lLowerArm.qWorld0.clone(), qLocal0: restRef.current!.bones.lLowerArm.qLocal0.clone(), dirWorld0: restRef.current!.bones.lLowerArm.dirWorld0.clone() } : undefined,
            rLowerArm: restRef.current!.bones.rLowerArm ? { node: restRef.current!.bones.rLowerArm.node, child: restRef.current!.bones.rLowerArm.child, qWorld0: restRef.current!.bones.rLowerArm.qWorld0.clone(), qLocal0: restRef.current!.bones.rLowerArm.qLocal0.clone(), dirWorld0: restRef.current!.bones.rLowerArm.dirWorld0.clone() } : undefined,
            chest: restRef.current!.bones.chest ? { node: restRef.current!.bones.chest.node, qWorld0: restRef.current!.bones.chest.qWorld0.clone(), qLocal0: restRef.current!.bones.chest.qLocal0.clone() } : undefined,
          },
        };
        }
      } catch {}
    };

    const loadFromURL = async (url: string) => {
      setStatus("読み込み中...");
      try {
        disposeCurrent();
        const gltf = await loader.loadAsync(url);
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          setStatus("VRMではありません（0.x想定）");
          try { URL.revokeObjectURL(url); } catch {}
          return;
        }
        onLoadedVRM(vrm);
      } catch (e) {
        setStatus(e instanceof Error ? `読み込み失敗: ${e.message}` : "読み込み失敗");
      } finally {
        try { URL.revokeObjectURL(url); } catch {}
      }
    };

    const loadFromBuffer = async (buffer: ArrayBuffer) => {
      setStatus("読み込み中...");
      try {
        disposeCurrent();
        const gltf = await loader.parseAsync(buffer, "");
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          setStatus("VRMではありません（0.x想定）");
          return;
        }
        onLoadedVRM(vrm);
      } catch (e) {
        setStatus(e instanceof Error ? `読み込み失敗: ${e.message}` : "読み込み失敗");
      }
    };

    const onSelect = (ev: Event) => {
      const ce = ev as CustomEvent<{ url?: string; buffer?: ArrayBuffer }>;
      const d = ce.detail || {};
      if (d.buffer instanceof ArrayBuffer) { void loadFromBuffer(d.buffer); return; }
      if (typeof d.url === "string" && d.url) { void loadFromURL(d.url); }
    };
    const onReset = () => { disposeCurrent(); calibRef.current = null; setStatus("未読み込み"); };

    const onPose = (ev: Event) => {
      const ce = ev as CustomEvent<{
        yaw?: number;
        pitch?: number;
        roll?: number;
        blink?: number;
        mouth?: number;
      }>;
      const p = ce.detail;
      if (!p) return;
      // キャリブ中は首・頭はRESTへ近づけて安定化させる
      if (recalibHoldRef.current > 0) return;
      const vrm = vrmRef.current;
      if (!vrm) return;
      const humanoid = vrm.humanoid;
      const head = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
      const neck = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck);
      // 上半身追従が有効な間は、首はRESTへ寄せて折れを防ぎ、頭のみ回す
      const now = performance.now();
      const upperActive = (upper3dRef.current && now - last3DAtRef.current < 180) ||
        (upper2dRef.current && now - last2DAtRef.current < 180);
      if (upperActive) {
        if (neck && calibRef.current?.bones.neck?.qLocal0) {
          neck.quaternion.slerp(calibRef.current.bones.neck.qLocal0, 0.35);
        }
        if (head) head.rotation.set((p.pitch ?? 0) * 0.6, (p.yaw ?? 0) * 0.6, (p.roll ?? 0) * 0.6);
      } else {
        if (head) head.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
        if (neck) neck.rotation.set((p.pitch ?? 0) * 0.4, (p.yaw ?? 0) * 0.4, (p.roll ?? 0) * 0.4);
      }
      const em = vrm.expressionManager;
      if (em) {
        const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
        if (typeof p.blink === "number") em.setValue(VRMExpressionPresetName.Blink, clamp01(p.blink));
        if (typeof p.mouth === "number") em.setValue(VRMExpressionPresetName.Aa, clamp01(p.mouth));
        try {
          window.dispatchEvent(
            new CustomEvent("motioncast:vrm-expression", {
              detail: { blink: p.blink, mouth: p.mouth, ts: performance.now() },
            })
          );
        } catch {}
      }
    };

    // 2D上半身の簡易リターゲット（肩/腕/肘/手首）
    type P2 = { x: number; y: number };
    type Upper2D = {
      lShoulder?: P2; rShoulder?: P2;
      lElbow?: P2; rElbow?: P2;
      lWrist?: P2; rWrist?: P2;
    };
    const onUpper2D = (ev: Event) => {
      const ce = ev as CustomEvent<Upper2D>;
      if (!ce.detail) return;
      upper2dRef.current = ce.detail;
      last2DAtRef.current = performance.now();
    };

    window.addEventListener("motioncast:vrm-select", onSelect as EventListener);
    window.addEventListener("motioncast:vrm-reset", onReset);
    document.addEventListener("motioncast:vrm-select", onSelect as EventListener);
    document.addEventListener("motioncast:vrm-reset", onReset as EventListener);
    window.addEventListener("motioncast:pose-update", onPose as EventListener);
    window.addEventListener("motioncast:upper-body-update", onUpper2D as EventListener);
    // 上半身3D（優先）
    const onUpper3D = (ev: Event) => {
      const ce = ev as CustomEvent<Upper3D>;
      if (!ce.detail) return;
      upper3dRef.current = ce.detail;
      last3DAtRef.current = performance.now();
    };
    window.addEventListener("motioncast:upper-body-3d", onUpper3D as EventListener);

    // Fallback: saved fileName -> /vrm/<name>
    try {
      const saved = localStorage.getItem("vrm.fileName");
      if (saved && saved !== "未読み込み" && !vrmRef.current) {
        void loadFromURL(`/vrm/${encodeURIComponent(saved)}`);
      }
    } catch {}

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      window.removeEventListener("motioncast:vrm-select", onSelect as EventListener);
      window.removeEventListener("motioncast:vrm-reset", onReset);
      document.removeEventListener("motioncast:vrm-select", onSelect as EventListener);
      document.removeEventListener("motioncast:vrm-reset", onReset as EventListener);
      window.removeEventListener("motioncast:pose-update", onPose as EventListener);
      window.removeEventListener("motioncast:upper-body-update", onUpper2D as EventListener);
      window.removeEventListener("motioncast:upper-body-3d", onUpper3D as EventListener);
      try {
        const dom = renderer.domElement;
        if ((dom as unknown as { isConnected?: boolean }).isConnected) dom.remove();
        else if (dom.parentElement === el) el.removeChild(dom);
      } catch {}
      try {
        if (cubeRef.current) {
          try { scene.remove(cubeRef.current); } catch {}
          try { cubeRef.current.geometry.dispose(); } catch {}
          try { (cubeRef.current.material as unknown as THREE.Material)?.dispose?.(); } catch {}
          cubeRef.current = null;
        }
      } catch {}
      try { VRMUtils.deepDispose(vrmRef.current?.scene as any); } catch {}
      try { renderer.dispose(); } catch {}
    };
  }, [pixelRatioCap]);

  // Toggle cube on state change without reinitializing scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (showCube && !cubeRef.current) {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x64748b }),
      );
      cube.position.y = 1.0;
      scene.add(cube);
      cubeRef.current = cube;
    } else if (!showCube && cubeRef.current) {
      const cube = cubeRef.current;
      try { scene.remove(cube); } catch {}
      try { cube.geometry.dispose(); } catch {}
      try { (cube.material as unknown as THREE.Material)?.dispose?.(); } catch {}
      cubeRef.current = null;
    }
  }, [showCube]);

  return (
    <div className="viewer-root">
      <div className="viewer-canvas-wrap">
        <div ref={containerRef} className="viewer-canvas" aria-label="VRMビューア" />
        <div className="viewer-status" aria-live="polite">{status}</div>
      </div>
      <div className="viewer-controls-bar">
        <button
          className="btn"
          aria-pressed={running}
          onClick={() => {
            const next = !running;
            setRunning(next);
            try { localStorage.setItem("viewer.running", String(next)); } catch {}
          }}
        >
          {running ? "描画停止" : "描画再開"}
        </button>
        <button
          className="btn"
          onClick={() => {
            const next = !showCube;
            setShowCube(next);
            try { localStorage.setItem("viewer.showCube", String(next)); } catch {}
          }}
        >
          {showCube ? "テストキューブを消す" : "テストキューブを生成"}
        </button>
        <button className="btn" onClick={() => { calibRef.current = null; recalibHoldRef.current = 8; }}>
          再キャリブレーション
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={invertChestPitch}
            onChange={(e) => {
              const v = e.target.checked;
              setInvertChestPitch(v);
              try { localStorage.setItem("viewer.invertChestPitch", String(v)); } catch {}
            }}
          />
          胸ピッチを反転
        </label>
        <label>
          <span className="sr-only">PixelRatio上限</span>
          <select
            value={String(pixelRatioCap)}
            onChange={(e) => {
              const v = Number(e.target.value) || 1;
              setPixelRatioCap(v);
              try { localStorage.setItem("viewer.pixelRatioCap", String(v)); } catch {}
            }}
          >
            <option value="1">PR 1.0</option>
            <option value="1.5">PR 1.5</option>
            <option value="2">PR 2.0</option>
          </select>
        </label>
      </div>
    </div>
  );
}

export default VrmViewer;
