// Única fuente de verdad de medidas y reglas. Importado por server y cliente.
// Unidades en "metros" de juego. Cancha centrada en el origen, largo sobre X.

export const FIELD = {
  LENGTH: 60, // eje X (de arco a arco)
  WIDTH: 40, // eje Z
  GOAL_WIDTH: 12, // ancho del arco sobre Z
  WALL_RESTITUTION: 0.6, // rebote de la pelota contra bordes
};

export const PLAYER = {
  RADIUS: 1.0,
  ACCEL: 60, // m/s^2 hacia el input
  MAX_SPEED: 12, // m/s
  FRICTION: 8, // desaceleración cuando no hay input (m/s^2)
};

export const BALL = {
  RADIUS: 0.6,
  FRICTION: 1.5, // desaceleración por rodadura (m/s^2)
  MAX_SPEED: 45,
  KICK_IMPULSE: 28, // m/s que suma una patada
  KICK_RANGE: 2.2, // distancia jugador-pelota para poder patear (centro a centro)
};

export const RULES = {
  GOALS_TO_WIN: 5,
  TICK_HZ: 30,
  RESULT_FREEZE_MS: 4000, // cuánto se muestra el resultado antes de reset
};

export const TICK_DT = 1 / RULES.TICK_HZ;
