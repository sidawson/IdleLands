
import { GameState } from '../../core/game-state';

export const event = 'plugin:player:request:statistics';
export const description = 'Request statistics data. Generally used only when looking at statistics.';
export const args = '';
export const socket = (socket) => {

  const requeststatistics = async() => {
    if(!socket.authToken) return;

    const { playerName } = socket.authToken;
    if(!playerName) return;

    const player = GameState.getInstance().getPlayer(playerName);
    if(!player) return;
    player._updateStatistics();
  };

  socket.on(event, requeststatistics);
};