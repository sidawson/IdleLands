
import { Achievement, AchievementTypes } from '../achievement';

export class Drunk extends Achievement {
  static achievementData(player) {

    const totalSteps = player.$statistics.getStat('Character.Movement.Drunk');

    if(totalSteps < 100000) return [];

    const baseReward = {
      tier: 1,
      name: 'Drunk',
      desc: `Gain a special title (and +5% max item score) for ${(100000).toLocaleString()} drunken steps.`,
      type: AchievementTypes.EXPLORE,
      rewards: [{
        type: 'title',
        title: 'Drunk',
        deathMessage: '%player drank too much and fell into a river.'
      }, {
        type: 'petattr',
        petattr: 'a bottle of booze'
      }, {
        type: 'stats',
        itemFindRangeMultiplier: 0.05
      }]
    };

    if(totalSteps >= 1000000) {
      baseReward.rewards.push({
        type: 'title',
        title: 'Lush',
        deathMessage: '%player drank too much and dozed off in the town square.'
      });
    }

    return [baseReward];
  }
}