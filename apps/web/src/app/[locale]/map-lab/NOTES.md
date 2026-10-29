# Map lab: a readable map for MHaV

`/hu/map-lab` (noindex, not linked). The real map with live trains, plus a panel for the basemap, rail network, station names, markers, focus and filters. The state lives in the URL, for example
`/hu/map-lab?base=transit&rail=ours&labels=ours&markers=calm&focus=1&view=bp&theme=dark`.
Add `&panel=0` to hide the panel and `&vehicleId=…` to open a train.

## What is wrong today (measured)

| Pair (vs land) | Light | Dark |
|---|---|---|
| Country border | 1.83:1 | **1.51:1** |
| Water | 1.48:1 | **1.02:1** (water `#1B1B1D` on land `#1A1D22`: invisible) |
| Rail, ORM main line as rendered | 2.09:1 (orange) | **1.57:1** (`#403D3A`, sampled) |
| Place names | 18:1 (pure black) | 2.90:1 (`#656565`) |

- **Dark mode has no figure–ground.** We patch OpenFreeMap Dark's land to `#1A1D22`, but its water (`rgb 27,27,29`) and borders (`hsl 0 0% 23%`) were designed for `#0C0C0C`. So the Duna, Balaton and the borders disappear.
- **The ORM raster competes with the data.** It draws main lines orange (`#FF8100`), branches yellow (`#C4B600`), plus pink/lilac trams and blue text. Those are our delay hues. In dark mode we invert and desaturate it into a brown smear (1.6:1).
- **It also carries noise a passenger never needs:** yards, sidings, km posts, signal-box codes ("SL"), and station names in a second font and colour, beside the basemap's own place names.

## Research (short)

