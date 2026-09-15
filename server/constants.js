// Única fuente de verdad de medidas y reglas. Importado por server y cliente.
// Unidades en "metros" de juego. Cancha centrada en el origen, largo sobre X.

export const FIELD = {
  LENGTH: 170, // eje X (de arco a arco)
  WIDTH: 108, // eje Z
  GOAL_WIDTH: 26, // ancho del arco sobre Z
  WALL_RESTITUTION: 0.6, // rebote de la pelota contra bordes
};

export const PLAYER = {
  RADIUS: 1.0,
  ACCEL: 90, // m/s^2 hacia el input
  MAX_SPEED: 22, // m/s (cancha más grande -> un poco más rápido)
  FRICTION: 9, // desaceleración cuando no hay input (m/s^2)
};

export const BALL = {
  RADIUS: 0.6,
  FRICTION: 1.2, // desaceleración por rodadura (m/s^2) — rueda más lejos en cancha grande
  MAX_SPEED: 60,
  KICK_IMPULSE: 36, // m/s que suma una patada
  KICK_RANGE: 2.2, // distancia jugador-pelota para poder patear (centro a centro)
};

export const RULES = {
  GOALS_TO_WIN: 5,
  TICK_HZ: 30,
  GOAL_FREEZE_MS: 2800, // cooldown/festejo tras un gol antes del próximo saque
  RESULT_FREEZE_MS: 4000, // cuánto se muestra el resultado antes de reset
};

export const TICK_DT = 1 / RULES.TICK_HZ;
