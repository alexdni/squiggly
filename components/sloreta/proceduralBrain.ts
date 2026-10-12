import * as THREE from 'three';

// Brain-proportioned ellipsoid with gentle sulcal displacement, so the fallback
// reads as a brain rather than a plain sphere. Deterministic (trig "noise", no
// Math.random). Orientation: up = +Y, front = +Z, right = +X.
export function makeProceduralBrain(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 96, 64);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // ellipsoid scaling: longer front-back (z), narrower height (y), medium width (x)
    let x = v.x * 0.62;
    let y = v.y * 0.55;
    let z = v.z * 0.78;
    // sulcal ripples
    const n =
      0.035 * Math.sin(9 * v.x + 2) * Math.cos(8 * v.z) +
      0.025 * Math.sin(11 * v.z + 1) * Math.cos(10 * v.y) +
      0.02 * Math.sin(13 * v.y) * Math.cos(12 * v.x);
    const len = Math.hypot(x, y, z) || 1;
    x += (x / len) * n;
    y += (y / len) * n;
    z += (z / len) * n;
    // shallow midline (sagittal) groove on the top
    const groove = Math.exp(-(x * x) / 0.004) * Math.max(0, y) * 0.05;
    y -= groove;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