- **Apple HIG Maps** offers a "muted" desaturated style for maps whose content "you want to stand out". It also says to cluster, add detail with zoom, and give custom marks a thin stroke ([HIG Maps](https://developer.apple.com/design/human-interface-guidelines/maps), [MapKit muted](https://developer.apple.com/documentation/mapkit/mkstandardmapconfiguration/emphasisstyle-swift.enum/muted)).
- **Google Maps Platform** keeps `transit.line` and `transit.station.rail` as their own style features, and has a `simplified` visibility that turns roads into thin lines without casing ([style reference](https://developers.google.com/maps/documentation/javascript/style-reference)). Dark is chosen at creation, as a separate scheme ([colorScheme](https://developers.google.com/maps/documentation/javascript/mapcolorscheme)).
- **Mapbox Light**, "a neutral backdrop for overlaying data visualizations" ([docs](https://docs.mapbox.com/map-styles/reference/light.md)), and **Esri Dark Gray Canvas**, "draws attention to your thematic content" ([item](https://elevation3d.arcgis.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/0/iteminfo)), both follow the same rule: the basemap recedes and the data carries the colour.
- **SBB with geOps** draws a generalised rail network under live trains with delays ([geOps Live Map](https://geops.com/en/solution/livemap), [SBB map](https://geops.com/en/solution/sbb-map-and-stations-plans)). DB Zugradar and ÖBB Scotty show a quiet network with tap-for-delay ([digital-geography](https://digital-geography.com/vehicle-tracking-now-also-available-for-the-trains-of-the-german-db/)). I couldn't verify their colour legends. I found no first-party Citymapper source, so it isn't cited.
- **Axis Maps on hierarchy:** "use colors that are noticeably different from the background, especially in terms of lightness" ([guide](https://www.axismaps.com/guide/visual-hierarchy)). **WCAG 1.4.11** asks 3:1 for meaningful graphics ([W3C](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)).
- **Label density by rank:** OpenMapTiles `rank` exists "to limit the density of labels" ([schema](https://openmaptiles.org/schema/)).

Rules taken for this map:
1. Only trains carry hue.
2. The network is one neutral grey with ≥ 3:1, ranked by width, not colour.
3. Borders and water must read in both themes.
4. Detail comes in with zoom: lines, then main stations, then the rest.
5. Dark mode is tuned on its own palette, not inverted.

## Rail data: what exists

| Source | Rail from zoom | Main vs branch | Stations | Usable from our web? |
|---|---|---|---|---|
| OpenFreeMap / OpenMapTiles `transportation` | **z8** (none at country zoom) | no (only `service` yard/siding/spur, subclass rail/light_rail/…; HÉV is `transit/light_rail` from z11) | `poi` class railway, **z12+** | yes (CORS, free, no key) |
| Protomaps v4 `roads` kind=rail | **z11** | no (`kind_detail`, `service`) | `pois` kind=station, z11–14 | yes, self-hosted (pmtiles) |
| OpenRailwayMap vector (openrailwaymap.app, Martin) | z0 (low), z7+ high | **yes** (`usage` main/branch, `passenger_lines`, `feature`) | yes | **no**: no CORS header, 403s on repeated tile requests, and its [usage policy](https://github.com/hiddewie/OpenRailwayMap-vector/blob/master/USAGE.md) forbids bulk download. Self-hosting means osm2pgsql + Martin. Data ODbL, attribution required. |
| **Ours**: train route polylines (OTP pattern geometry) | all zooms | **yes**, trains per piece | ours, trains/day from history | yes, our API |

No off-the-shelf vector source gives a ranked passenger network at country zoom. So the lab's "Ours" layer has two parts:
- **network**: the route polylines of live trains, deduped, with each piece weighted by how many distinct trains run on it. There are three widths: ≥ 10 trains (main), 4–9, and 1–3 (branch/HÉV). This is the only rail data at z5–8, and it only draws lines with passenger service: no freight, disused lines or yards.
- **track**: OpenFreeMap's class=rail without `service`, as a hairline from z8, for the remaining physical track.
- **stations**: our ~1,200 stations with trains/day from the history table, in tiers. ≥ 40/day are named from z7, ≥ 20 from z8.5, ≥ 8 from z10, the rest from z11.5, and HÉV from z12.5. Budapest termini show short names from z10 ("Keleti").

The lab's `network.json` is a snapshot of the feed (282 polylines, 157 KB gzipped) and `stations.json` comes from the local DB. Both are fixtures. In production the API builds both daily (see plan).

## What we can style

Everything in a MapLibre style is ours: colours, widths, which features draw at which zoom, label fonts, sizes, halos, density and priority. Over OpenFreeMap (OpenMapTiles schema) or Protomaps vectors, we write our own style JSON. The lab's Quiet and Transit styles are about 300 lines of TypeScript (`styles.ts`).

We cannot change the data in the tiles: no main/branch on rail, rail missing below z8 in OFM and below z11 in Protomaps, and POI ranks that are OSM's.

Fonts: glyphs are SDF PBFs, and the lab uses OpenFreeMap's Noto Sans Regular/Bold/Italic. Inter (our UI font) on the map needs Inter glyph PBFs: generate them once (e.g. maplibre font-maker), roughly 0.2–1 MB for Latin + Latin Extended, and host them static. No sprite is needed: we draw no POI icons, and markers are already generated at runtime.

## Variants (all in light and dark)

- **Today**: OpenFreeMap Positron/Dark plus our patches, with the ORM raster.
- **A · Quiet**: our style over OpenFreeMap. Land is the token map colour, urban areas are one step off it, water is a clear blue-grey (dark `#1E3A50`), and parks are only from z9. The country border is a dashed ink line over a soft halo (5.2:1 / 6.4:1). Roads are white or near-land lines with casing only from z11, and there are no road names, shields or POIs. Place names come in three ink steps (city bold).
- **B · Transit (recommended)**: as A, but roads drop further (no secondary below z11, no minor below z13), places sit one step back, and the network is stronger. Station names from our list beat place names in label collisions.
- **C · Protomaps**: Protomaps' own layer set (BSD-3), recoloured from the same palette, with shields, sub-places, oneways and its own rail removed, over a self-hosted Hungary extract. It looks close to A. It is usable and fully self-hostable, but with more layers (102 vs 59) and no rail data advantage.

Markers: "Calm on time" shrinks on-time dots to 5 px with a land-coloured edge (z < 9) and to 70 % at z ≥ 9, and tightens clusters (radius 12 vs 22). Late trains become the only strong marks. On time stays blue.

**Focus**: selecting a train fades the other trains to 25 % (today 60 %) and the network and station dots to 30 %, hides station names (the route's stops name themselves), and draws the route at 5 px over a land-coloured casing.

**Filters**: "Only late trains" (+5 and over) and "Only followed trains". The selected train always stays.

## Contrast (vs land; text targets 4.5, graphics 3)

| | Today L | A L | B L | Today D | A D | B D |
|---|---|---|---|---|---|---|
| Main line | 2.09 | 4.11 | 5.20 | 1.57 | 4.25 | 4.92 |
| Branch line | ~1.8 | 3.20 | 3.38 | ~1.3 | 3.15 | 3.38 |
| Border | 1.83 | 5.20 | 5.20 | 1.51 | 6.42 | 6.42 |
| Water (area) | 1.48 | 1.42 | 1.42 | 1.02 | 1.43 | 1.43 |
| City label | 18.3 | 11.7 | 8.96 | 2.90 | 11.9 | 8.65 |
| Village label | 18.3 | 4.75 | 4.75 | 2.90 | 5.40 | 5.40 |
| Station label | — (raster) | 11.7 | 11.7 | — | 11.9 | 11.9 |
| On-time marker | 4.48 | 4.48 | 4.48 | 6.83 | 6.83 | 6.83 |
| +60 marker | 5.17 | 5.17 | 5.17 | 4.58 | 4.58 | 4.58 |

The panel shows the same table live for the chosen basemap and theme. Yellow (+5) markers are 1.46:1 on light land by design. Their 1.5 px ink outline carries the 3:1, as the token docs already state.

The network is deliberately kept under the markers' visual weight. In light mode the main line (5.2:1) is a grey, so the blue on-time marker (4.48:1) still wins on hue and size.

## Performance (cold load, 1440×900, light, headless SwiftShader)

| View | Variant | Basemap tiles | Rail | Glyphs | Style layers | To idle |
|---|---|---|---|---|---|---|
| Hungary | Today | OFM 2.08 MB / 9 | ORM raster 664 KB / 24 | 342 KB | 84 | 2.0 s |
| Hungary | B Transit | OFM 2.08 MB / 10 | network + stations 174 KB (once) | 147 KB | 59 | ≤ 0.7 s |
| Hungary | C Protomaps | PM 2.50 MB / 9 | same | 402 KB | 102 | 1.6 s |
| Budapest | Today | OFM 448 KB / 7 | ORM 336 KB / 20 | 193 KB | 84 | 0.9 s |
| Budapest | B Transit | OFM 448 KB | OFM tiles reused (HTTP cache) | 204 KB | 59 | ≤ 0.7 s |

Dropping the raster saves 0.3–0.7 MB and 20–24 requests per view, and every pan stops costing raster tiles. The network GeoJSON is a one-time 157 KB that later views reuse. Our styles draw about 30 % fewer layers than Positron, and Protomaps' layer set renders slowest (median frame 67 ms vs 17–33 ms under SwiftShader; a relative figure only). A z7 Protomaps tile is 252 KB gzipped vs 219 KB for OFM.

## Markers: do we need all of them?

Today a train can be a dot, a plain circle, a "+N" chip, a square (HÉV) or a pointed pill (tram-train), in five sizes, with arrows, stars and count bubbles.

- **The exact delay of trains you didn't open is mostly noise.** At a glance you need the band (on time, a few minutes, badly late) and where it is. The minute matters for the train you care about (selected or followed) or the station you're zoomed into. Apple's HIG says to cluster and add detail with zoom, and the design's own MacStories source says extra information should "show up as needed".
- **Shape for vehicle type costs more than it gives on a map.** HÉV and tram-trains run on their own lines, and their type is in the sheet and tooltip. This changes the design system rule "Alak = járműtípus" (shape = vehicle type), so it's a design decision.
- **Proposed "Simple" markers:** one round mark for every vehicle at every zoom.
  - Colour is the delay band.
  - Late is one size step bigger: 11 / 13 px at country zoom, 16 / 18 px close in. That keeps a cue that isn't colour (WCAG 1.4.1).
  - "+N" appears only from z10, as text beside the dot, and only where it fits, biggest delays first.
  - No arrows. The selected and followed trains keep the full chip.
- **"Calm"** does the opposite: on-time trains shrink to 5 px. You found that too small, and Simple replaces it.

The panel's Markers row switches between Today, Calm and Simple.

## Recommendation

Ship **B · Transit + our network + our station names + Simple markers + focus**, in both themes, with the light palette from the design's map mock and the hand-tuned dark one above. Drop ORM from the default view (keep it as an opt-in "Rail infrastructure" setting if anyone uses it). Stay on OpenFreeMap vectors for now. Protomaps is the fallback if we want full self-hosting; nothing in the style ties us to one or the other.

## Implementation plan (about 4–6 days)

1. **API, about 1.5 d.** A daily task builds `GET /v1/network`: OTP pattern geometries of the rail feed, deduped, with trains/day per segment (merge on a grid, as the lab does). It also builds `GET /v1/stations/map`: id, name, lat, lon, trains/day, tier, from the station index plus history. Both are static JSON with long cache and an ETag (about 150 KB and 25 KB gzipped). Keep the upstream calls once a day.
2. **Web style, about 1.5 d.** Move `styles.ts`/`palettes.ts` into `components/map/` and put the palette in `packages/core/tokens` (`MAP` roles next to `COLORS`), so the Expo app can share it. Replace `STYLE_URLS` and the Positron patches with our style object. Update basemapStyle tests.
3. **Layers, about 1 d.** Add the network, track and stations layers in `MapComponent` (from `LabLayers`), focus dimming, and calm on-time markers (marker tokens: on-time dot 5 px). Retire `RAILWAY_NAMES_MIN_ZOOM` and the raster paint. Make the Settings "railway overlay" switch either "Rail infrastructure (OpenRailwayMap)" or remove it.
4. **Mobile, about 1 d.** `apps/mobile` uses the same raster: switch it to the same style JSON (MapLibre Native reads it) and the same API files.
5. **QA, about 0.5 d.** Old-vs-new inventory (the parity rule), contrast check in tests (core token test style), and screenshots at 360–1440, light and dark.

Optional: Inter glyphs (0.5 d), and "only late" / "only followed" as real map filters in Settings.

## Licences and attribution

- **OpenStreetMap (ODbL)**: "© OpenStreetMap" stays, as today.
- **OpenFreeMap**: free, no key, no limits stated. It asks for attribution of OpenFreeMap and OpenMapTiles, which the full credit list already has.
- **OpenRailwayMap**: once the raster is not on by default, its credit only shows when the overlay is on. `MapAttribution` already does this (`showRailway`), so no change is needed beyond the default.
- **Our network** is derived from MÁV timetable data via OTP, so no OSM attribution is needed for it. The station list is the same source.
- **Protomaps** (if chosen): tiles are an ODbL Produced Work with OSM attribution, and the style package is BSD-3. Credit "Protomaps". Hotlinking the daily builds is discouraged, so copy an extract to our own storage.

## Hosting and tile-cache changes

- **Recommended path:** none required. The basemap stays on `tiles.openfreemap.org` (already direct, not via `tc.megisholavonat.info`), and the network and station files come from our API. The `/orm/` proxy is only needed for the opt-in overlay.
- **Optional, cache OFM through our tile cache:** add `~^/ofm/ → tiles.openfreemap.org` to the nginx map and point the style's source URL there. Caching works because OFM sends `max-age` of 10 years on versioned tile URLs. Also move the cache from `emptyDir` to a PVC: today every pod restart empties the 5 GiB cache.
- **Optional, Protomaps:** a Hungary + borders extract to z13 is **367 MB** (z14: 693 MB, z12: 189 MB), made with `pmtiles extract --bbox=15.6,45.5,23.2,48.9 --maxzoom=13`. Serve it with `pmtiles serve` (or Caddy/nginx range requests + the pmtiles protocol) behind the tile cache, and refresh it monthly.
