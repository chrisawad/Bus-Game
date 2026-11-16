# Bus Bloom

A cozy 3D bus traffic puzzle, built with TypeScript, Three.js/WebGL, Tailwind CSS, Vite, and pnpm. No login, backend, or external runtime assets.

## Play

- Click or tap a bus. It drives **forward along its roof arrow**.
- A blocked bus animates a bump, then returns to its original position.
- A clear bus travels around the depot border to one of **five unlocked stops**.
- Two passenger lines take alternate turns filling the shared queue.
- Only the **first passenger** can board, and only a bus of their color.
- A full bus leaves and releases its stop. **Every bus gone = you win.**
- If all stops fill without a match for the front passenger, undo a dispatch or restart.
- Undo, hints, optional synthesized sound, 2× speed, and keyboard controls are included.

Layouts are generated deterministically in reverse solution order, so every level has a solution. Passenger totals exactly match the bus capacities. The game provides continuing routes with more colors as you advance.

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

The browser tests exercise actual canvas picking, collisions, undo, full-level completion, persistence, mobile layout, and offline reload. They run against the production build.

## Saved progress and offline play

Active routes, completed routes, best move counts, sound, and speed are stored in this browser's localStorage under `bus-bloom-v1`. Saves are checked before loading; interrupted bus animations settle into their destination on reload. Private browsing, clearing site data, or changing origins can remove or separate progress. Storage failure does not block play.

Production builds generate a manifest and a versioned Workbox service worker. After the first complete online load, the game works offline, including its 3D renderer, fonts, icons, and later levels. Install from your browser's installation menu or the in-game Install button when supported. Installation and service workers need HTTPS, or localhost. Updates offer a restart button so a new build does not interrupt your route.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` tests, builds, checks the production app in desktop/mobile Chromium, and deploys on pushes to `main`.

1. Push this project to a GitHub repository with a `main` branch.
2. In the repository's Settings → Pages, set Source to **GitHub Actions**.
3. Run **Deploy Bus Bloom to GitHub Pages**, or push to `main`.

The workflow reads the Pages base path automatically, supporting both a repository subdirectory and a root user site. For other static hosting, upload `dist/`. Set `BASE_PATH` before building to target a specific subpath; the default is relative URLs.

This workspace does not need a ChatGPT Sites project or authentication. No deployment is created until the repository is pushed and Pages is enabled.

## Docker / Nginx

```sh
docker build -t bus-bloom:local .
docker run --rm -p 8088:80 bus-bloom:local
# or
docker compose up --build -d
```

Open http://localhost:8088. Set BUS_BLOOM_PORT to choose another Compose host port. The multistage image builds with Node/pnpm and serves the static output from Nginx. `/healthz` supplies a health check. Hashed assets use immutable caching; HTML, the manifest, and service-worker files revalidate. Terminate HTTPS at your reverse proxy for installation/offline support on a remote host.

## Repository skill

Google's Modern Web Guidance is tracked through the CLI-generated `skills-lock.json`; installed skill files are local and ignored by Git. Follow `AGENTS.md`, or restore from this repository's root with:

```sh
npx --yes skills@latest install --agent codex
```

Upstream: https://github.com/GoogleChrome/modern-web-guidance.
