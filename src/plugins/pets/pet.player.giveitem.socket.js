
import { GameState } from '../../core/game-state';

export const event = 'plugin:pet:giveitem';
export const description = 'Give your pet an item from your equipment.';
export const args = 'itemId';
export const socket = (socket, primus, respond) => {

  const petgiveitem = async({ itemId }) => {
    if(!socket.authToken) return;

    const { playerName } = socket.authToken;
    if(!playerName) return;

    const player = GameState.getInstance().getPlayer(playerName);

    const message = player.$pets.giveItemToPet(player, itemId);

    if(message) {
      respond({ type: 'error', title: 'Pet Error', notify: message });
    }
  };

  socket.on(event, petgiveitem);
};