
const isBattleDebug = process.env.BATTLE_DEBUG;
const isQuiet = process.env.QUIET;

import _ from 'lodash';

import { StringGenerator } from '../../shared/string-generator';
import { MessageParser } from '../../plugins/events/messagecreator';

import { persistToDb } from './battle.db';

import Chance from 'chance';
const chance = new Chance();

const MAX_ROUND = 100;

export class Battle {
  constructor({ parties, introText }) {
    this.parties = parties;
    this.introText = introText;
    // 5 digit number from 10000->99999 inclusive
    // Math.floor(Math.random()*(max-min+1)+min)
    const salt = Math.floor(Math.random()*90000+10000)
    this.happenedAt = `${Date.now()}${salt}`;
    this.name = this.generateName();
    this.setId();
    this.messageData = [];
    this.currentRound = 0;
  }

  generateName() {
    return StringGenerator.battle();
  }

  isPlayerAlive(player) {
    return player.hp > 0;
  }

  get allPlayers() {
    return _.flatten(_.map(this.parties, 'players'));
  }

  get shouldGoOn() {
    return this.currentRound < MAX_ROUND && _.every(this.parties, party => {
      return _.some(party.players, p => this.isPlayerAlive(p));
    });
  }

  _emitMessage(message, data = null) {
    if(isBattleDebug && !isQuiet) {
      console.log(message);
    }
    this.messageData.push({ message, data });
  }

  startBattle() {
    this.setupParties();
    this._initialParties = _.cloneDeep(this._partyStats());
    this.startMessage();
    this.startTakingTurns();
  }

  startMessage() {
    this._emitMessage(this.introText);
  }

  _partyStats() {
    return _.map(this.parties, party => {
      return {
        name: party.name,
        players: _.map(party.players, p => {
          return { name: p.fullname, hp: _.clone(p._hp), mp: _.clone(p._mp), special: _.clone(p._special), level: p.level, profession: p.professionName };
        })
      };
    });
  }

  roundMessage() {
    if(isBattleDebug && !isQuiet) {
      _.each(this._partyStats(), party => {
        console.log(party.name);
        console.log(party.players);
      });
    }
    this._emitMessage(`Round ${this.currentRound} start.`, this._partyStats());
  }

  tryIncrement(p, stat, value = 1) {
    if(!p.$statistics) return;
    p.$statistics.incrementStat(stat, value);
  }

  _setupPlayer(player) {
    player.$battle = this;
    player._hp.toMaximum();
    player._mp.toMaximum();
    player.$profession.setupSpecial(player);

    this.tryIncrement(player, 'Combats');
  }

  setupParties() {
    _.each(this.parties, p => {
      p.prepareForCombat();
    });

    _.each(this.allPlayers, p => {
      this._setupPlayer(p);
    });
  }

  calculateTurnOrder() {
    this.turnOrder = _.sortBy(this.allPlayers, p => -p.liveStats.agi);
  }

  startTakingTurns() {
    while(this.shouldGoOn) {
      this.doRound();
    }

    this.endBattle();
  }

  doRound() {
    if(!this.shouldGoOn) {
      this.endBattle();
      return;
    }

    this.currentRound++;

    this.roundMessage();

    this.calculateTurnOrder();

    _.each(this.turnOrder, p => this.takeTurn(p));
  }

  takeTurn(player) {
    if(!this.isPlayerAlive(player) || !this.shouldGoOn) return;
    const stunned = player.liveStats.isStunned;
    if(stunned) {
      this._emitMessage(stunned);
    } else {
      this.doAttack(player);
    }

    this.emitEvents(player, 'TakeTurn');

    // Don't allow player to regen if they kill themselves
    if(!this.isPlayerAlive(player)) return;

    const hpRegen = player.liveStats.hpregen;
    const mpRegen = player.liveStats.mpregen;

    player._hp.add(hpRegen);
    player._mp.add(mpRegen);

    if(hpRegen > 0 || mpRegen > 0) {
      this._emitMessage(`${player.fullname} regenerated ${hpRegen} hp and ${mpRegen} mp!`);
    }

    player.$effects.tick();
  }

  doAttack(player, forceSkill) {
    let spell = null;

    if(!forceSkill) {
      const validSpells = this.validAttacks(player);
      const spellChoice = chance.weighted(_.map(validSpells, 'name'), _.map(validSpells, s => s.bestTier(player).weight));
      spell = _.find(player.spells, { name: spellChoice });
    } else {
      spell = _.find(player.spells, { name: forceSkill });
    }

    const spellRef = new spell(player);
    spellRef.preCast();
  }

  validAttacks(player) {
    return _(player.spells)
      .filter(spell => spell.shouldCast(player))
      .filter(spell => {
        const tier = spell.bestTier(player);
        if(!tier) return false;
        if(_.isFunction(tier.cost) && !tier.cost(player)) return false;
        if(_.isNumber(tier.cost) && player[`_${spell.stat}`].lessThan(tier.cost)) return false;
        return true;
      })
      .value();
  }

  get winningTeam() {
    return _.filter(this.parties, party => _.some(party.players, p => this.isPlayerAlive(p)))[0];
  }
  
  get losingTeam() {
    return _.filter(this.parties, party => party !== this.winningTeam)[0];
  }

