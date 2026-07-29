# SYBNB Map Capsule

An **isolated, platform-agnostic** map module. Free forever — OpenStreetMap raster
tiles via bundled Leaflet: **no API key, no billing, no card**.

## Isolation contract

This folder depends on **only `leaflet` + `react`**. It must never import:

- platform types (`PlatformListing`, …)
- i18n / translations
- currency helpers
- engine / backend code

That is what makes it portable. Anything platform-specific (turning a listing into
pins, formatting a price label, translating a popup) is done **outside** the capsule
by an *adapter* that then passes plain values in.

## Reusing it in another platform (e.g. STR Canada)

1. Copy this whole folder (`src/shared/maps/capsule/`) into the other platform.
2. `npm install leaflet` (and `-D @types/leaflet`).
3. Write a small adapter that converts that platform's listing type into `MapPin[]`
   and renders `<PinsMap>` / `<LocationMap>`. See `modules/search/ResultsMap.tsx`
   for the STR-Syria adapter — copy and adjust it.
4. Optionally pass `defaultCenter` (e.g. Toronto) and a custom `tiles` config.

Nothing inside the capsule changes between platforms.

## Public API (`index.ts`)

| Export | What it is |
| --- | --- |
| `PinsMap` | Multi-pin map; one marker per point, auto-fits bounds. |
| `LocationMap` | Single-marker map for one place. |
| `directionsUrl(lat, lng)` | Turn-by-turn link — opens the phone's native GPS app. |
| `mapViewUrl(lat, lng)` | "Show this point" link on OpenStreetMap. |
| `hasMapCoords(lat, lng)` | Guard for a real/finite coordinate pair. |
| `OSM_TILES` / `DEFAULT_CENTER` | Defaults you can override per platform. |
| `MapPin` / `MapCoords` / `TileConfig` | Types. |

## Directions / GPS

`directionsUrl` returns a plain maps link. Opening it is **free** (not the paid
Maps API). On a phone the OS routes it into the native maps app, which uses the
device's real GPS + live traffic for turn-by-turn navigation to the destination.
