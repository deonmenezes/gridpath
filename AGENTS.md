# GridPath (Web)

The fastest way to get clean energy: type a property address and instantly see where the grid is, what it costs to connect, how long it takes, and start the application. All numbers derive transparently from one measured input — distance to the nearest grid infrastructure.

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript
- **Map:** Leaflet + Stamen Watercolor tiles + animated connector line
- **Geo math:** Turf.js (`nearestPointOnLine`, point distance)
- **Grid data:** OpenStreetMap `power=*` via Overpass API (server-side proxied)
- **Geocoding:** Nominatim (OSM), proxied server-side
- **AI:** Anthropic Claude SDK (`@anthropic-ai/sdk`)
- **Styling:** Tailwind CSS (inferred from project structure)
- **Deployment:** Vercel (standard Next.js)

## Setup

```bash
npm install
```

No API keys required for the core geo/map functionality (Nominatim and Overpass are public). The Anthropic SDK is present — set `ANTHROPIC_API_KEY` in `.env.local` if AI features are used.

## Build / Run / Test

```bash
npm run dev      # local development server (http://localhost:3000)
npm run build    # production build
npm run start    # start production server
npm run lint     # ESLint
```

Demo mode: visit `/?demo=1` to auto-load a locked demo address (Healdsburg, California).

## Project Structure

```
src/                  Next.js app source
  app/                App Router pages and layouts
  components/         React components
public/               Static assets
next.config.mjs       Next.js configuration
tsconfig.json         TypeScript config
package.json          Scripts and dependencies
```

## Architecture & Key Files

- **Geocoding + autocomplete:** Nominatim requests are proxied server-side to avoid CORS and rate-limit issues.
- **Grid lookup:** Overpass API query for `power=*` nodes/ways near the geocoded point.
- **Distance:** Turf.js — `nearestPointOnLine` for power lines, point distance for poles. Prefers existing pole/transformer within ~50 ft of the nearest line.
- **Cost model:** `base + (ft × rate) + transformer? + meter drop`. Transparent formula shown to the user.
- **Timeline:** Distance buckets (4–6 wk / 6–12 wk / 3–6 mo) + 2 wk review.
- **Map:** Leaflet with Stamen Watercolor tiles; animated SVG connector line drawn from property to connection point.

## Conventions & Notes for Agents

- All geo queries (Nominatim, Overpass) must be proxied through Next.js API routes — do not call them directly from the client.
- The locked demo region is Healdsburg, California (well-mapped OSM grid data). Other regions may have sparse grid data.
- `@anthropic-ai/sdk` is a dependency — if adding AI features, consult the Claude API skill before implementing.
- TypeScript strict mode is on (`tsconfig.json`). Avoid `any` casts.
- No test suite present. Verify changes with `npm run dev` and `npm run build`.
