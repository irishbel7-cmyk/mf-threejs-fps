// main.js — SANDLINE: boot, render loop, fixed-step simulation, round + bomb flow.
// One job: own the Game state and wire the modules together. Simulation runs at a
// fixed 60 Hz (accumulator), rendering is separate; no per-frame allocations in
// the hot loop (vectors are reused module-level temporaries).
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { makeSquad } from './bots.js';
import { WeaponState, WEAPONS, hitscan, Grenade } from './weapons.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { AudioSys } from './audio.js';
import { Economy, PRICES } from './economy.js';

const STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 15;
const BOMB_TIME = 35;
const PLANT_TIME = 3;
const WIN_ROUNDS = 5;

// Reused temporaries — the hot loop allocates nothing.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 220);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('app').prepend(this.renderer.domElement);

    this.world = new World(this.scene);
    this.player = new Player(this.world);
    this.squad = makeSquad(this.scene, this.world);
    this.weapon = new WeaponState();
    this.input = new Input();
    this.hud = new Hud();
    this.audio = new AudioSys();
    this.economy = new Economy();

    this.phase = 'menu'; // menu | buy | live | planted | roundEnd | matchEnd
    this.phaseT = 0;
    this.now = 0;
    this.round = 1;
    this.score = { atk: 0, def: 0 };
    this.roundTimer = ROUND_TIME;
    this.bomb = { planted: false, site: null, timer: 0, mesh: null, light: null, plantProgress: 0, defuseBot: null };
    this.buyOpen = false;
    this.spectating = false;
    this.grenades = [];
    this.flashes = [];
    this.tracers = [];
    this._tracerIdx = 0;
    this._prevFiring = false;
    this._planting = false;
    this._endReason = '';
    this._shotPreset = new URLSearchParams(location.search).get('shot');

    this._buildViewModel();
    this._buildTracers();
    this._wireInput();
    this._wireBuy();
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // Demo / screenshot mode: skip the menu, start a round immediately.
    if (this._shotPreset) this.startMatch(true);
    else this.hud.showOverlay();
    window.__sandline = this; // headless smoke-test hook
  }

  // ----- view model + effects -------------------------------------------
  _buildViewModel() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.45, metalness: 0.6 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a22, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 8), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.45); g.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), wood);
    grip.position.set(0, -0.14, 0.12); grip.rotation.x = 0.3; g.add(grip);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.09), dark);
    mag.position.set(0, -0.13, -0.08); mag.rotation.x = 0.15; g.add(mag);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), dark);
    sight.position.set(0, 0.09, -0.1); g.add(sight);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.flash.position.set(0, 0.02, -0.66); g.add(this.flash);
    this.viewModel = g;
    this.viewModel.position.set(0.32, -0.3, -0.55);
    this.camera.add(g);
    this.scene.add(this.camera);
  }

  _buildTracers() {
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc65c, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
  }

  _tracer(from, to, color = 0xffc65c) {
    const t = this.tracers[this._tracerIdx++ % this.tracers.length];
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.life = 0.09;
  }

  _explosionFlash(pos, scale) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc65c, transparent: true, opacity: 0.85 }));
    m.position.copy(pos); m.scale.setScalar(0.2);
    this.scene.add(m);
    this.flashes.push({ mesh: m, life: 0.5, max: scale });
  }

  // ----- input wiring ----------------------------------------------------
  _wireInput() {
    this.input.attach(this.renderer.domElement);
    document.getElementById('playBtn').addEventListener('click', () => {
      this.audio.ensure();
      this.startMatch(false);
      this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && (this.phase === 'live' || this.phase === 'planted' || this.phase === 'buy')) {
        this.hud.prompt('Click to resume — pointer lock lost');
      }
    };
    this.renderer.domElement.addEventListener('click', () => {
      if (this.phase === 'live' || this.phase === 'planted' || this.phase === 'buy') this.input.requestLock();
    });
    this.input.onKey = (code, down) => {
      if (!down) return;
      if (code === 'KeyR') this._reload();
      if (code === 'Digit1') this._switchWeapon('rifle');
      if (code === 'Digit2') this._switchWeapon('pistol');
      if (code === 'KeyG') this._throwGrenade();
      if (code === 'KeyB') this._toggleBuy();
      if (code === 'Escape') this._toggleBuy(true);
      if (this.buyOpen && /^Digit[1-6]$/.test(code)) {
        const items = ['rifle', 'pistol', 'ammo', 'grenade', 'kit', 'armor'];
        this._buy(items[Number(code.slice(5)) - 1]);
      }
    };
  }

  _wireBuy() {
    for (const item of document.querySelectorAll('#buy .item')) {
      item.addEventListener('click', () => this._buy(item.dataset.buy));
    }
  }

  // ----- match / round flow ----------------------------------------------
  startMatch(demo) {
    this.hud.hideOverlay();
    this.economy.reset();
    this.weapon = new WeaponState();
    this.score = { atk: 0, def: 0 };
    this.round = 1;
    this.startRound();
    if (demo) this._applyShotPreset();
  }

  startRound() {
    const w = this.world;
    this.player.reset(w.spawnAtk.x, w.spawnAtk.z, 0);
    // Defenders back to posts; teammate beside the player.
    for (let i = 0; i < this.squad.defenders.length; i++) {
      const b = this.squad.defenders[i];
      const s = w.spawnDef[i];
      b.pos.set(s.x, 0, s.z); b.health = 100; b.alive = true;
      b.group.visible = true; b.state = 'hold'; b.stateT = 0; b.target = null;
      b.defuseT = 0; b.lastSeen = null; b.group.position.copy(b.pos);
    }
    const mate = this.squad.teammate;
    mate.pos.set(w.spawnAtk.x - 2.5, 0, w.spawnAtk.z + 2);
    mate.health = 100; mate.alive = true; mate.group.visible = true;
    mate.state = 'follow'; mate.stateT = 0; mate.target = null;
    mate.group.position.copy(mate.pos);
    // Bomb reset.
    if (this.bomb.mesh) { this.scene.remove(this.bomb.mesh); this.scene.remove(this.bomb.light); }
    this.bomb = { planted: false, site: null, timer: 0, mesh: null, light: null, plantProgress: 0, defuseBot: null };
    this.weapon.grenades = this.economy.owned.grenades;
    this.spectating = false;
    this.buyOpen = false;
    this.hud.hideBuy(); this.hud.hideBanner();
    this.phase = 'buy'; this.phaseT = 0; this.roundTimer = BUY_TIME;
    this.hud.feed(`— Round ${this.round} — first to ${WIN_ROUNDS} —`, 'kill');
  }

  endRound(atkWon, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    const reward = this.economy.roundReward(atkWon);
    if (atkWon) this.score.atk++; else this.score.def++;
    this._endReason = reason;
    this.hud.banner(atkWon ? 'ROUND WON' : 'ROUND LOST',
      `${reason} · ${atkWon ? '+' : '+'}$${reward} ${atkWon ? 'win bonus' : 'loss bonus'}`,
      atkWon ? '#8fe388' : '#ff8a7a');
    this.hud.feed(atkWon ? `Attackers take round ${this.round}` : `Defenders take round ${this.round}`, atkWon ? 'kill' : 'death');
    if (atkWon) this.audio.win(); else this.audio.lose();
    this.phase = 'roundEnd'; this.phaseT = 0;
    this.input.releaseLock();
  }

  endMatch() {
    const won = this.score.atk >= WIN_ROUNDS;
    this.phase = 'matchEnd'; this.phaseT = 0;
    this.hud.banner(won ? 'MATCH WON' : 'MATCH LOST',
      `Final ${this.score.atk} — ${this.score.def} · click DEPLOY to play again`, won ? '#8fe388' : '#ff8a7a');
    this.hud.showOverlay();
    document.getElementById('playBtn').textContent = 'PLAY AGAIN';
  }

  _nextRoundOrMatch() {
    if (this.score.atk >= WIN_ROUNDS || this.score.def >= WIN_ROUNDS) { this.endMatch(); return; }
    this.round++;
    this.startRound();
  }

  // ----- weapons -----------------------------------------------------------
  _switchWeapon(kind) {
    if (this.phase !== 'live' && this.phase !== 'planted' && this.phase !== 'buy') return;
    this.weapon.stashMag();
    if (this.weapon.switchTo(kind, this.now)) this.audio.reload();
  }

  _reload() {
    if (this.weapon.startReload(this.now)) this.audio.reload();
  }

  _throwGrenade() {
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    if (this.weapon.grenades <= 0) { this.audio.denied(); return; }
    this.weapon.grenades--;
    this.economy.owned.grenades = this.weapon.grenades;
    const eye = this.player.eyePos;
    const f = this.player.forward();
    _v1.set(f.x, 0.35 - this.player.pitch * 0.4, f.z).normalize().multiplyScalar(16);
    const g = new Grenade(this.scene, new THREE.Vector3(eye.x, eye.y - 0.1, eye.z), _v1);
    this.grenades.push(g);
    this.audio.shot('enemy');
  }

  _fire() {
    const w = this.weapon;
    if (!w.canFire(this.now)) {
      if (w.mag === 0 && !w.reloading && this.now >= w.nextShotAt) { this.audio.dryFire(); w.nextShotAt = this.now + 0.3; }
      return;
    }
    w.mag--;
    w.nextShotAt = this.now + w.def.fireInterval;
    w.bloom = Math.min(w.def.spreadMax, w.bloom + w.def.spreadBloom);
    w.recoilPitch += w.def.recoil;
    this.player.pitch += w.def.recoil * 0.55;
    this.audio.shot(w.kind);
    this.flash.material.opacity = 1;

    // Direction from camera with spread.
    const eye = this.player.eyePos;
    const spread = w.spread(this.player.speedFrac > 0.05, this.player.crouched, this.player.speedFrac);
    const dx = (-Math.sin(this.player.yaw) + (Math.random() - 0.5) * 2 * spread) ;
    const dz = (-Math.cos(this.player.yaw) + (Math.random() - 0.5) * 2 * spread);
    const dy = Math.tan(this.player.pitch) + (Math.random() - 0.5) * 2 * spread;
    _v1.set(dx, dy, dz).normalize();

    const targets = [];
    for (const b of this.squad.all) if (b.team === 'def') targets.push(b);
    const hit = hitscan(this.world, eye.x, eye.y, eye.z, _v1.x, _v1.y, _v1.z, targets, w.def.range);
    const endT = Math.min(hit.t, w.def.range);
    _v2.set(eye.x + _v1.x * endT, eye.y + _v1.y * endT, eye.z + _v1.z * endT);
    _v3.set(eye.x + _v1.x * 0.5, eye.y - 0.12, eye.z + _v1.z * 0.5);
    this._tracer(_v3, _v2, w.def.tracer);

    if (hit.kind === 'bot') {
      const mul = hit.part === 'head' ? w.def.headMul : hit.part === 'legs' ? w.def.legMul : 1;
      const dmg = Math.round(w.def.damage * mul);
      hit.target.damage(dmg);
      this.hud.flashHit(hit.part === 'head');
      if (hit.part === 'head') this.audio.headshot(); else this.audio.hit();
      this._explosionFlash(_v2, 0.3);
      if (!hit.target.alive) {
        this.economy.killReward();
        this.hud.feed(`YOU ▸ ${hit.target.name} ${hit.part === 'head' ? '(headshot)' : ''} · +$300`);
        this.audio.win();
      }
      // Gunfire noise pulls defenders toward the shot.
      for (const b of this.squad.defenders) b.hear(this.player.pos.x, this.player.pos.z, 34);
    }
  }

  _toggleBuy(forceClose = false) {
    if (this.phase !== 'buy' && this.phase !== 'roundEnd' && !this.buyOpen) {
      this.hud.prompt('Buy menu opens between rounds');
      return;
    }
    if (forceClose && !this.buyOpen) return;
    this.buyOpen = !this.buyOpen;
    if (this.buyOpen) {
      this.hud.showBuy(this.economy.money, this.economy.owned);
      this.input.releaseLock();
    } else this.hud.hideBuy();
  }

  _buy(item) {
    if (!this.buyOpen) return;
    const msg = this.economy.buy(item);
    if (msg) { this.audio.denied(); this.hud.prompt(msg); return; }
    if (item === 'rifle') { this.weapon.hasRifle = true; this.weapon.addAmmo('rifle', 90); this._switchWeapon('rifle'); }
    if (item === 'ammo') this.weapon.addAmmo('rifle', 90);
    if (item === 'grenade') this.weapon.grenades = this.economy.owned.grenades;
    if (item === 'armor') this.player.armor = 50;
    this.audio.buy();
    this.hud.showBuy(this.economy.money, this.economy.owned);
    this.hud.prompt(`Bought ${item} — $${PRICES[item]}`);
  }

  // ----- bomb ---------------------------------------------------------------
  _bombStep(dt) {
    const b = this.bomb;
    const site = this.player.alive ? this.world.siteAt(this.player.pos.x, this.player.pos.z) : null;
    if ((this.phase === 'live') && site && this.input.down('KeyE') && !b.planted) {
      b.plantProgress += dt;
      this._planting = true;
      if (Math.floor(b.plantProgress * 4) !== Math.floor((b.plantProgress - dt) * 4)) this.audio.beep();
      if (b.plantProgress >= PLANT_TIME) {
        b.planted = true; b.site = this.world.sites[site]; b.timer = BOMB_TIME;
        this.phase = 'planted';
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.4),
          new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.6 }));
        mesh.position.set(b.site.x, 0.6, b.site.z);
        mesh.castShadow = true;
        const light = new THREE.PointLight(0xff3c2a, 8, 10, 1.6);
        light.position.set(b.site.x, 1.2, b.site.z);
        this.scene.add(mesh); this.scene.add(light);
        b.mesh = mesh; b.light = light;
        this.audio.plant();
        this.hud.feed(`BOMB PLANTED at Site ${site} — 35s`, 'kill');
        this.hud.prompt('');
      }
    } else {
      b.plantProgress = 0; this._planting = false;
    }
    if (b.planted) {
      b.timer -= dt;
      b.light.intensity = 6 + Math.sin(this.now * 9) * 5;
      if (b.timer <= 10 && Math.floor(b.timer) !== Math.floor(b.timer + dt)) this.audio.beep();
      if (b.timer <= 0) {
        this._explodeBomb();
        this.endRound(true, 'Bomb detonated — Site ' + b.site.name + ' destroyed');
      }
    }
  }

  _explodeBomb() {
    const b = this.bomb;
    if (!b.site) return;
    _v1.set(b.site.x, 1, b.site.z);
    this._explosionFlash(_v1, 9);
    this.audio.explosion();
    this.hud.shake(14);
    for (const bot of this.squad.all) {
      const d = Math.hypot(bot.pos.x - b.site.x, bot.pos.z - b.site.z);
      if (d < 9) bot.damage(Math.round(120 - d * 10));
    }
    const pd = Math.hypot(this.player.pos.x - b.site.x, this.player.pos.z - b.site.z);
    if (pd < 9 && this.player.alive) this.player.damage(Math.round(120 - pd * 10));
  }

  // ----- bot callbacks -------------------------------------------------------
  _onBotShoot(bot, target, hit, dmg) {
    const from = bot.eye;
    const to = target === this.player
      ? { x: this.player.pos.x, y: this.player.pos.y + 1.3, z: this.player.pos.z }
      : { x: target.pos.x, y: target.pos.y + 1.2, z: target.pos.z };
    if (!hit) { // miss: tracer lands near the target with an offset
      to.x += (Math.random() - 0.5) * 2.4; to.y += (Math.random() - 0.5) * 1.2; to.z += (Math.random() - 0.5) * 2.4;
    }
    this._tracer(from, to, 0xff8a6a);
    this.audio.enemyShot();
    if (!hit) return;
    if (target === this.player) {
      const dealt = this.player.damage(dmg, bot.pos.x, bot.pos.z);
      this.audio.hurt();
      this.hud.shake(5);
      if (!this.player.alive) {
        this.hud.feed(`${bot.name} ▸ YOU`, 'death');
        this.spectating = true;
      }
    } else if (target.team === 'def') {
      target.damage(dmg);
      if (!target.alive) this.hud.feed(`Juno ▸ ${target.name}`, 'kill');
    } else if (target.team === 'atk') {
      target.damage(dmg);
      if (!target.alive) this.hud.feed(`${bot.name} ▸ Juno`, 'death');
    }
  }

  // ----- fixed-step simulation ------------------------------------------------
  _sim(dt) {
    this.now += dt;
    this.phaseT += dt;

    // Mouse look.
    const { dx, dy } = this.input.takeMouse();
    if (this.player.alive && (this.phase === 'live' || this.phase === 'planted' || this.phase === 'buy')) {
      this.player.look(dx, dy);
    }

    // Phase timers.
    if (this.phase === 'buy') {
      this.roundTimer = BUY_TIME - this.phaseT;
      if (this.phaseT >= BUY_TIME) {
        this.phase = 'live'; this.phaseT = 0; this.roundTimer = ROUND_TIME;
        this.buyOpen = false; this.hud.hideBuy();
        this.hud.prompt('');
        this.hud.feed('Round live — plant the bomb or clear the sites', 'kill');
      }
    } else if (this.phase === 'live') {
      this.roundTimer = ROUND_TIME - this.phaseT;
      if (this.phaseT >= ROUND_TIME) { this.endRound(false, 'Time expired — bomb never planted'); }
    } else if (this.phase === 'planted') {
      this.roundTimer = this.bomb.timer;
    } else if (this.phase === 'roundEnd' && this.phaseT >= 4) {
      this._nextRoundOrMatch();
    }

    const active = this.phase === 'live' || this.phase === 'planted' || this.phase === 'buy';
    if (active) {
      // Player movement.
      if (this.player.alive) {
        const axes = this.input.moveAxes();
        this.player.step(dt, axes, this.input.crouch, this.input.walk, this.input.jump);
      }
      // Firing (auto vs semi-auto).
      const firing = this.input.firing && this.input.locked !== false && this.player.alive;
      const wantFire = this.weapon.def.auto ? firing : (firing && !this._prevFiring);
      if (wantFire && (this.phase === 'live' || this.phase === 'planted')) this._fire();
      this._prevFiring = firing;
      // Reload completion.
      if (this.weapon.reloading && this.now >= this.weapon.reloadEnd) this.weapon.finishReload();
      // Recoil / bloom recovery.
      this.weapon.recoilPitch *= Math.max(0, 1 - dt * 7);
      this.weapon.bloom = Math.max(0, this.weapon.bloom - dt * 0.028);
      // Grenades.
      for (let i = this.grenades.length - 1; i >= 0; i--) {
        const g = this.grenades[i];
        g.step(dt, this.world);
        if (g.fuse <= 0) {
          const ex = g.explode(this.scene);
          this.grenades.splice(i, 1);
          this._explosionFlash(ex.pos, 6);
          this.audio.explosion();
          this.hud.shake(10);
          for (const bot of this.squad.all) {
            const d = Math.hypot(bot.pos.x - ex.pos.x, bot.pos.z - ex.pos.z);
            if (d < ex.radius) {
              bot.damage(Math.round(ex.damage * (1 - d / ex.radius)));
              if (!bot.alive && bot.team === 'def') { this.economy.killReward(); this.hud.feed(`YOU ▸ ${bot.name} (grenade) · +$300`); }
            }
          }
          const pd = Math.hypot(this.player.pos.x - ex.pos.x, this.player.pos.z - ex.pos.z);
          if (pd < ex.radius && this.player.alive) { this.player.damage(Math.round(ex.damage * 0.5 * (1 - pd / ex.radius))); this.audio.hurt(); }
          for (const b of this.squad.defenders) b.hear(ex.pos.x, ex.pos.z, 40);
        }
      }
      // Bomb plant / timer.
      this._bombStep(dt);
      // Bots: they only fight once the round is live; during the buy phase
      // they hold their posts (no shooting, no patrolling into the player).
      if (this.phase === 'live' || this.phase === 'planted') {
        const ctx = {
        now: this.now, dt, player: this.player, bomb: this.bomb,
        playerHasKit: this.economy.owned.kit,
        enemies: null,
        nearestSite: (x, z) => {
          const a = this.world.sites.A, b2 = this.world.sites.B;
          return Math.hypot(x - a.x, z - a.z) < Math.hypot(x - b2.x, z - b2.z) ? a : b2;
        },
        onShoot: (bot, target, hit, dmg) => this._onBotShoot(bot, target, hit, dmg),
        onDefused: () => this.endRound(false, 'Bomb defused by defenders'),
      };
      for (const b of this.squad.defenders) {
        ctx.enemies = [this.player, this.squad.teammate].filter((e) => e.alive);
        b.step(dt, ctx);
      }
      if (this.squad.teammate.alive) {
        ctx.enemies = this.squad.defenders.filter((e) => e.alive);
        this.squad.teammate.step(dt, ctx);
      }
      // Round end checks.
      if (this.phase === 'live' || this.phase === 'planted') {
        const defAlive = this.squad.defenders.some((b) => b.alive);
        const atkAlive = this.player.alive || this.squad.teammate.alive;
        if (!defAlive) this.endRound(true, 'All defenders eliminated');
        else if (!atkAlive) this.endRound(false, 'Attackers eliminated');
      }
      }
    }

    // Prompts.
    if (this.phase === 'live' && this.player.alive && !this.bomb.planted) {
      const site = this.world.siteAt(this.player.pos.x, this.player.pos.z);
      if (site) this.hud.prompt(this._planting ? `PLANTING… ${Math.round((this.bomb.plantProgress / PLANT_TIME) * 100)}%` : `Hold E to plant at Site ${site}`);
      else if (this.phaseT < 3) this.hud.prompt('Plant at Site A (east) or Site B (west) — or eliminate all defenders');
      else this.hud.prompt('');
    }

    // HUD.
    const w = this.weapon;
    this.hud.setHealth(this.player.health, this.player.armor);
    this.hud.setAmmo(w, w.mag, w.reserve[w.kind], w.grenades);
    this.hud.setTimer(this.roundTimer, this.phase === 'buy' ? 'buy' : this.phase === 'planted' ? 'planted' : 'live');
    this.hud.setScore(this.score.atk, this.score.def, this.round);
    this.hud.setMoney(this.economy.money, this.buyOpen);
    this.hud.setCrosshair(w.spread(this.player.speedFrac > 0.05, this.player.crouched, this.player.speedFrac), this.player.speedFrac > 0.05);
    this.hud.setBomb(this.bomb.planted
      ? { text: `💣 BOMB PLANTED — SITE ${this.bomb.site.name} · ${Math.ceil(this.bomb.timer)}s`, cls: 'plant' }
      : this._planting ? { text: 'PLANTING…', cls: 'plant' } : null);
  }

  // ----- render ---------------------------------------------------------------
  _render() {
    // Camera follows the player (or the teammate while spectating).
    if (this.spectating && this.squad.teammate.alive) {
      const m = this.squad.teammate;
      this.camera.position.set(m.pos.x, m.pos.y + 1.5, m.pos.z);
      this.camera.rotation.set(0, m.yaw, 0, 'YXZ');
      this.viewModel.visible = false;
    } else {
      const eye = this.player.eyePos;
      this.camera.position.set(eye.x, eye.y, eye.z);
      this.camera.rotation.set(this.player.pitch + this.weapon.recoilPitch * 0.4, this.player.yaw, 0, 'YXZ');
      this.viewModel.visible = this.player.alive;
    }
    // View-model bob + kick.
    const bob = this.player.speedFrac * Math.sin(this.now * 10) * 0.012;
    this.viewModel.position.y = -0.3 + bob - this.weapon.recoilPitch * 0.35;
    this.viewModel.position.z = -0.55 + this.weapon.recoilPitch * 0.5;
    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - 0.25);
    // Tracer + flash decay.
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= 1 / 60; if (t.life <= 0) t.line.material.opacity = 0; }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= 1 / 60;
      const k = Math.max(0, f.life / 0.5);
      f.mesh.scale.setScalar(f.max * (1 - k) + 0.2);
      f.mesh.material.opacity = k * 0.85;
      if (f.life <= 0) { this.scene.remove(f.mesh); this.flashes.splice(i, 1); }
    }
    // Site rings pulse while the bomb is planted.
    if (this.bomb.planted && this.bomb.site) {
      this.bomb.site.ring.material.opacity = 0.5 + Math.sin(this.now * 6) * 0.4;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ----- screenshot staging (real gameplay states, driven by ?shot=) ----------
  _applyShotPreset() {
    const p = this._shotPreset;
    // Fast-forward past the buy phase into a live round.
    this.phase = 'live'; this.phaseT = 0; this.roundTimer = ROUND_TIME;
    const placeBot = (bot, x, z, state = 'hold') => {
      bot.pos.set(x, 0, z); bot.group.position.copy(bot.pos);
      bot.state = state; bot.stateT = 0; bot.alive = true; bot.health = 100; bot.group.visible = true;
    };
    if (p === 'spawn') {
      this.player.reset(this.world.spawnAtk.x, this.world.spawnAtk.z, 0);
      placeBot(this.squad.defenders[0], 12, 2, 'patrol');
      placeBot(this.squad.defenders[1], -10, 4, 'patrol');
      this.hud.feed('Juno ▸ Rook · +$300', 'kill');
    } else if (p === 'aim') {
      this.economy.money = 3500;
      this.weapon.hasRifle = true; this.weapon.addAmmo('rifle', 90);
      this.weapon.stashMag(); this.weapon.switchTo('rifle', this.now);
      this.player.reset(10, 6, 0);
      this.player.yaw = 0.35; this.player.pitch = 0.02;
      placeBot(this.squad.defenders[0], 16, -8, 'hold');
      this.squad.defenders[0].yaw = Math.PI;
      placeBot(this.squad.defenders[1], 20, -14, 'hold');
      this.hud.feed('YOU ▸ Vex (headshot) · +$300', 'kill');
      this.hud.feed('Dune ▸ Juno', 'death');
    } else if (p === 'buy') {
      this.phase = 'buy'; this.phaseT = 0; this.roundTimer = BUY_TIME;
      this.economy.money = 4800;
      this.player.reset(this.world.spawnAtk.x, this.world.spawnAtk.z, 0.6);
      this.buyOpen = true;
      this.hud.showBuy(this.economy.money, this.economy.owned);
    } else if (p === 'fight') {
      // A-long firefight: open lane so the engagement (and its tracers) are visible.
      this.economy.money = 2100;
      this.weapon.hasRifle = true; this.weapon.addAmmo('rifle', 90);
      this.weapon.stashMag(); this.weapon.switchTo('rifle', this.now);
      this.weapon.mag = 24;
      this.player.reset(11, 12, -0.34);
      this.player.health = 62;
      placeBot(this.squad.defenders[0], 18, -8, 'engage');
      this.squad.defenders[0].target = this.player;
      placeBot(this.squad.defenders[2], 22, -12, 'engage');
      this.squad.defenders[2].target = this.squad.teammate;
      this.squad.teammate.pos.set(4, 0, 14);
      this.squad.teammate.group.position.copy(this.squad.teammate.pos);
      this.squad.teammate.state = 'hold'; // staged: hold still so he never blocks the camera
      this.squad.teammate.stateT = 0;
      this.hud.feed('YOU ▸ Vex · +$300', 'kill');
      this.hud.feed('Rook ▸ Juno', 'death');
    }
    this._sim(1 / 60);
    this._render();
    window.__shotReady = true;
  }

  // ----- main loop -------------------------------------------------------------
  run() {
    let last = performance.now();
    let acc = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      let dt = (t - last) / 1000;
      last = t;
      if (dt > 0.25) dt = 0.25;
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) { this._sim(STEP); acc -= STEP; n++; }
      if (n === 5) acc = 0;
      this._render();
      if (!window.__shotReady) window.__shotReady = true;
    };
    requestAnimationFrame(loop);
  }
}

const game = new Game();
if (!game._shotPreset) game.run();
else {
  // Screenshot mode: simulate a short burst so bots settle, then keep rendering.
  for (let i = 0; i < 30; i++) game._sim(STEP);
  game._render();
  game.run();
}
