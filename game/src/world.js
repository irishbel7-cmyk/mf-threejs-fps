// world.js — Sandline Yard map: geometry, materials, AABB colliders, raycasts.
// One job: the static world. Everything here is original geometry built from boxes.
import * as THREE from 'three';

// Palette: warm sand + teal accent, rusted metal, sun-baked concrete.
export const PALETTE = {
  sand: 0xc9a86a, sandDark: 0xa8894f, concrete: 0x8d8578, concreteDark: 0x6b655a,
  teal: 0x2e7f7a, tealDark: 0x1f5a56, rust: 0x9a5a33, rustDark: 0x6e3f22,
  crate: 0xb98d4f, crateDark: 0x8a6a38, barrel: 0x3f6d6a, ground: 0xb59a68,
  wall: 0xc2a878, accent: 0xe8a33d,
};

// An AABB collider: { minX, maxX, minZ, maxZ, minY, maxY }.
export function makeBox(x, z, w, d, h, y0 = 0) {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y0, maxY: y0 + h };
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.sites = {
      A: { x: 20, z: -16, r: 5.5, name: 'A' },
      B: { x: -20, z: -16, r: 5.5, name: 'B' },
    };
    this.spawnAtk = { x: 0, z: 20 };
    this.spawnDef = [
      { x: 18, z: -10 }, { x: -18, z: -10 }, { x: 0, z: -14 }, { x: 8, z: -4 },
    ];
    // Defender patrol waypoints (lanes: A-long, B-tunnel, mid connector).
    this.patrols = [
      [{ x: 18, z: -10 }, { x: 12, z: 2 }, { x: 20, z: -16 }],
      [{ x: -18, z: -10 }, { x: -12, z: 2 }, { x: -20, z: -16 }],
      [{ x: 0, z: -14 }, { x: 0, z: 0 }, { x: 6, z: -8 }],
      [{ x: 8, z: -4 }, { x: 14, z: 6 }, { x: -6, z: -6 }],
    ];
    this._build();
  }

  _mat(color, rough = 0.9) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  }

  _addBox(x, y, z, w, h, d, mat, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    if (collide) this.colliders.push(makeBox(x, z, w, d, h, y));
    return m;
  }

  _addCrate(x, z, s, mat) {
    const m = this._addBox(x, 0, z, s, s, s, mat);
    // Lid stripe so crates read at a glance.
    const lid = new THREE.Mesh(new THREE.BoxGeometry(s + 0.06, 0.08, s + 0.06), this._mat(PALETTE.crateDark));
    lid.position.set(x, s + 0.04, z); lid.castShadow = true;
    this.scene.add(lid);
    return m;
  }

  _addBarrel(x, z, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), mat);
    m.position.set(x, 0.65, z); m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    this.colliders.push(makeBox(x, z, 1.0, 1.0, 1.3));
    return m;
  }

  _build() {
    const s = this.scene;
    // Sky, fog, sun.
    s.background = new THREE.Color(0xcfb98a);
    s.fog = new THREE.Fog(0xcfb98a, 38, 95);
    const sun = new THREE.DirectionalLight(0xffe6b0, 2.4);
    sun.position.set(28, 42, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
    sun.shadow.camera.far = 120;
    s.add(sun);
    s.add(new THREE.HemisphereLight(0xffe9c0, 0x8a6a45, 0.9));
    const fill = new THREE.DirectionalLight(0x7ec8c0, 0.35);
    fill.position.set(-20, 18, 30); s.add(fill);

    // Ground: big sand slab with a darker mid strip.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), this._mat(PALETTE.ground, 1));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
    const midStrip = new THREE.Mesh(new THREE.PlaneGeometry(6, 52), this._mat(0x9c8459, 1));
    midStrip.rotation.x = -Math.PI / 2; midStrip.position.set(0, 0.01, 0); midStrip.receiveShadow = true; s.add(midStrip);

    const wallMat = this._mat(PALETTE.wall);
    const concMat = this._mat(PALETTE.concrete);
    const concDark = this._mat(PALETTE.concreteDark);
    const tealMat = this._mat(PALETTE.teal);
    const rustMat = this._mat(PALETTE.rust);
    const crateMat = this._mat(PALETTE.crate);
    const barrelMat = this._mat(PALETTE.barrel);

    // Outer boundary walls (map is 56 wide x 52 deep, z from -24 to +26).
    this._addBox(0, 0, -25, 58, 5, 2, wallMat);
    this._addBox(0, 0, 27, 58, 5, 2, wallMat);
    this._addBox(-29, 0, 1, 2, 5, 54, wallMat);
    this._addBox(29, 0, 1, 2, 5, 54, wallMat);

    // Site A (east): raised concrete pad, teal container, crates — A-long sightline.
    this._addBox(20, 0.05, -16, 12, 0.35, 12, concDark, false);
    this._addBox(24, 0, -20, 6, 2.6, 2.4, tealMat);
    this._addBox(15, 0, -21, 3, 2.2, 2.2, rustMat);
    this._addCrate(17, -12, 1.4, crateMat);
    this._addCrate(23, -11, 1.2, crateMat);
    this._addBarrel(14, -17, barrelMat);
    this._addBarrel(25.5, -13, barrelMat);

    // Site B (west): B-tunnel — two close walls making a tight corner, sandbags.
    this._addBox(-20, 0.05, -16, 12, 0.35, 12, concDark, false);
    this._addBox(-24, 0, -20, 6, 2.6, 2.4, rustMat);
    this._addBox(-16, 0, -12, 1.2, 2.4, 6, concMat); // tunnel wall 1
    this._addBox(-22, 0, -8, 1.2, 2.4, 6, concMat);  // tunnel wall 2
    this._addCrate(-17, -19, 1.4, crateMat);
    this._addCrate(-23, -12, 1.2, crateMat);
    this._addBarrel(-14, -16, barrelMat);

    // Mid lane: connector with a central watchtower block and cover.
    this._addBox(0, 0, 2, 4, 3.2, 4, concMat);          // mid block
    this._addBox(0, 3.2, 2, 4.6, 0.3, 4.6, tealMat, false); // roof lip
    this._addCrate(4.5, -3, 1.3, crateMat);
    this._addCrate(-4.5, 7, 1.3, crateMat);
    this._addBarrel(3.5, 8, barrelMat);
    this._addBarrel(-3.5, -4, barrelMat);

    // A-long: open lane east side, low cover boxes for the long angle.
    this._addCrate(14, 8, 1.5, crateMat);
    this._addCrate(18, 14, 1.2, crateMat);
    this._addBarrel(22, 6, barrelMat);
    this._addBox(10, 0, 12, 5, 1.1, 1.2, concDark); // low wall, shoot over it

    // B side cover + attacker spawn cover.
    this._addCrate(-14, 8, 1.5, crateMat);
    this._addCrate(-18, 14, 1.2, crateMat);
    this._addBarrel(-22, 6, barrelMat);
    this._addBox(-10, 0, 12, 5, 1.1, 1.2, concDark);
    this._addCrate(-4, 20, 1.4, crateMat);
    this._addCrate(5, 21, 1.2, crateMat);

    // Site markers: glowing rings + floating letters so sites read at a glance.
    for (const key of ['A', 'B']) {
      const site = this.sites[key];
      const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.5, site.r, 40),
        new THREE.MeshBasicMaterial({ color: PALETTE.accent, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(site.x, 0.45, site.z);
      s.add(ring);
      site.ring = ring;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), this._mat(PALETTE.tealDark));
      post.position.set(site.x, 1.7, site.z - site.r + 0.4); s.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd27a }));
      lamp.position.set(site.x, 3.6, site.z - site.r + 0.4); s.add(lamp);
      const light = new THREE.PointLight(0xffd27a, 12, 14, 1.8);
      light.position.copy(lamp.position); s.add(light);
    }

    // Decorative: distant dunes (non-colliding silhouettes) + a few pipes.
    for (let i = 0; i < 7; i++) {
      const dune = new THREE.Mesh(new THREE.SphereGeometry(14 + i * 2, 12, 8),
        this._mat(i % 2 ? 0xb59a68 : 0xa8894f, 1));
      const a = (i / 7) * Math.PI * 2;
      dune.position.set(Math.cos(a) * 62, -3.5, Math.sin(a) * 62);
      dune.scale.y = 0.28; s.add(dune);
    }
    this._addBox(-28, 2.6, 10, 1, 1, 20, rustMat, false);
    this._addBox(28, 2.6, -6, 1, 1, 18, rustMat, false);
  }

  // Resolve a moving AABB (half extents hx, hz, height h) against colliders.
  // pos is the feet position; returns corrected pos in place (mutates the object).
  collide(pos, hx, hz, height) {
    const c = this.colliders;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < c.length; i++) {
        const b = c[i];
        if (pos.y + height <= b.minY || pos.y >= b.maxY) continue;
        const ox = Math.min(pos.x + hx, b.maxX) - Math.max(pos.x - hx, b.minX);
        const oz = Math.min(pos.z + hz, b.maxZ) - Math.max(pos.z - hz, b.minZ);
        if (ox <= 0 || oz <= 0) continue;
        if (ox < oz) pos.x += (pos.x < (b.minX + b.maxX) / 2) ? -ox : ox;
        else pos.z += (pos.z < (b.minZ + b.maxZ) / 2) ? -oz : oz;
      }
    }
    // Clamp inside the yard.
    pos.x = Math.max(-27.4, Math.min(27.4, pos.x));
    pos.z = Math.max(-23.4, Math.min(25.4, pos.z));
  }

  // Ray vs AABB slab test. Returns distance t or Infinity.
  static rayBox(ox, oy, oz, dx, dy, dz, b) {
    let tmin = 0, tmax = 1e9;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return Infinity; }
      else {
        let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return Infinity;
      }
    }
    return tmin;
  }

  // Nearest wall distance along a ray (for bullets and line of sight).
  rayWalls(ox, oy, oz, dx, dy, dz, maxDist = 120) {
    let best = maxDist;
    for (let i = 0; i < this.colliders.length; i++) {
      const t = World.rayBox(ox, oy, oz, dx, dy, dz, this.colliders[i]);
      if (t < best) best = t;
    }
    return best;
  }

  hasLineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001) return true;
    return this.rayWalls(ax, ay, az, dx / len, dy / len, dz / len, len - 0.2) >= len - 0.2;
  }

  siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const s = this.sites[key];
      if (Math.hypot(x - s.x, z - s.z) <= s.r) return key;
    }
    return null;
  }
}
