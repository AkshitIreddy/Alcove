export interface Scene {
  name: string;
  width: number;
  height: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

import { BASELINE_SCENES } from './baseline';
import { MATERIAL_SCENES } from './materials';

export const SCENES: Scene[] = [...BASELINE_SCENES, ...MATERIAL_SCENES];
