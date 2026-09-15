# ⚽ Arven Ball

Fútbol 3D multijugador en el navegador (three.js + WebSocket). Cada quien maneja
un futbolista en una cancha compartida; primero a 5 goles gana.

## Correr en local

```bash
npm install
```

Desarrollo (recarga en caliente del cliente):

```bash
npm run dev      # cliente en http://localhost:5173 (Vite)
npm run server   # servidor de juego en http://localhost:3000
```

En dev, Vite proxea el WebSocket al server. Para probar el flujo real
(un solo proceso sirviendo todo), usá:

```bash
npm start        # buildea el cliente y levanta el server en http://localhost:3000
```

Abrí **dos pestañas** en `http://localhost:3000`, poné un nombre en cada una y
a jugar.

## Controles

- **WASD** / flechas: moverse
- **Espacio**: patear

## Desplegar

Es un solo servicio Node. En Render/Railway:

- Build command: `npm install && npm run build`
- Start command: `npm run server`
- El server escucha en `process.env.PORT`.

## Estructura

- `server/constants.js` — medidas y reglas (fuente de verdad, compartida).
- `server/game.js` — simulación autoritativa (física, goles, marcador).
- `server/index.js` — HTTP estático + WebSocket + loop 30Hz.
- `client/` — three.js, input, red, interpolación.

## Tests

```bash
node server/game.test.js
```
