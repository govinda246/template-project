export interface Vector2 {
  x: number;
  y: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export interface PlayerState {
  position: Vector2;
  speed: number;
  radius: number;
}

export function advancePlayer(
  state: PlayerState,
  input: Vector2,
  deltaSeconds: number,
  bounds: Bounds,
): PlayerState {
  const magnitude = Math.hypot(input.x, input.y);
  const normalized =
    magnitude > 1
      ? { x: input.x / magnitude, y: input.y / magnitude }
      : { x: input.x, y: input.y };

  const nextX =
    state.position.x + normalized.x * state.speed * deltaSeconds;
  const nextY =
    state.position.y + normalized.y * state.speed * deltaSeconds;

  return {
    ...state,
    position: {
      x: clamp(nextX, state.radius, bounds.width - state.radius),
      y: clamp(nextY, state.radius, bounds.height - state.radius),
    },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