  isLoser(party) {
    return _.every(party.players, p => p.hp === 0);
  }

  endBattle() {
    this._emitMessage('Battle complete.', this._partyStats());
    this.endBattleBonuses();
    persistToDb(this);
    this.cleanUp();

    if(isBattleDebug && this.kill) {
      process.exit(0);
    }
  }

  emitEvents(target, event) {
    target.$profession.handleEvent(target, event, { battle: this });
  }

  endBattleBonuses() {
    if(this.currentRound >= MAX_ROUND || !this.winningTeam) {
      this._emitMessage('No one wins! It was a tie! Give it up already, people!');
      this._isTie = true;
      return;
    }

    _.each(this.parties, party => {
      // no monster bonuses
      // rare edge case with Bonecraft reducing loser's party size to one summon and then killing it.
      if(!party.leader || !party.leader.isPlayer) return;

      // if this team won
      if(this.winningTeam === party) {

        this._emitMessage(`${party.displayName} won!`);

        const compareLevel = this.losingTeam.level;
        const level = party.level;
        const levelDiff = Math.max(-5, Math.min(5, compareLevel - level)) + 6;

        const goldGainedInParty = Math.round((compareLevel * 1560) / _.reject(party.players, (p) => p.$isMinion).length);

        _.each(party.players, p => {
          this.tryIncrement(p, 'Combat.Win');
          let gainedXp = Math.round(p._xp.maximum * (levelDiff / 100));
          if(compareLevel < level - 5) gainedXp = 0;

          const modXp = p.gainXp(gainedXp);
          const modGold = p.gainGold(goldGainedInParty);

          this._emitMessage(`${p.fullname} gained ${modXp}xp and ${modGold}gold!`);
        });

      } else {
        this._emitMessage(`${party.displayName} lost!`);

        _.each(party.players, p => {
          this.tryIncrement(p, 'Combat.Lose');

          const compareLevel = this.winningTeam.level;
          const currentGold = _.isNumber(p.gold) ? p.gold : p.gold.__current;
          const lostGold = Math.round(currentGold / 100);
          let lostXp = Math.round(p._xp.maximum / 20);

          if(compareLevel > party.level + 5) {
            lostXp = 0;
          }

          const modXp = Math.abs(p.gainXp(-Math.abs(lostXp)));
          const modGold = Math.abs(p.gainGold(-Math.abs(lostGold)));

          this._emitMessage(`${p.fullname} lost ${modXp}xp and ${modGold}gold!`);
        });
      }
    });
  }

  healDamage(target, healing, source) {
    if(healing > 0) {
      this.tryIncrement(source, 'Combat.Give.Healing', healing);
      this.tryIncrement(target, 'Combat.Receive.Healing', healing);
      target._hp.add(healing);
    }
    return healing;
  }

  dealDamage(target, damage, source) {
    if(damage > 0) {
      damage = Math.max(0, damage - target.liveStats.damageReduction);
      this.tryIncrement(source, 'Combat.Give.Damage', damage);
      this.tryIncrement(target, 'Combat.Receive.Damage', damage);

      const overkill = damage - target.hp;
      target._hp.sub(damage);
      // TODO Display overkill damage in battle log.
      if (target.hp === 0) {
        this.tryIncrement(source, 'Combat.Give.Overkill', overkill);
        this.tryIncrement(target, 'Combat.Receive.Overkill', overkill);
      }
    } else if (damage < 0) {
      this.healDamage(target, Math.abs(damage), source);
    }

    return damage;
  }

  handleDeath(target, killer) {
    this.tryIncrement(killer, `Combat.Kills.${target.isPlayer ? 'Player' : 'Monster'}`);
    this.tryIncrement(target, `Combat.Deaths.${killer.isPlayer ? 'Player' : 'Monster'}`);

    // TODO Get death message from killed character
    let message = target.deathMessage || '%player has died!';
    message = MessageParser.stringFormat(message, target);
    this._emitMessage(message);

    this.emitEvents(killer, 'Kill');
    this.emitEvents(target, 'Killed');

    target.$effects.clear();
  }

  setId() {
    this._id = `${this.happenedAt}-${this.name.split(' ').join('_')}`;
  }

  saveObject() {
    return {
      _id: this._id,
      name: this.name,
      happenedAt: new Date(this.happenedAt),
      messageData: this.messageData,
      initialParties: this._initialParties,
      parties: _.map(this.parties, party => party.buildTransmitObject())
    };
  }

  cleanUp() {
    _.each(this.allPlayers, p => {

      if(p.$prevParty) {
        p._hp.toMinimum();
        p.party.playerLeave(p);
        p.$prevParty.playerJoin(p);
        delete p.$prevParty;
      }

      p.$battle = null;
      p.$profession.resetSpecial(p);
      p.$effects.clear();
      if(p.$statistics) {
        p.$statistics.save();
      }

      if(p.$personalities && p.$personalities.isActive('Solo') && (!p.party || p.party.isBattleParty)) {
        this.tryIncrement(p, 'CombatSolo');
      }

      if(!p.isPlayer) {
        p.party.playerLeave(p);

        // pet flags for update
        if(p.updatePlayer) p.updatePlayer();
      }
    });
  }
}