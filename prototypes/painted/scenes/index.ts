/**
 * prototypes/painted/scenes/index.ts — the scene registry.
 *
 * Add a scene here and it appears as a button in the harness page and as a
 * target for `node prototypes/painted/shoot.mjs <name>`.
 */

export interface Scene {
  name: string;
  width: number;
  height: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

import { smokeScene } from './smoke';
import { contactScene } from './contact';
import { detailScene, layersScene, qualityScene, zoomScene } from './detail';
import { massScene } from './mass';

export const SCENES: Scene[] = [contactScene, detailScene, layersScene, zoomScene, qualityScene, massScene, smokeScene];
