/**
 * Layer registry: the single place new presets are plugged in.
 * Adding a preset = write the layer file, import it here. The controls
 * panel, preset gallery and project format pick it up automatically.
 */

import type { LayerDef } from './layers/api';
import { bgSolid, bgImage } from './layers/bg-basic';
import { bgHyperspace, bgLattice3d, bgMegastructure } from './layers/bg-3d';
import { bgSprite } from './layers/bg-sprite';
import {
  bgAurora,
  bgContour,
  bgFbmNoise,
  bgGradientFlow,
  bgHex,
  bgNeonGrid,
  bgRipples,
  bgVoronoi,
} from './layers/bg-shaders';
import { visCircular } from './layers/vis-circular';
import { visLinear } from './layers/vis-linear';
import { visMandala } from './layers/vis-mandala';
import { visMatrix } from './layers/vis-matrix';
import { visParticles } from './layers/vis-particles';
import { visRadial } from './layers/vis-radial';
import { visRibbon } from './layers/vis-ribbon';
import { visRidgeline } from './layers/vis-ridgeline';
import { visScope } from './layers/vis-scope';
import { visTunnel } from './layers/vis-tunnel';
import { visSphere3d } from './layers/vis-sphere3d';
import { visWheel3d } from './layers/vis-wheel3d';
import { ovLogo, ovProgress, ovText } from './layers/overlays';
import { ovCaptions } from './layers/ov-captions';

export const BACKGROUNDS: readonly LayerDef[] = [
  bgGradientFlow,
  bgFbmNoise,
  bgAurora,
  bgRipples,
  bgNeonGrid,
  bgHex,
  bgContour,
  bgVoronoi,
  bgHyperspace,
  bgMegastructure,
  bgLattice3d,
  bgSprite,
  bgSolid,
  bgImage,
];
export const VISUALIZERS: readonly LayerDef[] = [
  visRadial,
  visLinear,
  visRibbon,
  visParticles,
  visScope,
  visCircular,
  visWheel3d,
  visSphere3d,
  visMatrix,
  visTunnel,
  visRidgeline,
  visMandala,
];
export const OVERLAYS: readonly LayerDef[] = [ovCaptions, ovText, ovProgress, ovLogo];

const all = new Map<string, LayerDef>();
for (const def of [...BACKGROUNDS, ...VISUALIZERS, ...OVERLAYS]) {
  if (all.has(def.id)) throw new Error(`Duplicate layer id: ${def.id}`);
  all.set(def.id, def);
}

export function getLayerDef(id: string): LayerDef | undefined {
  return all.get(id);
}
