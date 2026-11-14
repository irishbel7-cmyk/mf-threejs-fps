// economy.js — money, buy menu, round rewards. One job: the wallet.
export const PRICES = {
  rifle: 2700, pistol: 500, ammo: 400, grenade: 300, kit: 400, armor: 650,
};
export const REWARDS = {
  kill: 300, win: 3250, lossBase: 1400, lossStep: 500, lossCap: 3400,
};

export class Economy {
  constructor() {
    this.money = 800;
    this.lossStreak = 0;
    this.owned = { rifle: false, pistol: true, grenades: 1, kit: false, armor: 0 };
  }

  reset() {
    this.money = 800; this.lossStreak = 0;
    this.owned = { rifle: false, pistol: true, grenades: 1, kit: false, armor: 0 };
  }

  canAfford(price) { return this.money >= price; }

  // Buy one item; returns a message string, or null when it cannot be bought.
  buy(item) {
    const price = PRICES[item];
    if (price === undefined) return null;
    if (item === 'rifle' && this.owned.rifle) return 'Rifle already owned';
    if (item === 'pistol' && this.owned.pistol) return 'Pistol already owned';
    if (item === 'kit' && this.owned.kit) return 'Defuse kit already owned';
    if (item === 'grenade' && this.owned.grenades >= 3) return 'Max 3 grenades';
    if (item === 'armor' && this.owned.armor >= 50) return 'Vest already full';
    if (!this.canAfford(price)) return 'Not enough money';
    this.money -= price;
    if (item === 'rifle') this.owned.rifle = true;
    else if (item === 'pistol') this.owned.pistol = true;
    else if (item === 'grenade') this.owned.grenades += 1;
    else if (item === 'kit') this.owned.kit = true;
    else if (item === 'armor') this.owned.armor = 50;
    return null; // bought OK (caller applies ammo/armor effects)
  }

  killReward() { this.money += REWARDS.kill; }

  roundReward(won) {
    if (won) { this.money += REWARDS.win; this.lossStreak = 0; return REWARDS.win; }
    const bonus = Math.min(REWARDS.lossBase + this.lossStreak * REWARDS.lossStep, REWARDS.lossCap);
    this.money += bonus; this.lossStreak += 1;
    return bonus;
  }
}
