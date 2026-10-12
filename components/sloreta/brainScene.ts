import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeProceduralBrain } from './proceduralBrain';

export type BrainView = 'left' | 'right' | 'top' | 'front';

export type BrainScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh;
  setView: (v: BrainView) => void;
  renderOnce: () => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

// Camera presets for the anatomical orientations. `up` is the world axis that
// points to the top of the screen — needed for the top-down view, where the
// default +Y up vector would be parallel to the view direction. In this mesh's
// space: +X is the subject's left hemisphere (seen on screen-right from the
// front), +Y is superior (up), +Z is anterior (front). So the "Left" view sits
// on +X and "Right" on -X.
const VIEW_DIRS: Record<BrainView, { pos: [number, number, number]; up: [number, number, number] }> = {
  left: { pos: [2.8, 0.3, 0], up: [0, 1, 0] },
  right: { pos: [-2.8, 0.3, 0], up: [0, 1, 0] },
  top: { pos: [0, 2.9, 0], up: [0, 0, 1] }, // anterior toward top of screen
  front: { pos: [0, 0.3, 2.9], up: [0, 1, 0] },
};

export async function createBrainScene(
  container: HTMLDivElement,
  modelUrl?: string
): Promise<BrainScene> {
  const w = container.clientWidth || 480;
  const h = container.clientHeight || 420;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // lets the canvas be captured as an image
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
  camera.position.set(0, 0.3, 2.9);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 2);
  scene.add(dir);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.8;
  controls.maxDistance = 5;

  let geometry: THREE.BufferGeometry | null = null;
  if (modelUrl) {
    try {
      const gltf = await new GLTFLoader().loadAsync(modelUrl);
      let found: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!found && m.isMesh) found = m;
      });
      if (found) {
        geometry = (found as THREE.Mesh).geometry as THREE.BufferGeometry;
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingSphere();
        const r = geometry.boundingSphere?.radius || 1;
        geometry.scale(1 / r, 1 / r, 1 / r);
      }
    } catch {
      geometry = null; // fall back to procedural
    }
  }
  if (!geometry) geometry = makeProceduralBrain();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    // double-sided so rendering is independent of the imported mesh's face winding
    // (fsaverage pial faces can wind inconsistently)
    side: THREE.DoubleSide,
  });
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3).fill(0.82);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const renderOnce = () => renderer.render(scene, camera);

  // Only spin a RAF loop while the user is actively dragging (damping).
  let raf = 0;
  const loop = () => {
    controls.update();
    renderOnce();
    raf = requestAnimationFrame(loop);
  };
  controls.addEventListener('start', () => {
    if (!raf) loop();
  });
  controls.addEventListener('end', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    renderOnce();
  });

  const setView = (v: BrainView) => {
    const { pos, up } = VIEW_DIRS[v];
    camera.up.set(up[0], up[1], up[2]);
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(0, 0, 0);
    controls.update();
    renderOnce();
  };

  const resize = (nw: number, nh: number) => {
    renderer.setSize(nw, nh);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderOnce();
  };

  const dispose = () => {
    if (raf) cancelAnimationFrame(raf);
    controls.dispose();
    geometry?.dispose();
    material.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  };

  setView('front');
  renderOnce();
  return { renderer, scene, camera, controls, mesh, setView, renderOnce, resize, dispose };
}
