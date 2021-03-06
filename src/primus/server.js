
import fs from 'fs';

import _ from 'lodash';
import Primus from 'primus';
import Emit from 'primus-emit';
import Rooms from 'primus-rooms';
// import Multiplex from 'primus-multiplex';

import { GameState } from '../core/game-state';
import { Logger } from '../shared/logger';

import allteleports from '../../assets/maps/content/teleports.json';
const compressedTeleports = _.extend({}, allteleports.towns, allteleports.bosses, allteleports.dungeons, allteleports.trainers, allteleports.other);

export const primus = (() => {
  if(process.env.NO_START_GAME) return;

  const ip = _(require('os').networkInterfaces())
    .values()
    .flatten()
    .filter(val => val.family === 'IPv4' && val.internal === false)
    .map('address')
    .first();

  if(ip) {
    console.log(`Your IP is: ${ip}:${process.env.PORT || 8080}` + (process.env.QUIET ? ' (quiet mode. ssh...)' : ''));
  }

  const express = require('express');
  const compression = require('compression');
  const serve = express();
  serve.use(compression(), express.static('assets'));
  serve.get('/online', (req, res) => {
    try {
      res.set({
        'Cache-Control': 'public, max-age=86400'
      });
      res.json({
        players: GameState.getInstance().getPlayers().length,
        sparks: primus.connected
      });
    } catch (e) {
      res.send(e);
    }
  });

  serve.get('/maps', (req, res) => {
    const mapData = _.sortBy(_.map(GameState.getInstance().world.maps, (val, key) => {
      return { name: key, path: val.path };
    }), 'name');

    res.json({
      maps: mapData,
      teleports: compressedTeleports
    });
  });

  const finalhandler = require('finalhandler');

// load primus
  const server = require('http').createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    serve(req, res, finalhandler(req, res));
  });

  server.listen(process.env.PORT || 8080);

  const primus = new Primus(server, { iknowhttpsisbetter: true, parser: 'JSON', transformer: 'websockets' });

// load socket functions
  const normalizedPath = require('path').join(__dirname, '..');

  const getAllSocketFunctions = (dir) => {
    let results = [];

    const list = fs.readdirSync(dir);
    _.each(list, basefilename => {
      const filename = `${dir}/${basefilename}`;
      const stat = fs.statSync(filename);
      if(stat && stat.isDirectory()) results = results.concat(getAllSocketFunctions(filename));
      else if(_.includes(basefilename, '.socket')) results.push(filename);
    });

    return results;
  };

  const allSocketFunctions = getAllSocketFunctions(normalizedPath);
  const allSocketRequires = _.map(allSocketFunctions, require);

  primus.use('rooms', Rooms);
  primus.use('emit', Emit);

  primus.players = {};

  primus.addPlayer = (playerName, spark) => {
    if(!primus.players[playerName]) primus.players[playerName] = [];
    // _.each(primus.players[playerName], spark => primus.delPlayer(playerName, spark));
    // if(!primus.players[playerName]) primus.players[playerName] = [];
    primus.players[playerName].push(spark);
  };

  primus.delPlayer = (playerName, spark) => {
    primus.players[playerName] = _.without(primus.players[playerName], spark);
    spark.end();
    if(!primus.players[playerName].length) {
      delete primus.players[playerName];
    }
  };

  primus.emitToPlayers = (players = [], data) => {
    _.each(players, player => {
      _.each(primus.players[player], spark => {
        spark.write(data);
      });
    });
  };

  // primus.use('multiplex', Multiplex);

// force setting up the global connection
  new (require('../shared/db-wrapper').DbWrapper)().connectionPromise();

  primus.on('connection', spark => {
    const respond = (data) => {
      spark.write(data);
    };

    _.each(allSocketRequires, obj => obj.socket(spark, primus, (data) => {
      data.event = obj.event;
      respond(data);

      // kill global sparks after 5 seconds
      if(_.includes(obj.event, 'plugin:global')) {
        setTimeout(() => {
          spark.end();
        }, 5000);
      }
    }));

    spark.on('error', e => {
      Logger.error('Spark', e);
    });

    setTimeout(() => {
      if(spark.authToken || spark._registering) return;
      spark.end();
    }, 10000);

    // spark.join('adventurelog');
  });

  if(process.env.NODE_ENV !== 'production') {
    _.each(['Play', 'Global'], root => {
      const path = require('path').join(__dirname, '..', '..', '..', root);
      fs.stat(path, e => {
        if(e) {
          Logger.error('Primus:Generate', e);
          return;
        }
        
        Logger.info('Primus:Generate', `${root} is installed. Generating a Primus file for it.`);
        primus.save(`${path}/primus.gen.js`);
      });
    });
  }

  return primus;
})();
