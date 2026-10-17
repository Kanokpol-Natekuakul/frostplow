# FrostPlow: Cozy Snow Drifting

Cozy isometric snow-plowing game (React + three.js + Vite). Three villages with their own roads and weather; the last one is a blizzard that drifts snow back over cleared road. Progress auto-saves in localStorage. Plays on desktop (keyboard) and phones (drag joystick, either orientation).

Started as a Google AI Studio export (https://ai.studio/apps/8aa1ee82-26ae-4393-a0f6-3b11ea4968aa); this repo is now the source of truth. No API keys needed.

    npm install
    npm run dev      # http://localhost:3000 (window.__frost = the world, dev only)
    npm test         # logic tests (via tsx)
    npm run lint     # typecheck
    npm run deploy   # build + publish to https://frostplow.pol-game.workers.dev/ (token: ~/.hermes/frostplow-secrets/cf-token)

Villages are data: road paths in `src/game/villages.ts` (SVG path syntax, 0-100 map space). Props place themselves around the roads.
