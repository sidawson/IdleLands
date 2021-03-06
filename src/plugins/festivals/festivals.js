
import _ from 'lodash';

import { Dependencies } from 'constitute';

import { FestivalsDb } from './festivals.db';
import { Festival } from './festival';

import { ObjectId } from 'mongodb';

import { scheduleJob } from 'node-schedule';
import { sendSystemMessage } from '../../shared/send-system-message';

@Dependencies(FestivalsDb)
export class Festivals {
  constructor(festivalsDb) {
    this.festivalsDb = festivalsDb;
    this.festivals = [];

    this.init();
  }

  init() {
    this.festivalsDb.getFestivals()
      .then(festivals => {
        this.festivals = festivals || [];
        _.each(festivals, festival => {
          this.setExpiryTimerForFestival(festival);
        });
      });
  }

  hasFestival(playerName) {
    return _.find(this.festivals, { startedBy: playerName });
  }

  addFestival(festival, insertIntoDb) {
    if(_.find(this.festivals, { name: festival.name })) return;

    if(festival.message) {
      sendSystemMessage(festival.message);
    }

    festival = new Festival(festival);
    if(insertIntoDb) {
      this.festivalsDb.saveFestival(festival);
    }
    this.festivals.push(festival);
  }

  removeFestivalById(festivalId) {
    const festival = _.find(this.festivals, { _id: ObjectId(festivalId) });
    if(!festival) return;
    this._removeFestival(festival);
  }

  _removeFestival(festival) {
    this.festivals = _.without(this.festivals, festival);
    sendSystemMessage(`${festival.name} is now over!`);
    this.festivalsDb.removeFestival(festival);
  }

  setExpiryTimerForFestival(festival) {
    if(festival.endDate < Date.now()) {
      this._removeFestival(festival);
      return;
    }

    scheduleJob(festival.endDate, () => {
      this._removeFestival(festival);
    });
  }
}
