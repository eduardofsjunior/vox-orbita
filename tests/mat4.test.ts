import { describe, expect, it } from 'vitest';
import { identity, multiply, perspective, rotationX, rotationY, rotationZ, scaling, transformPoint, translation } from '../src/engine/mat4';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);

describe('mat4', () => {
  it('identity leaves points unchanged', () => {
    const [x, y, z, w] = transformPoint(identity(), 3, -2, 7);
    close(x, 3);
    close(y, -2);
    close(z, 7);
    close(w, 1);
  });

  it('multiply by identity is a no-op', () => {
    const m = multiply(rotationY(0.7), translation(1, 2, 3));
    const a = multiply(m, identity());
    const b = multiply(identity(), m);
    for (let i = 0; i < 16; i++) {
      close(a[i], m[i]);
      close(b[i], m[i]);
    }
  });

  it('translation moves points', () => {
    const [x, y, z] = transformPoint(translation(5, -1, 2), 1, 1, 1);
    close(x, 6);
    close(y, 0);
    close(z, 3);
  });

  it('rotations preserve length and rotate the right way', () => {
    // 90° about Y sends +X to −Z (right-handed).
    const [x, , z] = transformPoint(rotationY(Math.PI / 2), 1, 0, 0);
    close(x, 0);
    close(z, -1);
    // 90° about X sends +Y to +Z.
    const [, y2, z2] = transformPoint(rotationX(Math.PI / 2), 0, 1, 0);
    close(y2, 0);
    close(z2, 1);
    // 90° about Z sends +X to +Y.
    const [x3, y3] = transformPoint(rotationZ(Math.PI / 2), 1, 0, 0);
    close(x3, 0);
    close(y3, 1);
    // Length preserved under an arbitrary rotation.
    const [rx, ry, rz] = transformPoint(rotationY(0.83), 2, 3, 4);
    close(Math.hypot(rx, ry, rz), Math.hypot(2, 3, 4));
  });

  it('scaling scales uniformly', () => {
    const [x, y, z] = transformPoint(scaling(2.5), 1, -2, 4);
    close(x, 2.5);
    close(y, -5);
    close(z, 10);
  });

  it('multiply applies right-hand matrix first', () => {
    // Translate then rotate vs rotate then translate differ.
    const rt = multiply(rotationY(Math.PI / 2), translation(1, 0, 0));
    const [x, , z] = transformPoint(rt, 0, 0, 0);
    // Point translated to (1,0,0), then rotated to (0,0,−1).
    close(x, 0);
    close(z, -1);
  });

  it('perspective maps the view frustum correctly', () => {
    const p = perspective(Math.PI / 2, 1, 1, 10);
    // Point on the near plane center → NDC z = −1.
    const near = transformPoint(p, 0, 0, -1);
    close(near[2] / near[3], -1);
    // Point on the far plane center → NDC z = +1.
    const far = transformPoint(p, 0, 0, -10);
    close(far[2] / far[3], 1);
    // 90° fov: at z=−d the frustum half-height is d → maps to NDC y = 1.
    const edge = transformPoint(p, 0, 5, -5);
    close(edge[1] / edge[3], 1);
    // w carries −z for perspective divide.
    close(far[3], 10);
  });
});
