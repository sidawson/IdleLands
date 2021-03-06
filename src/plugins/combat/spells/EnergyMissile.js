
import _ from 'lodash';
import { Spell, SpellType } from '../spell';

export class EnergyMissile extends Spell {
  static element = SpellType.ENERGY;
  static tiers = [
    { name: 'energy missile', spellPower: 3, weight: 40, cost: 10,   level: 1,  profession: 'Mage' },
    { name: 'energy blast',   spellPower: 5, weight: 40, cost: 450,  level: 25, profession: 'Mage' },
    { name: 'astral flare',   spellPower: 7, weight: 40, cost: 2300, level: 65, profession: 'Mage' },
    { name: 'energy prod',    spellPower: 1, weight: 35, cost: 100,  level: 15, profession: 'MagicalMonster',
      collectibles: ['Mage\'s Tome'] }
  ];

  static shouldCast() {
    return this.$canTarget.yes();
  }

  calcDamage() {
    const min = this.caster.liveStats.int / 4;
    const max = this.caster.liveStats.int / 2;
    return this.minMax(min, max) * this.spellPower;
  }

  determineTargets() {
    return this.$targetting.randomEnemy;
  }

  preCast() {
    const message = '%player cast %spellName at %targetName and dealt %damage damage!';
    const targets = this.determineTargets();

    _.each(targets, target => {
      const damage = this.calcDamage();

      super.cast({
        damage,
        message,
        targets: [target]
      });
    });
  }
}