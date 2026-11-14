// bots.js — bot defenders + one attacker teammate.
// One job: bot brains and bodies. State machine: hold / patrol / investigate /
// engage / retreat / defuse. Bots share the player's collision and hitboxes.
import * as THREE from 'three';

const BOT_SPEED = 3.6;
const EYE_Y = 1.5;

function botMaterials(team) {
  const body = team === 'def' ? 0x2e6f6a : 0x8a6a38;
  const helm = team === 'def' ? 0x1f5a56 : 0xc9a86a;
  return {
    body: new THREE.MeshStandardMaterial({ color: body, roughness: 0.85 }),
    helm: new THREE.MeshStandardMaterial({ color: helm, roughness: 0.6 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc98e6a, roughness: 0.9 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.5, metalness: 0.5 }),
  };
}

export class Bot {
  constructor(scene, world, team, name, x, z, waypoints) {
    this.scene = scene; this.world = world;
    this.team = team; this.name = name;
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.health = 100;
    this.alive = true;
    this.state = team === 'def' ? 'hold' : 'follow';
    this.waypoints = waypoints || [];
    this.wpIndex = 0;
    this.holdPos = { x, z };
    this.scanT = 0;
    this.stateT = 0;
    this.shootAt = 0;
    this.burstLeft = 0;
    this.target = null;       // Bot | 'player'
    this.investigatePos = null;
    this.defuseT = 0;
    this.lastSeen = null;     // {x, z} last known enemy position
    this.speed = BOT_SPEED * (0.9 + Math.random() * 0.2);
    this.accuracy = 0.22 + Math.random() * 0.06;
    this.aimDelay = 0;
    this.vel = new THREE.Vector3();
    this.moving = false;
    this.strafeDir = 1;
    this.strafeT = 0;

    const mats = botMaterials(team);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.05, 10), mats.body);
    body.position.y = 0.95; body.castShadow = true; g.add(body);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.36), mats.body);
    chest.position.y = 1.25; chest.castShadow = true; g.add(chest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), mats.skin);
    head.position.y = 1.68; head.castShadow = true; g.add(head);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.helm);
    helm.position.y = 1.72; g.add(helm);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), mats.gun);
    gun.position.set(0.22, 1.25, 0.45); g.add(gun);
    // Team stripe: defenders teal band, attackers amber band.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.1, 0.4),
      new THREE.MeshBasicMaterial({ color: team === 'def' ? 0x7ec8c0 : 0xffd27a }));
    stripe.position.y = 1.45; g.add(stripe);
    this.group = g;
    this.group.position.copy(this.pos);
    scene.add(g);

    // Hitbox spec for weapons.hitscan (heights above feet).
    this.headY = 1.68; this.headR = 0.3;
    this.bodyY = 1.05; this.bodyR = 0.5;
    this.legY = 0.4; this.legR = 0.42;
  }

  get eye() { return { x: this.pos.x, y: this.pos.y + EYE_Y, z: this.pos.z }; }

  damage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; this.alive = false; this.group.visible = false; }
  }

  // Can this bot see a point? Range + line of sight (+ rough facing check when idle).
  canSee(x, y, z, maxDist = 48) {
    const e = this.eye;
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return false;
    return this.world.hasLineOfSight(e.x, e.y, e.z, x, y, z);
  }

  // React to a loud noise (gunfire / explosion) within earshot.
  hear(x, z, range = 32) {
    if (!this.alive || this.team !== 'def') return;
    if (this.state === 'engage' || this.state === 'defuse') return;
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > range) return;
    this.investigatePos = { x, z };
    this.state = 'investigate'; this.stateT = 0;
  }

  _moveToward(tx, tz, dt, speedMul = 1) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) { this.moving = false; return true; }
    const sp = this.speed * speedMul;
    this.pos.x += (dx / d) * sp * dt;
    this.pos.z += (dz / d) * sp * dt;
    this.yaw = Math.atan2(dx, dz) + Math.PI; // face travel direction (model faces +z)
    this.world.collide(this.pos, 0.38, 0.38, 1.7);
    this.moving = true;
    return false;
  }

  _face(tx, tz) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    this.yaw = Math.atan2(dx, dz) + Math.PI;
  }

  // One fixed step. ctx: { now, dt, player, enemies, bomb, onShoot(bot, target, hit), noise }
  step(dt, ctx) {
    if (!this.alive) return;
    const now = ctx.now;
    this.stateT += dt;
    this.scanT += dt;

    // --- Perception: find a visible enemy.
    let seen = null, seenDist = 1e9;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const ep = e.pos;
      const ey = e === ctx.player ? e.pos.y + 1.4 : e.pos.y + 1.2;
      if (this.canSee(ep.x, ey, ep.z)) {
        const d = Math.hypot(ep.x - this.pos.x, ep.z - this.pos.z);
        if (d < seenDist) { seen = e; seenDist = d; }
      }
    }
    if (seen) {
      if (this.target !== seen) { this.shootAt = Math.max(this.shootAt, now + 0.8); } // reaction delay on a new target
      this.target = seen; this.lastSeen = { x: seen.pos.x, z: seen.pos.z };
    }
    else if (this.target && (!this.target.alive || !this.lastSeen)) this.target = null;

    // Hurt bots fall back briefly.
    if (this.health < 35 && this.state === 'engage' && this.stateT > 1) {
      this.state = 'retreat'; this.stateT = 0;
    }

    switch (this.state) {
      case 'hold': {
        // Slow scan sweep around the post.
        this.yaw += Math.sin(this.scanT * 0.5) * 0.4 * dt;
        if (seen) { this.state = 'engage'; this.stateT = 0; }
        else if (this.waypoints.length > 0 && this.stateT > 6) { this.state = 'patrol'; this.stateT = 0; }
        break;
      }
      case 'patrol': {
        const wp = this.waypoints[this.wpIndex % this.waypoints.length];
        if (this._moveToward(wp.x, wp.z, dt, 0.7)) {
          this.wpIndex++; this.state = 'hold'; this.stateT = 0;
        }
        if (seen) { this.state = 'engage'; this.stateT = 0; }
        break;
      }
      case 'investigate': {
        if (this.investigatePos) {
          if (this._moveToward(this.investigatePos.x, this.investigatePos.z, dt)) {
            this.state = 'hold'; this.stateT = 0;
          }
        } else { this.state = 'hold'; this.stateT = 0; }
        if (seen) { this.state = 'engage'; this.stateT = 0; }
        if (this.stateT > 9) { this.state = 'patrol'; this.stateT = 0; }
        break;
      }
      case 'engage': {
        if (!seen && !this.lastSeen) { this.state = 'investigate'; this.investigatePos = this.lastSeen; this.stateT = 0; break; }
        const tx = seen ? seen.pos.x : this.lastSeen.x;
        const tz = seen ? seen.pos.z : this.lastSeen.z;
        this._face(tx, tz);
        // Strafe sideways while fighting, keep some distance.
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 0.7 + Math.random() * 0.8; }
        const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
        if (d > 14) this._moveToward(tx, tz, dt, 0.8);
        else if (d < 5) this._moveToward(this.pos.x * 2 - tx, this.pos.z * 2 - tz, dt, 0.6);
        else {
          const px = -Math.sin(this.yaw), pz = -Math.cos(this.yaw);
          this.pos.x += pz * this.strafeDir * this.speed * 0.5 * dt;
          this.pos.z += -px * this.strafeDir * this.speed * 0.5 * dt;
          this.world.collide(this.pos, 0.38, 0.38, 1.7);
          this.moving = true;
        }
        if (seen && now >= this.shootAt) this._shoot(ctx, seen, seenDist);
        if (!seen && this.stateT > 5) { this.state = 'investigate'; this.investigatePos = this.lastSeen; this.stateT = 0; }
        break;
      }
      case 'retreat': {
        // Fall back toward the team's site, then re-engage.
        const site = this.team === 'def' ? ctx.nearestSite(this.pos.x, this.pos.z) : null;
        if (site) this._moveToward(site.x, site.z, dt, 1.1);
        if (this.stateT > 2.5) { this.state = seen ? 'engage' : 'hold'; this.stateT = 0; }
        break;
      }
      case 'defuse': {
        // Stand on the bomb and channel. Movement cancels it (handled by caller).
        if (ctx.bomb && ctx.bomb.plantedSite) {
          const site = ctx.bomb.plantedSite;
          const arrived = this._moveToward(site.x, site.z, dt);
          if (arrived) {
            this.defuseT += dt;
            const need = ctx.playerHasKit ? 2.5 : 5;
            if (this.defuseT >= need) ctx.onDefused(this);
          }
        } else { this.state = 'hold'; this.stateT = 0; }
        break;
      }
      case 'follow': {
        // Attacker teammate: stick near the player, fight what it sees.
        const p = ctx.player;
        const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        if (seen) { this.state = 'engage'; this.stateT = 0; }
        else if (d > 4) this._moveToward(p.pos.x, p.pos.z, dt, 0.95);
        else this._face(p.pos.x - Math.sin(p.yaw) * 4, p.pos.z - Math.cos(p.yaw) * 4);
        break;
      }
      default: break;
    }

    // After the bomb is planted, defenders converge on the site; one defuses.
    if (this.team === 'def' && ctx.bomb && ctx.bomb.planted && this.state !== 'engage' && this.state !== 'defuse') {
      const site = ctx.bomb.plantedSite;
      const d = Math.hypot(site.x - this.pos.x, site.z - this.pos.z);
      if (d < 3.5) { this.state = 'defuse'; this.defuseT = 0; this.stateT = 0; }
      else { this.investigatePos = { x: site.x, z: site.z }; this.state = 'investigate'; this.stateT = 0; }
    }

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // Walk bob.
    const bob = this.moving ? Math.sin(now * 11) * 0.04 : 0;
    this.group.position.y = this.pos.y + Math.abs(bob);
  }

  _shoot(ctx, target, dist) {
    this.shootAt = ctx.now + 0.7 + Math.random() * 0.5;
    // Hit chance falls with distance and target movement; defenders are not lasers.
    const moving = target === ctx.player ? ctx.player.speedFrac : (target.moving ? 0.7 : 0);
    let chance = this.accuracy * (1 - dist / 90) * (1 - moving * 0.45);
    chance = Math.max(0.06, Math.min(0.6, chance));
    const hit = Math.random() < chance;
    const dmg = hit ? 8 + Math.random() * 6 : 0;
    ctx.onShoot(this, target, hit, dmg);
  }
}

export function makeSquad(scene, world) {
  const bots = [];
  const names = ['Vex', 'Rook', 'Dune', 'Sable'];
  for (let i = 0; i < 4; i++) {
    const s = world.spawnDef[i];
    bots.push(new Bot(scene, world, 'def', names[i], s.x, s.z, world.patrols[i]));
  }
    const mate = new Bot(scene, world, 'atk', 'Juno', world.spawnAtk.x - 2.5, world.spawnAtk.z + 2, []);
  bots.push(mate);
  return { defenders: bots.slice(0, 4), teammate: mate, all: bots };
}
