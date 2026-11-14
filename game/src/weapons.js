// weapons.js — weapon definitions, recoil/spread, hitscan fire, grenades.
// One job: everything about shooting. Hit tests live here; damage routing lives in main.
import * as THREE from 'three';
import { World } from './world.js';

export const WEAPONS = {
  rifle: {
    name: 'RIFLE', auto: true, magSize: 30, reserveStart: 90, damage: 34,
    headMul: 2.0, legMul: 0.8, fireInterval: 0.115, reloadTime: 2.1,
    spreadBase: 0.006, spreadMove: 0.02, spreadBloom: 0.004, spreadMax: 0.055,
    recoil: 0.011, kick: 0.35, range: 120, tracer: 0xffc65c,
  },
  pistol: {
    name: 'PISTOL', auto: false, magSize: 12, reserveStart: 48, damage: 26,
    headMul: 2.0, legMul: 0.8, fireInterval: 0.22, reloadTime: 1.4,
    spreadBase: 0.008, spreadMove: 0.016, spreadBloom: 0.006, spreadMax: 0.05,
    recoil: 0.014, kick: 0.5, range: 80, tracer: 0xffe9a8,
  },
};

export class WeaponState {
  constructor() {
    this.kind = 'pistol';
    this.mag = WEAPONS.pistol.magSize;
    this.reserve = { rifle: 0, pistol: WEAPONS.pistol.reserveStart };
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShotAt = 0;
    this.bloom = 0;          // grows while firing, decays when still
    this.recoilPitch = 0;    // visual kick, recovered over time
    this.grenades = 1;
    this.hasRifle = false;
  }

  get def() { return WEAPONS[this.kind]; }

  switchTo(kind, now) {
    if (kind === 'rifle' && !this.hasRifle) return false;
    if (kind !== 'rifle' && kind !== 'pistol') return false;
    this.kind = kind;
    this.mag = this.kind === 'rifle' ? this._rifleMag : this._pistolMag;
    this.reloading = false;
    this.bloom = 0;
    return true;
  }

  // Magazines are remembered per weapon.
  get _rifleMag() { return this.__rm ?? WEAPONS.rifle.magSize; }
  set _rifleMag(v) { this.__rm = v; }
  get _pistolMag() { return this.__pm ?? WEAPONS.pistol.magSize; }
  set _pistolMag(v) { this.__pm = v; }

  stashMag() { if (this.kind === 'rifle') this._rifleMag = this.mag; else this._pistolMag = this.mag; }

  startReload(now) {
    const def = this.def;
    if (this.reloading || this.mag >= def.magSize || this.reserve[this.kind] <= 0) return false;
    this.reloading = true;
    this.reloadEnd = now + def.reloadTime;
    return true;
  }

  finishReload() {
    const def = this.def;
    const need = def.magSize - this.mag;
    const take = Math.min(need, this.reserve[this.kind]);
    this.mag += take;
    this.reserve[this.kind] -= take;
    this.reloading = false;
  }

  addAmmo(kind, amount) { this.reserve[kind] = (this.reserve[kind] || 0) + amount; }

  // Current spread in radians: base + movement + bloom; crouched/still shrinks it.
  spread(moving, crouched, speedFrac) {
    const def = this.def;
    let s = def.spreadBase + this.bloom;
    if (moving) s += def.spreadMove * (0.5 + speedFrac);
    if (crouched) s *= 0.6;
    return Math.min(s, def.spreadMax);
  }

  canFire(now) {
    return !this.reloading && this.mag > 0 && now >= this.nextShotAt;
  }
}

// A hitscan shot: origin + direction, returns the nearest hit.
// targets: [{ pos: {x,y,z}, radius, headY, bodyTop, bodyBottom, ref }] — bot hitboxes.
// Returns { kind: 'bot'|'wall'|'none', t, target, part } where part is 'head'|'body'|'legs'.
export function hitscan(world, ox, oy, oz, dx, dy, dz, targets, maxDist) {
  let bestT = world.rayWalls(ox, oy, oz, dx, dy, dz, maxDist);
  let best = { kind: bestT < maxDist ? 'wall' : 'none', t: bestT, target: null, part: null };
  for (let i = 0; i < targets.length; i++) {
    const tg = targets[i];
    if (!tg.alive) continue;
    // Body: vertical cylinder approximated by a sphere stack — test two spheres.
    const hit = sphereStackHit(ox, oy, oz, dx, dy, dz, tg);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      best = { kind: 'bot', t: hit.t, target: tg, part: hit.part };
    }
  }
  return best;
}

// Bot hitbox: head sphere at headY, body sphere at mid, legs sphere low.
function sphereStackHit(ox, oy, oz, dx, dy, dz, tg) {
  const p = tg.pos;
  const tests = [
    { y: p.y + tg.headY, r: tg.headR, part: 'head' },
    { y: p.y + tg.bodyY, r: tg.bodyR, part: 'body' },
    { y: p.y + tg.legY, r: tg.legR, part: 'legs' },
  ];
  let best = null;
  for (let i = 0; i < tests.length; i++) {
    const s = tests[i];
    const cx = p.x - ox, cy = s.y - oy, cz = p.z - oz;
    const tca = cx * dx + cy * dy + cz * dz;
    if (tca < 0) continue;
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    if (d2 > s.r * s.r) continue;
    const t = tca - Math.sqrt(s.r * s.r - d2);
    if (t >= 0 && (!best || t < best.t)) best = { t, part: s.part };
  }
  return best;
}

// Grenade projectile: simple ballistic arc, fuse, radius damage.
export class Grenade {
  constructor(scene, pos, vel) {
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.fuse = 2.0;
    this.alive = true;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x2e4d2e, roughness: 0.6, metalness: 0.4 }));
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
    this._scene = scene;
  }

  step(dt, world) {
    if (!this.alive) return;
    this.vel.y -= 14 * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < 0.14) { this.pos.y = 0.14; this.vel.y *= -0.4; this.vel.x *= 0.6; this.vel.z *= 0.6; }
    // Bounce off walls by clamping inside the yard.
    if (this.pos.x < -27 || this.pos.x > 27) this.vel.x *= -0.5;
    if (this.pos.z < -23 || this.pos.z > 25) this.vel.z *= -0.5;
    this.pos.x = Math.max(-27, Math.min(27, this.pos.x));
    this.pos.z = Math.max(-23, Math.min(25, this.pos.z));
    this.mesh.position.copy(this.pos);
    this.fuse -= dt;
  }

  explode(scene) {
    this.alive = false;
    scene.remove(this.mesh);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc65c, transparent: true, opacity: 0.9 }));
    flash.position.copy(this.pos);
    scene.add(flash);
    return { pos: this.pos.clone(), flash, radius: 7, damage: 95 };
  }
}
