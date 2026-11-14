// hud.js — all DOM HUD updates. One job: present state, never simulate it.
export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['health', 'ammo', 'timer', 'money', 'feed', 'bomb', 'banner', 'prompt', 'buy', 'overlay', 'vignette', 'crosshair', 'hitmark']) {
      this.el[id] = document.getElementById(id);
    }
    this._feedCount = 0;
    this._last = {};
  }

  setHealth(hp, armor) {
    const num = this.el.health.querySelector('.num');
    const fill = this.el.health.querySelector('.fill');
    num.textContent = `${Math.ceil(hp)}${armor > 0 ? ' +' + Math.round(armor) : ''}`;
    fill.style.width = `${Math.max(0, hp)}%`;
    fill.style.background = hp > 50 ? 'linear-gradient(90deg,#3fae5a,#7be495)'
      : hp > 25 ? 'linear-gradient(90deg,#d8a33a,#ffd27a)' : 'linear-gradient(90deg,#c0392b,#ff8a7a)';
    this.el.vignette.style.opacity = hp < 35 ? String(1 - hp / 45) : '0';
  }

  setAmmo(weapon, mag, reserve, grenades) {
    this.el.ammo.querySelector('.wname').textContent = weapon.def.name + (weapon.reloading ? ' — RELOADING' : '');
    this.el.ammo.querySelector('.mag').textContent = mag;
    this.el.ammo.querySelector('.res').textContent = `/ ${reserve}`;
    this.el.ammo.querySelector('.gren').textContent = `HE x${grenades}`;
  }

  setTimer(seconds, phase) {
    const s = Math.max(0, Math.ceil(seconds));
    const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const label = phase === 'buy' ? 'BUY PHASE' : phase === 'planted' ? 'BOMB' : 'ROUND';
    if (this._last.timer !== txt) { this.el.timer.querySelector('.clock').textContent = `${txt} · ${label}`; this._last.timer = txt; }
  }

  setScore(atk, def, round) {
    const txt = `ATK ${atk} — ${def} DEF · ROUND ${round}`;
    if (this._last.score !== txt) { this.el.timer.querySelector('.score').textContent = txt; this._last.score = txt; }
  }

  setMoney(money, buyOpen) {
    const txt = `$${money}`;
    if (this._last.money !== txt) { this.el.money.childNodes[0].textContent = txt; this._last.money = txt; }
    this.el.money.querySelector('.hint').textContent = buyOpen ? 'Buy menu open — B to close' : 'Press B to buy (buy phase)';
  }

  setBomb(status) {
    // status: null | { text, cls }
    if (!status) { this.el.bomb.innerHTML = ''; return; }
    this.el.bomb.innerHTML = `<span class="${status.cls}">${status.text}</span>`;
  }

  // Crosshair gap in px from spread (radians -> px scale) + movement.
  setCrosshair(spreadRad, moving) {
    const gap = 5 + spreadRad * 420 + (moving ? 4 : 0);
    const set = (id, x, y, w, h) => {
      const e = document.getElementById(id);
      e.style.left = `${x}px`; e.style.top = `${y}px`; e.style.width = `${w}px`; e.style.height = `${h}px`;
    };
    set('chT', -1, -gap - 9, 2, 9); set('chB', -1, gap, 2, 9);
    set('chL', -gap - 9, -1, 9, 2); set('chR', gap, -1, 9, 2);
  }

  flashHit(head) {
    const h = this.el.hitmark;
    h.style.display = 'block';
    h.querySelectorAll('span').forEach((s) => { s.style.background = head ? '#ff5a3c' : '#fff'; });
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => { h.style.display = 'none'; }, 120);
  }

  feed(html, cls = 'kill') {
    const div = document.createElement('div');
    div.className = cls;
    div.innerHTML = html;
    this.el.feed.prepend(div);
    this._feedCount++;
    while (this.el.feed.children.length > 5) this.el.feed.removeChild(this.el.feed.lastChild);
  }

  banner(title, sub, color = '#ffd27a') {
    this.el.banner.style.display = 'block';
    this.el.banner.style.color = color;
    this.el.banner.innerHTML = `${title}<small>${sub || ''}</small>`;
  }

  hideBanner() { this.el.banner.style.display = 'none'; }

  prompt(text) {
    if (!text) { this.el.prompt.style.display = 'none'; return; }
    this.el.prompt.style.display = 'block';
    this.el.prompt.textContent = text;
  }

  showBuy(money, owned) {
    this.el.buy.style.display = 'block';
    this.el.buy.querySelector('.bal').textContent = `$${money} — your loadout`;
    for (const item of this.el.buy.querySelectorAll('.item')) {
      const key = item.dataset.buy;
      const priceEl = item.children[1];
      if (!priceEl.dataset.price) priceEl.dataset.price = priceEl.textContent;
      const ownedNow = (key === 'rifle' && owned.rifle) || (key === 'pistol' && owned.pistol)
        || (key === 'kit' && owned.kit) || (key === 'grenade' && owned.grenades >= 3)
        || (key === 'armor' && owned.armor >= 50);
      priceEl.textContent = ownedNow ? 'OWNED' : priceEl.dataset.price;
      item.classList.toggle('owned', ownedNow);
    }
  }

  hideBuy() { this.el.buy.style.display = 'none'; }

  showOverlay() { this.el.overlay.style.display = 'flex'; }
  hideOverlay() { this.el.overlay.style.display = 'none'; }

  shake(amount) {
    const app = document.getElementById('app');
    app.style.transform = `translate(${(Math.random() - 0.5) * amount}px, ${(Math.random() - 0.5) * amount}px)`;
    clearTimeout(this._shakeT);
    this._shakeT = setTimeout(() => { app.style.transform = ''; }, 90);
  }
}
