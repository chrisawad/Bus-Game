# Bus Jam

A cozy 3D bus traffic puzzle, built with TypeScript, Three.js/WebGL, Tailwind CSS, Vite, and pnpm. No login, backend, or external runtime assets.

## Play

- Click or tap a bus. It drives **forward along its roof arrow**, including diagonal directions.
- A blocked bus bumps and returns to its spot. Supported phones give a short vibration at impact. The win screen counts bumps across the route, including bumps before an undo.
- A clear bus travels around the depot border to one of **five unlocked stops**.
- Two independently shuffled overflow lines alternate to refill every vacated space in the 24-person middle group.
- **Anyone in the middle group** can board a matching bus. Matching passengers board together, then both side lines refill the middle together.
- A full bus leaves and releases its stop. **Every bus gone = you win.**
- Send several clear buses in quick succession. Each reserves its own stop immediately. Buses choose the quickest available stop and either direction around the border; booked trajectories keep crossing and opposing traffic clear.
- With Sound enabled, a successful dispatch plays its tap sound. Trying to send another bus when all five stops are reserved plays two soft descending notes. If all stops fill without a match anywhere in the middle group, undo a dispatch or restart.
- Undo, restart, and hints stay on the game screen. Install sits at the lower left. The floating gear menu contains sound, double speed, help, the keyboard bus list, and saved-progress status. Preferences persist on this device.

Layouts pack a screen-shaped rectangular yard with an irregular mix of horizontal, vertical, and diagonal buses. New buses are placed with a clear forward exit, so reversing insertion order guarantees a solution. Each new game and restart shuffles both feeders independently; reloading preserves their saved order. Passengers are mixed in batches of four buses from the exit solution, so clearing one batch before the next remains a winning strategy with the smaller middle group. Collision checks use the rotated bus bodies. All six colors are available, and passenger totals exactly match the bus capacities. Desktop and mobile share the same camera and a full-viewport canvas with minimal overlays. The depot restores the original cream-and-sage setting with brighter buses, short curved feeder queues (six rows each), flowers, and a shelter. Larger passengers stand in wider-spaced, compact queues, while compact buses and matching collision bodies fill a taller yard on phones and a wider yard on desktop. New routes fit the available screen; resizing preserves parked positions on an active route. Yellow buses use a bright, lightly toasted yellow; outlined white arrows remain legible on the brighter yellow and pink roofs. Red is warmer and pink is lighter so their passengers and buses are easier to distinguish. The keyboard bus list scrolls inside Settings while the scene remains visible.

Buses share one lane around the yard. Its inside edge leaves room for the longest bus to turn, and the stops have a separate apron. New routes use the space between the header and bottom controls to fit more parked buses. An active route keeps its existing buses and saved positions.

## Run locally

Requires Node.js 22.12+ (Node.js 24 recommended) and pnpm 11.25.

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite, usually http://localhost:5173. The dev server binds to all network interfaces. A second device must be on a reachable network and use the host's actual IP address.

```sh
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm preview
```

The browser tests exercise actual canvas picking, collisions, undo, group boarding behind other colors, bulk refills from both sides, concurrent dispatches, full-level completion, save migration, camera alignment on desktop/mobile, and offline reload. They run against the production build. Set `PLAY_URL` to a local Docker URL to check that deployment directly.

Route generation and saved-route validation run in a reusable Web Worker. If workers are blocked, the same deterministic generator yields in short tasks using `scheduler.yield()` where supported and a timer fallback elsewhere. Startup and fresh routes paint loading feedback before setup; input is held until the board is ready. Undo reuses existing bus meshes instead of rebuilding them. A settled board stops drawing until movement or highlighting requires another frame. Lost graphics contexts offer a reload action and save the route when storage is available.

The responsiveness tests also exercise touch press feedback, finger jitter, cancelled gestures, immediate retry after a blocker leaves, worker failures, and repeated undo with CPU throttling. See [the performance review](docs/performance-review.md) for findings and measurement limits.

## Saved progress and offline play

Active routes, completed routes, best move counts, sound, and speed are stored in this browser's localStorage under `bus-jam-v1` (schema version 7; earlier `bus-bloom-v1` saves are imported automatically). Saves are checked before loading; interrupted bus animations settle into their destination on reload. Upgrading from an earlier layout restarts the active route with randomized feeder lines and a smaller middle group while preserving completed routes, sound, and speed preferences. Private browsing, clearing site data, or changing origins can remove or separate progress. Storage failure does not block play.

Production builds generate a manifest and a versioned Workbox service worker. After the first complete online load, the game works offline, including its 3D renderer, fonts, icons, and later levels. Uninstalled visitors get an install popup once per browser session, after installation detection completes and other dialogs close. Not now keeps the game available; the lower-left Install button remains available in browser mode. It triggers a supported browser install prompt or opens installation help; canceling leaves a usable retry/help action. Installed app display mode, the browser install event, and supported related-app detection hide the button after installation. Installation and service workers need HTTPS, or localhost. Available updates open a popup with Update now and Later. Popups pause gameplay. Progress is saved before reloading; a failed save keeps the route open and allows a retry. Deferred updates remain available in Settings. The app checks for updates on startup, browser focus, reconnect, and every five minutes while visible.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` tests, builds, checks the production app in desktop/mobile Chromium, and deploys on pushes to `main`.

1. Push this project to a GitHub repository with a `main` branch.
2. In the repository's Settings → Pages, set Source to **GitHub Actions**.
3. Run **Deploy Bus Jam to GitHub Pages**, or push to `main`.

The workflow reads the Pages base path automatically, supporting both a repository subdirectory and a root user site. For other static hosting, upload `dist/`. Set `BASE_PATH` before building to target a specific subpath; the default is relative URLs.

The published game is https://chrisawad.github.io/Bus-Game/. This workspace does not use ChatGPT Sites. Plain HTTP LAN or Tailscale URLs support play, but use the HTTPS Pages address for installation and offline support.

## Docker / Nginx

```sh
docker build -t bus-jam:local .
docker run --rm -p 8088:80 bus-jam:local
# or
docker compose up --build -d
```

Open http://localhost:8088. Set BUS_JAM_PORT to choose another Compose host port. The multistage image builds with Node/pnpm and serves the static output from Nginx. `/healthz` supplies a health check. Hashed assets use immutable caching; HTML, the manifest, and service-worker files revalidate. Terminate HTTPS at your reverse proxy for installation/offline support on a remote host.

## Repository skill

Google's Modern Web Guidance is tracked through the CLI-generated `skills-lock.json`; installed skill files are local and ignored by Git. Follow `AGENTS.md`, or restore from this repository's root with:

```sh
npx --yes skills@latest install --agent codex
```

Upstream: https://github.com/GoogleChrome/modern-web-guidance.
