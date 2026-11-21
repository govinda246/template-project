import { describe, expect, it } from 'vitest';
import { advancePlayer, type PlayerState } from './player';

const initialState: PlayerState = {
  position: { x: 100, y: 100 },
  speed: 200,
  radius: 20,
};

describe('advancePlayer', () => {
  it('moves at a frame-rate independent speed', () => {
    const next = advancePlayer(
      initialState,
      { x: 1, y: 0 },
      0.5,
      { width: 800, height: 600 },
    );

    expect(next.position).toEqual({ x: 200, y: 100 });
  });

  it('normalizes diagonal input', () => {
    const next = advancePlayer(
      initialState,
      { x: 1, y: 1 },
      1,
      { width: 800, height: 600 },
    );

    expect(Math.hypot(
      next.position.x - initialState.position.x,
      next.position.y - initialState.position.y,
    )).toBeCloseTo(initialState.speed);
  });

  it('keeps the player inside the play area', () => {
    const next = advancePlayer(
      initialState,
      { x: -1, y: -1 },
      10,
      { width: 800, height: 600 },
    );

    expect(next.position).toEqual({ x: 20, y: 20 });
  });
});
