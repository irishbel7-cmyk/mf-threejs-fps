// player.js — first-person controller: mouse look, acceleration, crouch, jump,
// AABB collision, health/armor. One job: the human player.
import * as THREE from 'three';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;
const RADIUS = 0.38;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(0, 0, 20);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.eyeHeight = EYE_STAND;
    this.crouched = false;
    this.onGround = true;
    this.vy = 0;
    this.speedFrac = 0; // 0..1, for spread + HUD
    this._tmpFwd = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.health = 100; this.alive = true;
    this.vy = 0; this.crouched = false; this.eyeHeight = EYE_STAND;
  }

  get eyePos() {
    return { x: this.pos.x, y: this.pos.y + this.eyeHeight, z: this.pos.z };
  }

  forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  look(dx, dy, sensitivity = 0.0022) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = 1.55;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  // Fixed-step movement: accel toward wish velocity, friction when no input.
  step(dt, axes, crouch, walk, jump) {
    if (!this.alive) return;
    this.crouched = crouch;
    const targetEye = crouch ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    const fwd = this.forward();
    const right = { x: -fwd.z, z: fwd.x };
    let wx = fwd.x * axes.f + right.x * axes.s;
    let wz = fwd.z * axes.f + right.z * axes.s;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }
    const maxSpeed = crouch ? 2.4 : walk ? 3.4 : 6.2;
    const accel = 42;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    // Friction: strong when idle, mild while steering.
    const fric = len > 0.1 ? 6 : 11;
    const damp = Math.max(0, 1 - fric * dt);
    this.vel.x *= damp; this.vel.z *= damp;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > maxSpeed) { this.vel.x *= maxSpeed / sp; this.vel.z *= maxSpeed / sp; }
    this.speedFrac = Math.min(1, sp / 6.2);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.collide(this.pos, RADIUS, RADIUS, 1.7);

    // Small jump; gravity returns the player to the ground.
    if (jump && this.onGround) { this.vy = 5.2; this.onGround = false; }
    if (!this.onGround) {
      this.vy -= 16 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.onGround = true; }
    }
  }

  damage(amount, fromX, fromZ) {
    if (!this.alive) return 0;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, remaining * 0.5);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    this.health -= remaining;
    if (this.health <= 0) { this.health = 0; this.alive = false; }
    return remaining;
  }

  heal(amount) { this.health = Math.min(100, this.health + amount); }
}
