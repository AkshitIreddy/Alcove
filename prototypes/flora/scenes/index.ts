/**
 * prototypes/flora/scenes/index.ts — the flora harness scene registry.
 *
 * Add a scene here and it appears as a button in the harness page and as a
 * target for `node prototypes/flora/shoot.mjs <name>`.
 */

export interface Scene {
  name: string;
  width: number;
  height: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

import { speciesScene, speciesLitScene } from './species';
import { shelfSparseScene, shelfLushScene, shelfFrameScene } from './shelf';
import { leafBoardScene, atomBoardScene, atomVsPaintedScene } from './leafboard';

export const SCENES: Scene[] = [
  speciesScene,
  speciesLitScene,
  shelfSparseScene,
  shelfLushScene,
  shelfFrameScene,
  leafBoardScene,
  atomBoardScene,
  atomVsPaintedScene,
];
