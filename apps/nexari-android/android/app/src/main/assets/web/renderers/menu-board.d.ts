/**
 * menu-board.ts — POS menu board renderer for player-web.
 *
 * Ported from apps/nexari-tizen/src/player.ts `renderMenuBoard()` and helpers.
 * Fetches /pos/menu from the API and renders a styled menu board.
 */
import type { ContentRecord } from '../api.js';
import type { Api } from '../api.js';
export declare function renderMenuBoard(container: HTMLElement, content: ContentRecord, api: Api): Promise<void>;
//# sourceMappingURL=menu-board.d.ts.map