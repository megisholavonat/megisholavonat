"use client";
import {
    Layer,
    Map as MapLibreMap,
    type MapMouseEvent,
    type MapRef,
    Marker,
    Popup,
    Source,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import polyline from "@mapbox/polyline";
import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { withDetails } from "@megisholavonat/core/display";
import {
    MAP_DATA_PATHS,
    MAP_FONTS,
    NETWORK_SOURCE,
    networkLayer,
    STATIONS_SOURCE,
    stationLayers,
} from "@megisholavonat/core/mapStyle";
import {
    COLORS,
    type ColorScheme,
    DELAY_SCALE,
    MARKER,
    MOTION,
    STALE_COLORS,
} from "@megisholavonat/core/tokens";
import {
    MAP_DIRECTION_ARROW,
    MAP_FOCUS,
    MAP_MARKS,
    MAP_PALETTE,
    MAP_STATION_MARK,
    markSizeAt,
} from "@megisholavonat/core/tokens/map";
import type { VehicleState } from "@megisholavonat/core/VehicleTracker";
import {
    easeOut,
    FRAME_INTERVAL_MS,
    type Glide,
    hasMoved,
    type Shown,
    syncTrackers,
    vehicleFrame,
} from "@megisholavonat/core/vehicleMotion";
import type {
    Feature,
    FeatureCollection,
    GeoJSON as GeoJsonType,
    Point,
} from "geojson";
import {
    type ExpressionSpecification,
    type GeoJSONSource,
    type Map as MaplibreMap,
    type Marker as MaplibreMarker,
    type Popup as MaplibrePopup,
    setWorkerUrl,
} from "maplibre-gl";
import { useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import {
    memo,
    type Ref,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    basemapTransform,
    mapStyle,
    SLOTS,
} from "@/components/map/basemapStyle";
import { MapAttribution } from "@/components/map/MapAttribution";
import { MapControls } from "@/components/map/MapControls";
import {
    arrowImageId,
    CLUSTER_SIZE,
    clusterImageId,
    followImageId,
    labelSize,
    type MarkerLevel,
    markBody,
    markerImage,
    PILL_PADDING_X,
    pillHeight,
    prewarmMarkerImages,
    stationImageId,
} from "@/components/map/markerImages";
import { markerDisplay } from "@/components/map/markerState";
import { TrainTooltip } from "@/components/map/TrainTooltip";
import { warmUpShaders } from "@/components/map/warmUpShaders";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { useTheme } from "@/components/ui/ThemeProvider";
import { useSettings } from "@/hooks/useSettings";
import { trainNumber } from "@/lib/train";
import { LAYER_IDS } from "@/util/constants";
import { OVERLAYS } from "@/util/mapConfigs";

// maplibre-gl 6 can't find its worker from inside a bundle; point it at the
// copy Next.js emits as a hashed asset.
setWorkerUrl(
    new URL(
        "maplibre-gl/dist/maplibre-gl-worker.mjs",
        import.meta.url,
    ).toString(),
);

const BASEMAP_MISSING_ICON_PX = 16;

function createTransparentBasemapIcon(): ImageData {
    return new ImageData(
        new Uint8ClampedArray(
            BASEMAP_MISSING_ICON_PX * BASEMAP_MISSING_ICON_PX * 4,
        ),
        BASEMAP_MISSING_ICON_PX,
        BASEMAP_MISSING_ICON_PX,
    );
}

/** Budget of one slice of route decoding, well inside a frame */
const ROUTE_SLICE_MS = 8;
/** Selection ring and label fade/scale in. */
const SELECT_MS = 180;
/** The ring starts this many px wider and settles onto the marker. */
const RING_GROW_PX = 4;
/** Other markers fade to 60 % over this long. */
const FADE_MS = MOTION.delayChange.duration;
/** Taps this close (px) to a marker select it: a 44 px touch target. */
const HIT_RADIUS = MARKER.hitArea / 2;
/** How often stale minutes and states are re-judged against the clock. */
const CLOCK_TICK_MS = 30_000;

/**
 * From this zoom the railway overlay (a raster, its z11 tiles picked from
 * zoom 10.5 on) writes out station names;
 * below it only codes ("SL"). A drawn route's stop names show below it
 * only, so a station is never named twice in the same spot.
 */
const RAILWAY_NAMES_MIN_ZOOM = 10.5;
/** No limit: without the overlay the route's stop names always show */
const NO_MAX_ZOOM = 24;

/**
 * Shape = vehicle type: round trains, square HÉV, pointed tram-trains. Set to
 * false to draw every vehicle round.
 */
const VEHICLE_SHAPES = true;

// Overlapping trains merge into a count bubble up to this zoom
const CLUSTER_RADIUS = MAP_MARKS.clusterRadius;
const CLUSTER_MAX_ZOOM = 15;
/** A cluster whose trains are still this close (px) when zoomed in lists them. */
const CLUSTER_LIST_SPREAD_PX = 36;
const CLUSTER_LIST_MAX = 30;

const SOURCES = {
    base: "vehicles-source",
    pinned: "vehicles-pinned-source",
    selected: "vehicles-selected-source",
} as const;
type Group = keyof typeof SOURCES;

const PINNED = (id: string) => `${id}-pinned`;
/** "+N" beside unselected late trains, close in */
const DELAY_TEXT = "marker-delay";
const SEL = {
    dot: "marker-sel-dot",
    dotRing: "marker-sel-dot-ring",
    heading: "marker-sel-heading",
    plain: "marker-sel-plain",
    pill: "marker-sel-pill",
    plainRing: "marker-sel-plain-ring",
    pillRing: "marker-sel-pill-ring",
    follow: "marker-sel-follow",
} as const;
const CLUSTER = { bubble: "marker-cluster" } as const;
/**
 * Invisible copies of the unselected marks and bubbles, under the station
 * names: they hold the trains' room for the "+N" numbers only (see
 * baseMarkerLayers)
 */
const ROOM = {
    marks: "marker-dot-room",
    bubbles: "marker-cluster-room",
} as const;

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

const TOOLTIP_OFFSET: [number, number] = [0, -14];

// Memoized so MapComponent re-renders don't reset the popup to `info`'s
// coordinates; the animation loop moves it through `popupRef`.
const HoverTooltip = memo(function HoverTooltip({
    info,
    popupRef,
}: {
    info: TrainFeatureProperties;
    popupRef: Ref<MaplibrePopup>;
}) {
    return (
        <Popup
            ref={popupRef}
            longitude={info.lon}
            latitude={info.lat}
            offset={TOOLTIP_OFFSET}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            className="vehicle-tooltip"
        >
            <TrainTooltip featureProperties={info} />
        </Popup>
    );
});

/** Ink label above the selected train: route glyph, number (and speed). */
const SelectedLabel = memo(function SelectedLabel({
    info,
    level,
    markerRef,
    showSpeed,
}: {
    info: TrainFeatureProperties;
    level: MarkerLevel;
    markerRef: Ref<MaplibreMarker>;
    showSpeed: boolean;
}) {
    // Clear of the ring and of the direction arrow when it points up
    const offsetY = -(
        pillHeight(level) / 2 +
        RING_REACH +
        MAP_DIRECTION_ARROW.gap +
        MAP_DIRECTION_ARROW.height +
        MAP_DIRECTION_ARROW.halo
    );
    const speed = Math.round((info.speed ?? 0) * 3.6);
    return (
        <Marker
            ref={markerRef}
            longitude={info.lon}
            latitude={info.lat}
            anchor="bottom"
            offset={[0, offsetY]}
            style={{ pointerEvents: "none" }}
        >
            {/* Keyed so the label pops in again for every new selection */}
            <div
                key={info.vehicleId}
                className="flex origin-bottom animate-in items-center gap-1 rounded-md bg-action px-1.5 py-0.5 text-caption font-bold whitespace-nowrap text-on-action shadow-sm fade-in-0 zoom-in-90 slide-in-from-bottom-1 duration-180 ease-out motion-reduce:animate-none"
            >
                <RouteGlyph routeShortName={info.routeShortName} />
                <span className="tnum">
                    {trainNumber(info.tripShortName)}
                    {showSpeed && speed > 0 ? ` · ${speed} km/h` : ""}
                </span>
            </div>
        </Marker>
    );
});

/** Trains sharing a spot, listed from their cluster. */
function ClusterList({
    list,
    onSelect,
    onClose,
}: {
    list: ClusterListState;
    onSelect: (vehicleId: string) => void;
    onClose: () => void;
}) {
    const t = useTranslations("Map");
    return (
        <Popup
            longitude={list.lon}
            latitude={list.lat}
            offset={TOOLTIP_OFFSET}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            maxWidth="none"
            className="vehicle-tooltip cluster-list"
        >
            <div
                role="dialog"
                aria-label={t("cluster", { count: list.trains.length })}
                className="flex max-h-[min(18rem,50vh)] min-w-48 flex-col overflow-y-auto overscroll-contain"
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        e.stopPropagation();
                        onClose();
                    }
                }}
            >
                <p className="px-2 pt-1 pb-0.5 text-caption text-ink-2">
                    {t("cluster", { count: list.trains.length })}
                </p>
                {list.trains.map((train) => (
                    <button
                        key={train.vehicleId}
                        type="button"
                        className="flex min-h-11 cursor-pointer items-center rounded-sm px-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                        onClick={() => onSelect(train.vehicleId)}
                    >
                        <TrainTooltip featureProperties={train} />
                    </button>
                ))}
            </div>
        </Popup>
    );
}

interface ClusterListState {
    lon: number;
    lat: number;
    trains: TrainFeatureProperties[];
}

// The arrow sits outside the marker's selection ring, rotated with the
// heading. `arrowOffset` is the ring's outer edge; offsets are bucketed:
// icon-offset can only pick between literal arrays.
const ARROW_OFFSET_MIN = 12;
const ARROW_OFFSET_MAX = 40;
const ARROW_OFFSET_STEP = 2;
function arrowOffset(extra: number): ExpressionSpecification {
    const cases: (number | ExpressionSpecification)[] = [];
    for (
        let offset = ARROW_OFFSET_MIN;
        offset <= ARROW_OFFSET_MAX;
        offset += ARROW_OFFSET_STEP
    ) {
        cases.push(offset, ["literal", [0, -(offset + extra)]]);
    }
    return [
        "match",
        ["get", "arrowOffset"],
        ...cases,
        ["literal", [0, -(ARROW_OFFSET_MIN + extra)]],
    ] as unknown as ExpressionSpecification;
}
/** The selected train's arrow: its back `gap` px clear of the ring */
const ARROW_OFFSET_SELECTED = arrowOffset(
    MAP_DIRECTION_ARROW.gap + MAP_DIRECTION_ARROW.height / 2,
);
/** From the pill's edge to its selection ring's outer edge */
const RING_REACH =
    MARKER.outlineWidth + MARKER.selected.gap + MARKER.selected.ringWidth;

/**
 * The selection ring at progress `p` (0 → 1): its opacity, and on the z < 9
 * dot its size settling from RING_GROW_PX wider.
 */
function setRingProgress(
    map: MaplibreMap,
    p: number,
    ringRadius: (grow: number) => ExpressionSpecification,
) {
    if (map.getLayer(SEL.plainRing)) {
        map.setPaintProperty(SEL.plainRing, "icon-opacity", p);
    }
    if (map.getLayer(SEL.pillRing)) {
        map.setPaintProperty(SEL.pillRing, "icon-opacity", p);
        map.setPaintProperty(SEL.pillRing, "text-opacity", p);
    }
    if (map.getLayer(SEL.dotRing)) {
        map.setPaintProperty(SEL.dotRing, "circle-stroke-opacity", p);
        map.setPaintProperty(
            SEL.dotRing,
            "circle-radius",
            ringRadius((1 - p) * RING_GROW_PX),
        );
    }
}

// The star of a followed train sits on the marker's top-right edge, bucketed
// the same way: x by the label width, y by the marker height
const FOLLOW_X_MIN = 6;
const FOLLOW_X_MAX = 40;
const FOLLOW_HEIGHTS = [
    ...new Set(
        (["onTime", "slight", "moderate", "severe", "stale"] as const).map(
            pillHeight,
        ),
    ),
];
function followKey(x: number, height: number): string {
    return `${x}:${height}`;
}
const FOLLOW_OFFSET = ((): ExpressionSpecification => {
    const cases: (string | ExpressionSpecification)[] = [];
    for (const height of FOLLOW_HEIGHTS) {
        for (let x = FOLLOW_X_MIN; x <= FOLLOW_X_MAX; x += 2) {
            cases.push(followKey(x, height), [
                "literal",
                [x, -height / 2],
            ] as unknown as ExpressionSpecification);
        }
    }
    return [
        "match",
        ["get", "followKey"],
        ...cases,
        ["literal", [FOLLOW_X_MIN, -MARKER.levels.onTime.height / 2]],
    ] as unknown as ExpressionSpecification;
})();

/** Marker level, shape and label, precomputed per train for the layers. */
function enrich(
    props: TrainFeatureProperties,
    nowS: number,
    followed: boolean,
    group: Group,
): Record<string, unknown> | null {
    const display = markerDisplay(props, nowS);
    if (display.state === "hidden") return null;
    const { level, label } = display;
    // Rough label width, to keep the direction arrow clear of the pill
    const halfWidth = label
        ? (label.length * labelSize(level) * 0.62) / 2 + PILL_PADDING_X
        : MARKER.levels.onTime.height / 2;
    const live = display.state === "live";
    return {
        ...props,
        level,
        group,
        followed,
        followKey: followKey(
            Math.min(
                FOLLOW_X_MAX,
                Math.max(FOLLOW_X_MIN, Math.round((halfWidth + 2) / 2) * 2),
            ),
            pillHeight(level),
        ),
        shape:
            VEHICLE_SHAPES &&
            (props.type === "hev" || props.type === "tramtrain")
                ? props.type
                : "train",
        label,
        arrowOffset: Math.min(
            ARROW_OFFSET_MAX,
            Math.max(
                ARROW_OFFSET_MIN,
                Math.round((halfWidth + RING_REACH) / ARROW_OFFSET_STEP) *
                    ARROW_OFFSET_STEP,
            ),
        ),
        // Bigger delays on top; stale, then inactive trains at the bottom
        sortKey: live
            ? (display.delay ?? 0)
            : display.state === "stale"
              ? -1
              : -2,
    };
}

function byGroup(features: Feature[]): Record<Group, FeatureCollection> {
    const out: Record<Group, Feature[]> = {
        base: [],
        pinned: [],
        selected: [],
    };
    for (const feature of features) {
        out[(feature.properties?.group as Group) ?? "base"].push(feature);
    }
    return {
        base: { type: "FeatureCollection", features: out.base },
        pinned: { type: "FeatureCollection", features: out.pinned },
        selected: { type: "FeatureCollection", features: out.selected },
    };
}

function placeAt(
    info: TrainFeatureProperties,
    shown: ReadonlyMap<string, Shown>,
): TrainFeatureProperties {
    const at = shown.get(info.vehicleId);
    return at ? { ...info, lon: at[0], lat: at[1] } : info;
}

/** The clock in CLOCK_TICK_MS steps, so stale minutes never freeze. */
function useClock(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, []);
    return now;
}

const IS_PLAIN: ExpressionSpecification = [
    "in",
    ["get", "level"],
    ["literal", ["onTime", "inactive"]],
];
const NOT_CLUSTER: ExpressionSpecification = ["!", ["has", "point_count"]];
const HAS_HEADING: ExpressionSpecification = [
    "!",
    ["in", ["get", "level"], ["literal", ["stale", "inactive"]]],
];

/** Zoom stops the marks' size and their "+N" offset are given at */
const MARK_ZOOMS = [6, 10, 12, 13, 16];
/** One size for every vehicle at a zoom (MAP_MARKS.size), scaling the sprite */
const MARK_ICON_SIZE = [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...MAP_MARKS.size.flatMap(([z, d]) => [z, d / MAP_MARKS.spriteSize]),
] as unknown as ExpressionSpecification;
/**
 * From the zoom "+N" appears, marks take part in collision (still always
 * drawn), so a number never covers a mark. Further out they stay out of it.
 * Unselected marks only through their invisible room (ROOM), placed after
 * the station names, so trains draw over a name but never push it away.
 */
const MARK_IGNORE_PLACEMENT = [
    "step",
    ["zoom"],
    true,
    MAP_MARKS.delayTextMinZoom,
    false,
] as unknown as ExpressionSpecification;
const IS_CLUSTER: ExpressionSpecification = ["has", "point_count"];
/** A count bubble's size: larger for bigger piles */
const CLUSTER_ICON_SIZE = [
    "step",
    ["get", "point_count"],
    1,
    10,
    24 / CLUSTER_SIZE,
    50,
    30 / CLUSTER_SIZE,
] as unknown as ExpressionSpecification;
/** Late trains say by how much, stale ones how old their data is */
const HAS_DELAY_TEXT: ExpressionSpecification = [
    "in",
    ["get", "level"],
    ["literal", ["slight", "moderate", "severe", "stale"]],
];
/** Room the mark sprites keep around a body for its outline rings (px) */
const MARK_SPRITE_MARGIN = 4;
/**
 * "+N" just clear of its own mark's collision box (half the sprite, outline
 * room included), in ems: right, left, above or below it, wherever it fits.
 */
const DELAY_TEXT_OFFSET = [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...MARK_ZOOMS.filter((z) => z >= MAP_MARKS.delayTextMinZoom).flatMap(
        (z) => {
            const d = markSizeAt(z);
            const em = (shape: "train" | "hev" | "tramtrain") =>
                (markBody(shape, d).w / 2 +
                    (MARK_SPRITE_MARGIN * d) / MAP_MARKS.spriteSize +
                    MAP_MARKS.delayTextGap) /
                MAP_MARKS.delayTextSize;
            return [
                z,
                [
                    "match",
                    ["get", "shape"],
                    "tramtrain",
                    em("tramtrain"),
                    "hev",
                    em("hev"),
                    em("train"),
                ],
            ];
        },
    ),
] as unknown as ExpressionSpecification;

export interface FlyTarget {
    lon: number;
    lat: number;
    zoom?: number;
    /** Changes on every request, so the same place can be flown to twice */
    key: number;
}

export interface MapInsets {
    bottom: number;
    left: number;
}

/**
 * The theme on <html> before the provider has resolved it: a language
 * switch remounts the provider, but the page keeps its class, so the map is
 * built in the theme on screen rather than in light first
 */
function domTheme(): string | undefined {
    if (typeof document === "undefined") return undefined;
    return document.documentElement.classList.contains("dark")
        ? "dark"
        : undefined;
}

export default function MapComponent({
    trains,
    selectedId,
    followedIds,
    onSelectTrain,
    train,
    station,
    flyTarget,
    insets,
    isDesktop,
    panelOpen = false,
}: {
    trains: TrainFeatureCollection | undefined;
    selectedId: string | null;
    /** Vehicles of followed trains, starred on the map */
    followedIds: ReadonlySet<string>;
    onSelectTrain: (vehicleId: string | null) => void;
    train: VehiclePositionWithDelay | undefined;
    station: Station | null;
    flyTarget: FlyTarget | null;
    insets: MapInsets;
    isDesktop: boolean;
    /** Desktop: a side panel is open, so only the zoom buttons stay */
    panelOpen?: boolean;
}) {
    const settings = useSettings();
    const { resolvedTheme } = useTheme();
    const scheme: ColorScheme =
        (resolvedTheme ?? domTheme()) === "dark" ? "dark" : "light";
    const locale = useLocale();
    const t = useTranslations("Map");
    // The style the map is created with; later themes go through setStyle
    const [initialStyle] = useState(() => ({
        style: mapStyle(scheme, locale),
        transform: basemapTransform(),
    }));
    const mapLocale = useMemo(
        () => ({
            "Map.Title": t("map_title"),
            "Marker.Title": t("marker"),
            "Popup.Close": t("close_popup"),
        }),
        [t],
    );
    const prefersReducedMotion = useReducedMotion() ?? false;
    const animating = settings.animateVehicles && !prefersReducedMotion;
    const nowMs = useClock();
    const mapRef = useRef<MapRef>(null);
    const trackersRef = useRef<Map<string, VehicleState>>(new Map());
    /** The route polyline each tracker was given */
    const routesRef = useRef<Map<string, string>>(new Map());
    /** Where the animation last drew each train: [lon, lat, bearing] */
    const shownRef = useRef<Map<string, Shown>>(new Map());
    const filteredTrainsRef = useRef<FeatureCollection | null>(null);
    const popupRef = useRef<MaplibrePopup>(null);
    const selectedMarkerRef = useRef<MaplibreMarker>(null);
    const lastHoveredIdRef = useRef<string | null>(null);
    const selectedIdRef = useRef(selectedId);
    const [cursor, setCursor] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<TrainFeatureProperties | null>(
        null,
    );
    const [clusterList, setClusterList] = useState<ClusterListState | null>(
        null,
    );
    const [mapLoaded, setMapLoaded] = useState(false);
    const insetsRef = useRef(insets);

    useEffect(() => {
        insetsRef.current = insets;
    }, [insets]);
    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);

    const filteredTrains = useMemo((): FeatureCollection => {
        const nowS = nowMs / 1000;
        const features: Feature[] = [];
        for (const feature of trains?.features ?? []) {
            const props = withDetails(feature.properties, train);
            const shown =
                props.type === "train"
                    ? settings.showTrains
                    : props.type === "tramtrain"
                      ? settings.showTramTrains
                      : props.type === "hev"
                        ? settings.showHev
                        : true;
            if (!shown) continue;
            const followed = followedIds.has(props.vehicleId);
            const group: Group =
                props.vehicleId === selectedId
                    ? "selected"
                    : followed
                      ? "pinned"
                      : "base";
            const enriched = enrich(props, nowS, followed, group);
            if (!enriched) continue;
            features.push({
                type: "Feature",
                geometry: feature.geometry as unknown as Point,
                properties: enriched,
            });
        }
        return { type: "FeatureCollection", features };
    }, [
        trains,
        train,
        nowMs,
        selectedId,
        followedIds,
        settings.showTrains,
        settings.showTramTrains,
        settings.showHev,
    ]);

    const groups = useMemo(
        () => byGroup(filteredTrains.features),
        [filteredTrains],
    );

    const selectedInfo = useMemo(() => {
        if (!selectedId) return null;
        const props = trains?.features.find(
            (f) => f.properties.vehicleId === selectedId,
        )?.properties;
        return props ? withDetails(props, train) : null;
    }, [trains, selectedId, train]);
    const selectedLevel = useMemo(
        () =>
            selectedInfo
                ? markerDisplay(selectedInfo, nowMs / 1000).level
                : "onTime",
        [selectedInfo, nowMs],
    );

    // Fly to a requested place, keeping it clear of the sheet / side panel
    useEffect(() => {
        if (!flyTarget || !mapLoaded) return;
        const map = mapRef.current;
        if (!map) return;
        const { bottom, left } = insetsRef.current;
        map.flyTo({
            center: [flyTarget.lon, flyTarget.lat],
            zoom: Math.max(map.getZoom(), flyTarget.zoom ?? 13),
            duration: prefersReducedMotion ? 0 : 1600,
            padding: { top: 0, right: 0, bottom, left },
        });
    }, [flyTarget, mapLoaded, prefersReducedMotion]);

    useEffect(() => {
        filteredTrainsRef.current = filteredTrains;
    }, [filteredTrains]);

    useEffect(() => {
        if (!trains) return;

        // New routes, decoded and measured in slices after this pass: a
        // feed holds hundreds of long routes, too much for one task
        const pending = syncTrackers(
            trackersRef.current,
            routesRef.current,
            trains.features.map((f) => f.properties),
        );

        // Until its route is in, a train stays where the feed puts it
        let timer: ReturnType<typeof setTimeout> | null = null;
        let next = 0;
        const slice = () => {
            timer = null;
            const until = performance.now() + ROUTE_SLICE_MS;
            while (next < pending.length && performance.now() < until) {
                pending[next++]();
            }
            if (next < pending.length) timer = setTimeout(slice, 0);
        };
        if (pending.length) timer = setTimeout(slice, 0);
        return () => {
            if (timer !== null) clearTimeout(timer);
        };
    }, [trains]);

    // Keep the hovered tooltip's content in sync with fresh feed data. Its
    // position is moved imperatively by the animation loop below.
    useEffect(() => {
        const hoveredId = lastHoveredIdRef.current;
        if (!hoveredId) return;
        const feature = trains?.features.find(
            (f) => f.properties.vehicleId === hoveredId,
        );
        if (feature) setHoverInfo(feature.properties);
    }, [trains]);

    // Dead reckoning: trains move along their route between feed updates,
    // and a fresh position glides in over GLIDE_MS instead of jumping.
    useEffect(() => {
        if (!mapLoaded || !animating) return;
        const map = mapRef.current?.getMap();
        if (!map) return;

        let rafId: number | null = null;
        let lastFrameAt = Number.NEGATIVE_INFINITY;
        let lastSource: GeoJSONSource | undefined;
        let lastData: FeatureCollection | null = null;
        let wasMoving = false;
        // Last [lon, lat, bearing] pushed to the map, per vehicle.
        const lastSent = shownRef.current;
        lastSent.clear();
        // Where a glide started, per vehicle
        const glides = new Map<string, Glide>();

        const update = (timestamp: number, advance: boolean) => {
            const data = filteredTrainsRef.current;
            // Not map.isStyleLoaded(): that stays false while any tile is
            // loading, so a slow overlay tile server froze every train
            if (!data || !map.style) return;
            const source = map.getSource(SOURCES.base) as
                | GeoJSONSource
                | undefined;
            if (!source) return;

            // New feed data or a re-created source (style change) must be
            // pushed even if no train moved.
            const fresh = data !== lastData;
            let changed = source !== lastSource || fresh || glides.size > 0;
            const results = data.features.map((feature) => {
                const { vehicleId } =
                    feature.properties as TrainFeatureProperties;
                const state = trackersRef.current.get(vehicleId);
                if (!state) return null;
                const prev = lastSent.get(vehicleId);
                const pos = vehicleFrame(state, timestamp, {
                    advance,
                    fresh,
                    prev,
                    glides,
                    id: vehicleId,
                });
                if (!changed) changed = hasMoved(prev, pos);
                return pos;
            });
            if (!changed) return;

            lastSent.clear();
            const features = data.features.map((feature, i) => {
                const pos = results[i];
                if (!pos) return feature;
                const props = feature.properties as TrainFeatureProperties;
                const [lon, lat, heading] = pos;
                lastSent.set(props.vehicleId, pos);
                return {
                    ...feature,
                    geometry: {
                        type: "Point" as const,
                        coordinates: [lon, lat],
                    },
                    properties: { ...feature.properties, lon, lat, heading },
                };
            });
            const split = byGroup(features);
            for (const group of Object.keys(SOURCES) as Group[]) {
                (
                    map.getSource(SOURCES[group]) as GeoJSONSource | undefined
                )?.setData(split[group]);
            }
            lastSource = source;
            lastData = data;

            // Keep the tooltip and the selected label on their moving
            // vehicles without re-rendering this component.
            const hoveredId = lastHoveredIdRef.current;
            const hovered = hoveredId ? lastSent.get(hoveredId) : undefined;
            if (hovered) popupRef.current?.setLngLat([hovered[0], hovered[1]]);
            const selected = selectedIdRef.current
                ? lastSent.get(selectedIdRef.current)
                : undefined;
            if (selected) {
                selectedMarkerRef.current?.setLngLat([
                    selected[0],
                    selected[1],
                ]);
            }
        };

        const frame = (timestamp: DOMHighResTimeStamp) => {
            rafId = requestAnimationFrame(frame);
            const fresh = filteredTrainsRef.current !== lastData;
            // Leave the map alone while the user pans or zooms, except to
            // show new data
            if (map.isMoving()) {
                wasMoving = true;
                if (fresh) update(timestamp, false);
                return;
            }
            if (wasMoving) {
                wasMoving = false;
                for (const state of trackersRef.current.values()) {
                    state.lastTimestamp = null;
                }
            }
            if (!fresh && timestamp - lastFrameAt < FRAME_INTERVAL_MS) return;
            lastFrameAt = timestamp;
            update(timestamp, true);
        };

        const start = () => {
            if (rafId !== null || document.visibilityState === "hidden") {
                return;
            }
            // Continue from where the trains were frozen instead of
            // catching up the paused time in one jump.
            for (const state of trackersRef.current.values()) {
                state.lastTimestamp = null;
            }
            rafId = requestAnimationFrame(frame);
        };
        const stop = () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") stop();
            else start();
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        start();

        return () => {
            stop();
            lastSent.clear();
            document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
        };
    }, [mapLoaded, animating]);

    const stopMarkersGeojson = useMemo(() => {
        if (!train?.trip?.stoptimes) return null;

        return {
            type: "FeatureCollection" as const,
            features: train.trip.stoptimes.map((stoptime) => {
                const processedStop = train.processedStops?.find(
                    (ps) => ps.id === stoptime.stop.name,
                );
                const hasPassed = processedStop
                    ? train.trainPosition > processedStop.distanceAlongRoute
                    : false;

                return {
                    type: "Feature" as const,
                    properties: {
                        name: stoptime.stop.name,
                        hasPassed,
                    },
                    geometry: {
                        type: "Point" as const,
                        coordinates: [stoptime.stop.lon, stoptime.stop.lat],
                    },
                };
            }),
        };
    }, [train]);

    const polylineGeojson = useMemo(() => {
        if (!train?.trip.tripGeometry) return null;

        return {
            type: "Feature" as const,
            properties: {},
            geometry: polyline.toGeoJSON(train.trip.tripGeometry.points),
        };
    }, [train]);

    const stationGeojson = useMemo((): Feature<Point> | null => {
        if (!station) return null;
        return {
            type: "Feature",
            properties: { name: station.name },
            geometry: {
                type: "Point",
                coordinates: [station.lon, station.lat],
            },
        };
    }, [station]);

    // The selected station's name, in a box under its ring
    const stationLabelLayout = useMemo(
        () => ({
            "text-field": ["get", "name"] as ExpressionSpecification,
            "text-font": [...MAP_FONTS.bold],
            "text-size": MAP_STATION_MARK.label.size,
            "text-anchor": "top" as const,
            "text-offset": [0, MAP_STATION_MARK.label.offsetEm] as [
                number,
                number,
            ],
            "text-max-width": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "icon-image": stationImageId(scheme, "label"),
            "icon-text-fit": "both" as const,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        }),
        [scheme],
    );

    // Focus: every other marker fades while a train is selected, and the
    // network and stations step back. A constant (not per-feature) opacity,
    // so MapLibre can transition it.
    const othersOpacity = selectedId ? MAP_FOCUS.othersOpacity : 1;
    const fade = useMemo(
        () => ({ duration: prefersReducedMotion ? 0 : FADE_MS, delay: 0 }),
        [prefersReducedMotion],
    );

    const imageId = useCallback(
        (kind: "dot" | "pill", ring = false): ExpressionSpecification => [
            "concat",
            `mhav-${scheme}-${kind}-`,
            ["get", "level"],
            "-",
            ["get", "shape"],
            ring ? "-sel" : "",
        ],
        [scheme],
    );

    const byLevel = useCallback(
        (
            pick: (level: MarkerLevel) => string | number,
        ): ExpressionSpecification => [
            "match",
            ["get", "level"],
            "slight",
            pick("slight"),
            "moderate",
            pick("moderate"),
            "severe",
            pick("severe"),
            "stale",
            pick("stale"),
            "inactive",
            pick("inactive"),
            pick("onTime"),
        ],
        [],
    );

    /**
     * The selection ring around a z < 9 mark, `grow` px wider: just outside
     * the mark's outline (its widest side for a tram-train).
     */
    const ringRadius = useCallback(
        (grow: number): ExpressionSpecification =>
            [
                "interpolate",
                ["linear"],
                ["zoom"],
                ...MARK_ZOOMS.flatMap((z) => {
                    const d = markSizeAt(z);
                    const r = (shape: "train" | "hev" | "tramtrain") =>
                        markBody(shape, d).w / 2 +
                        MARKER.outlineWidth +
                        MARKER.selected.gap +
                        MARKER.selected.ringWidth / 2 +
                        grow;
                    return [
                        z,
                        [
                            "match",
                            ["get", "shape"],
                            "tramtrain",
                            r("tramtrain"),
                            r("train"),
                        ],
                    ];
                }),
            ] as unknown as ExpressionSpecification,
        [],
    );

    /** Unselected marks: one size, the delay band's colour, the vehicle's shape */
    const markLayout = useMemo(
        () => ({
            "icon-image": [
                "concat",
                `mhav-${scheme}-mark-`,
                ["get", "level"],
                "-",
                ["get", "shape"],
            ] as ExpressionSpecification,
            "icon-size": MARK_ICON_SIZE,
            "icon-padding": 0,
            "icon-allow-overlap": true,
            "icon-ignore-placement": MARK_IGNORE_PLACEMENT,
            // Bigger delays draw on top
            "symbol-sort-key": ["get", "sortKey"] as ExpressionSpecification,
        }),
        [scheme],
    );

    const pillTextSize = useMemo(
        (): ExpressionSpecification => [
            "match",
            ["get", "level"],
            "severe",
            labelSize("severe"),
            "moderate",
            labelSize("moderate"),
            labelSize("slight"),
        ],
        [],
    );

    const pillTextColor = useMemo(
        () =>
            byLevel((level) =>
                level === "stale" || level === "inactive"
                    ? STALE_COLORS[scheme].text
                    : DELAY_SCALE[scheme][level].label,
            ),
        [scheme, byLevel],
    );

    /**
     * Unselected trains: a mark, and from zoom 12 "+N" beside late ones.
     * MapLibre places upper layers first. The marks themselves stay out of
     * collision, so station names are never pushed away by a train (it just
     * draws over them). Under the names, an invisible copy of every mark
     * (ROOM) joins the collision index, then the numbers: a number goes
     * right, left, above or below its mark where it covers no mark, station
     * name or other number, else it stays out. Bigger delays first.
     */
    const baseMarkerLayers = () => [
        <Layer
            key="delay"
            id={DELAY_TEXT}
            beforeId={SLOTS.names}
            type="symbol"
            minzoom={MAP_MARKS.delayTextMinZoom}
            filter={["all", NOT_CLUSTER, HAS_DELAY_TEXT]}
            layout={{
                "text-field": ["get", "label"],
                "text-font": [...MAP_FONTS.bold],
                "text-size": MAP_MARKS.delayTextSize,
                "text-variable-anchor": ["left", "right", "bottom", "top"],
                "text-radial-offset": DELAY_TEXT_OFFSET,
                "text-justify": "auto",
                "text-padding": 0,
                "symbol-sort-key": ["-", 0, ["get", "sortKey"]],
            }}
            paint={{
                "text-color": byLevel((level) =>
                    level === "stale" || level === "inactive"
                        ? STALE_COLORS[scheme].text
                        : DELAY_SCALE[scheme][level].text,
                ),
                "text-halo-color": COLORS[scheme].surface,
                "text-halo-width": 1.25,
                "text-opacity": othersOpacity,
                "text-opacity-transition": fade,
            }}
        />,
        <Layer
            key="mark-room"
            id={ROOM.marks}
            beforeId={SLOTS.names}
            type="symbol"
            filter={NOT_CLUSTER}
            layout={markLayout}
            paint={{ "icon-opacity": 0 }}
        />,
        <Layer
            key="bubble-room"
            id={ROOM.bubbles}
            beforeId={SLOTS.names}
            type="symbol"
            filter={IS_CLUSTER}
            layout={{
                "icon-image": clusterImageId(scheme),
                "icon-size": CLUSTER_ICON_SIZE,
                "icon-padding": 0,
                "icon-allow-overlap": true,
                "icon-ignore-placement": MARK_IGNORE_PLACEMENT,
            }}
            paint={{ "icon-opacity": 0 }}
        />,
        <Layer
            key="mark"
            id={LAYER_IDS.TRAIN_DOT}
            type="symbol"
            filter={NOT_CLUSTER}
            layout={{ ...markLayout, "icon-ignore-placement": true }}
            paint={{
                "icon-opacity": othersOpacity,
                "icon-opacity-transition": fade,
            }}
        />,
    ];

    /**
     * Followed trains: the same mark at country zoom, then their "+N" chip
     * (a plain dot when on time), never clustered.
     */
    const pinnedMarkerLayers = () => [
        <Layer
            key="mark"
            id={PINNED(LAYER_IDS.TRAIN_DOT)}
            type="symbol"
            maxzoom={MARKER.labelMinZoom}
            layout={markLayout}
            paint={{
                "icon-opacity": othersOpacity,
                "icon-opacity-transition": fade,
            }}
        />,
        <Layer
            key="plain"
            id={PINNED(LAYER_IDS.TRAIN_PLAIN)}
            type="symbol"
            minzoom={MARKER.labelMinZoom}
            filter={IS_PLAIN}
            layout={{
                "icon-image": imageId("dot"),
                "icon-allow-overlap": true,
                "icon-ignore-placement": MARK_IGNORE_PLACEMENT,
                "symbol-sort-key": ["get", "sortKey"],
            }}
            paint={{
                "icon-opacity": othersOpacity,
                "icon-opacity-transition": fade,
            }}
        />,
        <Layer
            key="pill"
            id={PINNED(LAYER_IDS.TRAIN_PILL)}
            type="symbol"
            minzoom={MARKER.labelMinZoom}
            filter={["!", IS_PLAIN]}
            layout={{
                "icon-image": imageId("pill"),
                "icon-text-fit": "both",
                "icon-allow-overlap": true,
                "icon-ignore-placement": MARK_IGNORE_PLACEMENT,
                "text-field": ["get", "label"],
                "text-font": [...MAP_FONTS.bold],
                "text-size": pillTextSize,
                "text-allow-overlap": true,
                "text-ignore-placement": MARK_IGNORE_PLACEMENT,
                "symbol-sort-key": ["get", "sortKey"],
            }}
            paint={{
                "text-color": pillTextColor,
                "icon-opacity": othersOpacity,
                "text-opacity": othersOpacity,
                "icon-opacity-transition": fade,
                "text-opacity-transition": fade,
            }}
        />,
    ];

    /** Followed trains: a star on the marker, always visible. */
    const followLayer = (id: string, opacity: number) => (
        <Layer
            key="follow"
            id={id}
            type="symbol"
            minzoom={MARKER.labelMinZoom}
            filter={["==", ["get", "followed"], true]}
            layout={{
                "icon-image": followImageId(scheme),
                "icon-offset": FOLLOW_OFFSET,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
            }}
            paint={{
                "icon-opacity": opacity,
                "icon-opacity-transition": fade,
            }}
        />
    );

    // Selection ring fades in and settles onto the marker. Driven by hand:
    // the ring layers hold one train, and their opacity is constant data.
    useLayoutEffect(() => {
        if (!mapLoaded || !selectedId) return;
        const map = mapRef.current?.getMap();
        if (!map) return;
        const set = (p: number) => setRingProgress(map, p, ringRadius);
        if (prefersReducedMotion) {
            set(1);
            return;
        }
        let raf: number | null = null;
        let started: number | null = null;
        set(0);
        const step = (ts: number) => {
            started ??= ts;
            const t = Math.min(1, (ts - started) / SELECT_MS);
            set(easeOut(t));
            raf = t < 1 ? requestAnimationFrame(step) : null;
        };
        raf = requestAnimationFrame(step);
        return () => {
            if (raf !== null) cancelAnimationFrame(raf);
            set(1);
        };
    }, [selectedId, mapLoaded, prefersReducedMotion, ringRadius]);

    // Draw the scheme's marker sprites in idle time once trains are on the
    // map, so selecting one doesn't stall on canvas work
    const hasTrains = !!trains;
    useEffect(() => {
        if (!mapLoaded || !hasTrains) return;
        const map = mapRef.current?.getMap();
        if (!map) return;
        return prewarmMarkerImages(map, scheme);
    }, [mapLoaded, hasTrains, scheme]);

    // Marker sprites are drawn on first use. The resolver goes in as soon as
    // the map exists, before any layer asks for an image.
    const attachMap = useCallback((ref: MapRef | null) => {
        mapRef.current = ref;
        const map = ref?.getMap();
        if (!map) return;
        map.setMissingStyleImageResolver((id) => {
            if (map.hasImage(id)) return;
            const sprite = markerImage(id);
            if (sprite) {
                map.addImage(id, sprite.data, sprite.meta);
            } else {
                map.addImage(id, createTransparentBasemapIcon());
            }
        });
        // Ready once the style is parsed. Not the "load" event: that waits
        // for every tile, so one slow overlay tile kept all trains off the map
        if (map.style?._loaded) setMapLoaded(true);
        else map.once("style.load", () => setMapLoaded(true));
    }, []);

    // A theme or language switch swaps the basemap in place: the transform
    // carries the app's sources and layers (and their draw order) over to
    // the new style, so the camera, the selection and the layer order all
    // stay. The ref holds what the map was built with: a switch that lands
    // before the map exists (a language switch remounts the map while the
    // theme is still resolving) is applied once it is ready, not dropped
    const appliedStyleRef = useRef(`${scheme}:${locale}`);
    useEffect(() => {
        const map = mapRef.current?.getMap();
        const key = `${scheme}:${locale}`;
        if (!map || !mapLoaded || appliedStyleRef.current === key) return;
        appliedStyleRef.current = key;
        map.setStyle(mapStyle(scheme, locale), {
            diff: true,
            transformStyle: basemapTransform(),
        });
    }, [scheme, locale, mapLoaded]);

    // On the dark map the overlay's tiles are inverted (and hue-rotated back),
    // so its dark-blue station names turn light and stay readable; mostly
    // desaturated, so tram and metro lines read as grey, not magenta
    const railwayPaint = useMemo(
        () =>
            scheme === "dark"
                ? {
                      // Not too bright: a dense station yard would turn
                      // into a pale slab
                      "raster-opacity": 0.55,
                      "raster-brightness-min": 0.48,
                      "raster-brightness-max": 0.2,
                      "raster-hue-rotate": 180,
                      "raster-saturation": -0.75,
                  }
                : // Softer pink and lilac in light too: no loud purple lines
                  { "raster-opacity": 0.75, "raster-saturation": -0.4 },
        [scheme],
    );

    // Our network and stations: built daily by the API, the same files for
    // every visitor (long-cached)
    const mapData = useMemo(() => {
        const origin =
            typeof window === "undefined" ? "" : window.location.origin;
        return {
            network: `${origin}/api${MAP_DATA_PATHS.network}`,
            stations: `${origin}/api${MAP_DATA_PATHS.stations}`,
        };
    }, []);
    const focused = !!selectedId;
    const railFade = prefersReducedMotion ? 0 : MAP_FOCUS.fadeMs;
    const network = useMemo(
        () => networkLayer({ scheme, dim: focused, fadeMs: railFade }),
        [scheme, focused, railFade],
    );
    const stations = useMemo(
        () =>
            stationLayers({
                scheme,
                dim: focused,
                fadeMs: railFade,
                labelOpacity: settings.stationNamesOpacity,
                // The selected station is named in its box
                namedElsewhere: station?.id ?? null,
                // The overlay names stations itself from this zoom
                labelMaxZoom: settings.showRailwayOverlay
                    ? RAILWAY_NAMES_MIN_ZOOM
                    : undefined,
            }),
        [
            scheme,
            focused,
            railFade,
            settings.stationNamesOpacity,
            settings.showRailwayOverlay,
            station?.id,
        ],
    );

    const markerLayerIds = useMemo(
        () => [
            LAYER_IDS.TRAIN_DOT,
            PINNED(LAYER_IDS.TRAIN_DOT),
            PINNED(LAYER_IDS.TRAIN_PLAIN),
            PINNED(LAYER_IDS.TRAIN_PILL),
            SEL.dot,
            SEL.plain,
            SEL.pill,
            CLUSTER.bubble,
        ],
        [],
    );

    const onHover = useCallback(
        (e: MapMouseEvent) => {
            const feature = e.features?.[0];
            const id = feature?.properties.vehicleId as string | undefined;
            const isCluster = !!feature?.properties.cluster;
            setCursor(feature ? "pointer" : null);
            if (!settings.showTooltip || !isDesktop) return;
            if (id && !isCluster) {
                if (lastHoveredIdRef.current === id) return;
                lastHoveredIdRef.current = id;
                const fresh = trains?.features.find(
                    (f) => f.properties.vehicleId === id,
                );
                setHoverInfo(
                    fresh?.properties ??
                        (feature?.properties as TrainFeatureProperties),
                );
            } else {
                if (lastHoveredIdRef.current === null) return;
                lastHoveredIdRef.current = null;
                setHoverInfo(null);
            }
        },
        [trains, settings.showTooltip, isDesktop],
    );

    // Tapping a bubble zooms in until its trains separate; trains that would
    // still overlap (a station's platforms) are listed instead.
    const openCluster = useCallback(
        async (clusterId: number, lngLat: [number, number]) => {
            const map = mapRef.current?.getMap();
            const source = map?.getSource(SOURCES.base) as
                | GeoJSONSource
                | undefined;
            if (!map || !source) return;
            try {
                const [zoom, leaves] = await Promise.all([
                    source.getClusterExpansionZoom(clusterId),
                    source.getClusterLeaves(clusterId, CLUSTER_LIST_MAX, 0),
                ]);
                const points = leaves.map((leaf) =>
                    map.project(
                        (leaf.geometry as Point).coordinates as [
                            number,
                            number,
                        ],
                    ),
                );
                const xs = points.map((p) => p.x);
                const ys = points.map((p) => p.y);
                const spread =
                    Math.max(
                        Math.max(...xs) - Math.min(...xs),
                        Math.max(...ys) - Math.min(...ys),
                    ) *
                    2 ** (zoom - map.getZoom());
                if (
                    spread < CLUSTER_LIST_SPREAD_PX ||
                    zoom > map.getMaxZoom()
                ) {
                    const list = leaves
                        .map(
                            (leaf) => leaf.properties as TrainFeatureProperties,
                        )
                        .sort(
                            (a, b) =>
                                (b as unknown as { sortKey: number }).sortKey -
                                (a as unknown as { sortKey: number }).sortKey,
                        );
                    setClusterList({
                        lon: lngLat[0],
                        lat: lngLat[1],
                        trains: list,
                    });
                    return;
                }
                const { bottom, left } = insetsRef.current;
                map.easeTo({
                    center: lngLat,
                    zoom: Math.min(zoom + 0.5, map.getMaxZoom()),
                    duration: prefersReducedMotion ? 0 : 500,
                    padding: { top: 0, right: 0, bottom, left },
                });
            } catch {
                /* The cluster is gone after a data update; ignore the tap. */
            }
        },
        [prefersReducedMotion],
    );

    const onClick = useCallback(
        (e: MapMouseEvent) => {
            setClusterList(null);
            let feature = e.features?.[0];
            if (!feature) {
                // Small dots get a 44 px touch target
                const map = mapRef.current?.getMap();
                const { x, y } = e.point;
                const hits = map?.queryRenderedFeatures(
                    [
                        [x - HIT_RADIUS, y - HIT_RADIUS],
                        [x + HIT_RADIUS, y + HIT_RADIUS],
                    ],
                    { layers: markerLayerIds },
                );
                feature = hits?.sort((a, b) => {
                    const pa = map?.project(
                        (a.geometry as Point).coordinates as [number, number],
                    );
                    const pb = map?.project(
                        (b.geometry as Point).coordinates as [number, number],
                    );
                    const da = pa ? (pa.x - x) ** 2 + (pa.y - y) ** 2 : 0;
                    const db = pb ? (pb.x - x) ** 2 + (pb.y - y) ** 2 : 0;
                    return da - db;
                })[0];
            }
            if (feature?.properties.cluster) {
                void openCluster(
                    feature.properties.cluster_id as number,
                    (feature.geometry as Point).coordinates as [number, number],
                );
                return;
            }
            const id = feature?.properties.vehicleId as string | undefined;
            onSelectTrain(id && id !== selectedId ? id : null);
        },
        [selectedId, onSelectTrain, markerLayerIds, openCluster],
    );

    const selectFromList = useCallback(
        (vehicleId: string) => {
            setClusterList(null);
            onSelectTrain(vehicleId);
        },
        [onSelectTrain],
    );
    const closeClusterList = useCallback(() => setClusterList(null), []);

    const sourceData = (group: Group) =>
        (animating ? EMPTY : groups[group]) as unknown as GeoJsonType;

    const colors = COLORS[scheme];

    // The selected train's route and stops, shared with the shader warm-up
    const routeLine = useMemo(
        () => ({
            paint: {
                "line-color": colors.ink,
                "line-opacity": MAP_FOCUS.route.opacity,
                "line-width": MAP_FOCUS.route.width,
            },
            layout: {
                "line-cap": "round",
                "line-join": "round",
            } as const,
        }),
        [colors],
    );
    const stopCircle = useMemo(
        () => ({
            "circle-radius": 4.5,
            "circle-color": [
                "case",
                ["boolean", ["get", "hasPassed"], false],
                colors.ink2,
                colors.surface,
            ] as ExpressionSpecification,
            "circle-stroke-width": 2,
            "circle-stroke-color": colors.ink,
        }),
        [colors],
    );
    const stopLabel = useMemo(
        () => ({
            layout: {
                "text-field": ["get", "name"] as ExpressionSpecification,
                "text-size": 13,
                "text-offset": [0, 1] as [number, number],
                "text-anchor": "top" as const,
                "text-font": [...MAP_FONTS.bold],
            },
            paint: {
                "text-color": colors.ink,
                "text-halo-color": colors.map,
                "text-halo-width": 2,
            },
        }),
        [colors],
    );

    // Compile those shaders in idle time, before any train is opened
    // biome-ignore lint/correctness/useExhaustiveDependencies: once per map, the programs stay compiled
    useEffect(() => {
        if (!mapLoaded || !hasTrains) return;
        const map = mapRef.current?.getMap();
        if (!map) return;
        const id = (name: string) => `mhav-warmup-${name}`;
        const hint = 0.01;
        return warmUpShaders(map, [
            {
                id: id("route"),
                type: "line",
                source: "mhav-warmup",
                layout: routeLine.layout,
                paint: { ...routeLine.paint, "line-opacity": hint },
            },
            {
                id: id("stops"),
                type: "circle",
                source: "mhav-warmup",
                filter: ["==", ["geometry-type"], "Point"],
                paint: {
                    ...stopCircle,
                    "circle-opacity": hint,
                    "circle-stroke-opacity": hint,
                },
            },
            {
                id: id("labels"),
                type: "symbol",
                source: "mhav-warmup",
                filter: ["==", ["geometry-type"], "Point"],
                layout: stopLabel.layout,
                paint: { ...stopLabel.paint, "text-opacity": hint },
            },
            // Zoomed out, a phone shows only marks; the "+N" pills of a
            // zoomed-in train and the selection ring draw for the first time
            // when a train opens
            {
                id: id("ring"),
                type: "circle",
                source: "mhav-warmup",
                filter: ["==", ["geometry-type"], "Point"],
                paint: {
                    "circle-radius": ringRadius(0),
                    "circle-color": "transparent",
                    "circle-stroke-width": MARKER.selected.ringWidth,
                    "circle-stroke-color": colors.ink,
                    "circle-stroke-opacity": hint,
                },
            },
            {
                id: id("pill"),
                type: "symbol",
                source: "mhav-warmup",
                filter: ["==", ["geometry-type"], "Point"],
                layout: {
                    "icon-image": imageId("pill"),
                    "icon-text-fit": "both",
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                    "text-field": ["get", "label"],
                    "text-font": [...MAP_FONTS.bold],
                    "text-size": pillTextSize,
                    "text-allow-overlap": true,
                    "text-ignore-placement": true,
                },
                paint: {
                    "text-color": pillTextColor,
                    "icon-opacity": hint,
                    "text-opacity": hint,
                },
            },
        ]);
    }, [mapLoaded, hasTrains]);

    // The label and tooltip start where the animation drew their train (the
    // feed's raw position would make them jump ahead of a gliding marker)
    const placedSelected = useMemo(
        () => (selectedInfo ? placeAt(selectedInfo, shownRef.current) : null),
        [selectedInfo],
    );
    const placedHover = useMemo(
        () => (hoverInfo ? placeAt(hoverInfo, shownRef.current) : null),
        [hoverInfo],
    );

    return (
        <div className="relative h-full w-full bg-map">
            <MapLibreMap
                ref={attachMap}
                initialViewState={{
                    longitude: 19.045,
                    latitude: 47.499,
                    zoom: 13,
                }}
                onLoad={() => setMapLoaded(true)}
                onZoomStart={closeClusterList}
                maxPitch={0}
                dragRotate={false}
                touchPitch={false}
                attributionControl={false}
                style={{ width: "100%", height: "100%" }}
                mapStyle={initialStyle.style}
                transformStyle={initialStyle.transform}
                locale={mapLocale}
                interactiveLayerIds={markerLayerIds}
                cursor={cursor ?? undefined}
                onClick={onClick}
                onMouseMove={onHover}
                // [west, south, east, north]
                maxBounds={[5.5, 43, 30, 52.5]}
                minZoom={5}
                maxZoom={19}
                // Keep v5's overscaling past the basemap's max zoom; v6's
                // default (4) changes label placement at zoom 15+.
                zoomLevelsToOverscale={undefined}
            >
                <MapControls
                    isDesktop={isDesktop}
                    skipInitialFly={!!selectedId || !!station}
                    showLocate={!isDesktop || !panelOpen}
                />
                {/* Our passenger network, under the place names */}
                <Source
                    id={NETWORK_SOURCE}
                    type="geojson"
                    data={mapData.network}
                >
                    <Layer {...network} beforeId={SLOTS.railway} />
                </Source>
                {settings.showRailwayOverlay && (
                    <Source
                        id="railway-source"
                        type="raster"
                        tiles={[OVERLAYS.railway.url.replace("{s}", "a")]}
                        tileSize={256}
                    >
                        <Layer
                            id={LAYER_IDS.RAILWAY}
                            type="raster"
                            beforeId={SLOTS.railway}
                            paint={railwayPaint}
                        />
                    </Source>
                )}
                {/* Our station names, by trains a day, over the place names */}
                <Source
                    id={STATIONS_SOURCE}
                    type="geojson"
                    data={mapData.stations}
                >
                    {stations.dots.map((layer) => (
                        <Layer
                            key={layer.id}
                            {...layer}
                            beforeId={SLOTS.trainText}
                        />
                    ))}
                    {settings.showStationNames &&
                        stations.labels.map((layer) => (
                            <Layer
                                key={layer.id}
                                {...layer}
                                beforeId={SLOTS.route}
                            />
                        ))}
                </Source>
                {polylineGeojson && (
                    <Source
                        id="polyline-source"
                        type="geojson"
                        data={polylineGeojson}
                    >
                        {/* Focus: the route over a land-coloured casing */}
                        <Layer
                            id={LAYER_IDS.ROUTE_CASING}
                            type="line"
                            beforeId={SLOTS.stops}
                            paint={{
                                "line-color": MAP_PALETTE[scheme].land,
                                "line-width": MAP_FOCUS.route.casingWidth,
                                "line-opacity": MAP_FOCUS.route.casingOpacity,
                            }}
                            layout={routeLine.layout}
                        />
                        <Layer
                            id={LAYER_IDS.ROUTE_LINE}
                            type="line"
                            beforeId={SLOTS.stops}
                            paint={routeLine.paint}
                            layout={routeLine.layout}
                        />
                    </Source>
                )}
                {stopMarkersGeojson && (
                    <Source
                        id="stops-source"
                        type="geojson"
                        data={stopMarkersGeojson}
                    >
                        <Layer
                            id={LAYER_IDS.STOP_CIRCLES}
                            type="circle"
                            beforeId={SLOTS.station}
                            paint={stopCircle}
                        />
                        {settings.showStationNames && (
                            <Layer
                                id={LAYER_IDS.STOP_LABELS}
                                type="symbol"
                                beforeId={SLOTS.station}
                                maxzoom={
                                    settings.showRailwayOverlay
                                        ? RAILWAY_NAMES_MIN_ZOOM
                                        : NO_MAX_ZOOM
                                }
                                layout={stopLabel.layout}
                                paint={{
                                    ...stopLabel.paint,
                                    "text-opacity":
                                        settings.stationNamesOpacity,
                                }}
                            />
                        )}
                    </Source>
                )}
                <Source
                    id={SOURCES.base}
                    type="geojson"
                    data={sourceData("base")}
                    cluster
                    clusterRadius={CLUSTER_RADIUS}
                    clusterMinPoints={MAP_MARKS.clusterMinPoints}
                    clusterMaxZoom={CLUSTER_MAX_ZOOM}
                >
                    {baseMarkerLayers()}
                    {/* Overlapping trains: a neutral bubble with their count */}
                    <Layer
                        id={CLUSTER.bubble}
                        beforeId={LAYER_IDS.TRAIN_DOT}
                        type="symbol"
                        filter={IS_CLUSTER}
                        layout={{
                            "icon-image": clusterImageId(scheme),
                            "icon-size": CLUSTER_ICON_SIZE,
                            "icon-padding": 0,
                            "icon-allow-overlap": true,
                            // Its room is held by ROOM.bubbles
                            "icon-ignore-placement": true,
                            "text-field": ["get", "point_count_abbreviated"],
                            "text-font": [...MAP_FONTS.bold],
                            "text-size": 12,
                            "text-allow-overlap": true,
                            "text-ignore-placement": true,
                        }}
                        paint={{
                            "text-color": colors.ink,
                            "icon-opacity": othersOpacity,
                            "text-opacity": othersOpacity,
                            "icon-opacity-transition": fade,
                            "text-opacity-transition": fade,
                        }}
                    />
                </Source>
                {/*
                 * The selected station: its edge under the trains, its ring
                 * above the clusters (the marks still draw over it) and its
                 * name above every unpinned train, so a busy station stays
                 * readable.
                 */}
                {/* Always mounted, so its layers keep their place in the order */}
                <Source
                    id="station-source"
                    type="geojson"
                    data={stationGeojson ?? EMPTY}
                >
                    <Layer
                        id={LAYER_IDS.STATION}
                        type="symbol"
                        beforeId={SLOTS.trains}
                        layout={{
                            "icon-image": stationImageId(scheme, "clear"),
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                        }}
                    />
                    <Layer
                        id={LAYER_IDS.STATION_RING}
                        type="symbol"
                        beforeId={LAYER_IDS.TRAIN_DOT}
                        layout={{
                            "icon-image": stationImageId(scheme, "ring"),
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                        }}
                    />
                    <Layer
                        id={LAYER_IDS.STATION_LABEL}
                        type="symbol"
                        layout={stationLabelLayout}
                        paint={{ "text-color": colors.ink }}
                    />
                </Source>
                {/* Followed trains: never clustered */}
                <Source
                    id={SOURCES.pinned}
                    type="geojson"
                    data={sourceData("pinned")}
                >
                    {pinnedMarkerLayers()}
                    {followLayer(PINNED(LAYER_IDS.TRAIN_FOLLOW), othersOpacity)}
                </Source>
                {/* The selected train, on top, with its ring */}
                <Source
                    id={SOURCES.selected}
                    type="geojson"
                    data={sourceData("selected")}
                >
                    <Layer
                        id={SEL.dot}
                        type="symbol"
                        maxzoom={MARKER.labelMinZoom}
                        layout={markLayout}
                    />
                    <Layer
                        id={SEL.dotRing}
                        type="circle"
                        maxzoom={MARKER.labelMinZoom}
                        paint={{
                            "circle-radius": ringRadius(0),
                            "circle-color": "transparent",
                            "circle-stroke-width": MARKER.selected.ringWidth,
                            "circle-stroke-color": colors.ink,
                            "circle-stroke-opacity": 1,
                        }}
                    />
                    <Layer
                        id={SEL.heading}
                        type="symbol"
                        minzoom={MAP_DIRECTION_ARROW.minZoom}
                        filter={HAS_HEADING}
                        layout={{
                            "icon-image": arrowImageId(scheme),
                            "icon-rotate": ["coalesce", ["get", "heading"], 0],
                            "icon-rotation-alignment": "map",
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                            // Clear of the ring
                            "icon-offset": ARROW_OFFSET_SELECTED,
                        }}
                    />
                    <Layer
                        id={SEL.plain}
                        type="symbol"
                        minzoom={MARKER.labelMinZoom}
                        filter={IS_PLAIN}
                        layout={{
                            "icon-image": imageId("dot"),
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": MARK_IGNORE_PLACEMENT,
                        }}
                    />
                    <Layer
                        id={SEL.plainRing}
                        type="symbol"
                        minzoom={MARKER.labelMinZoom}
                        filter={IS_PLAIN}
                        layout={{
                            "icon-image": imageId("dot", true),
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                        }}
                        paint={{ "icon-opacity": 1 }}
                    />
                    {(["pill", "pillRing"] as const).map((key) => (
                        <Layer
                            key={key}
                            id={SEL[key]}
                            type="symbol"
                            minzoom={MARKER.labelMinZoom}
                            filter={["!", IS_PLAIN]}
                            layout={{
                                "icon-image": imageId(
                                    "pill",
                                    key === "pillRing",
                                ),
                                "icon-text-fit": "both",
                                "icon-allow-overlap": true,
                                // Numbers of other trains keep clear of it
                                "icon-ignore-placement":
                                    key === "pill"
                                        ? MARK_IGNORE_PLACEMENT
                                        : true,
                                "text-field": ["get", "label"],
                                "text-font": [...MAP_FONTS.bold],
                                "text-size": pillTextSize,
                                "text-allow-overlap": true,
                                "text-ignore-placement": true,
                            }}
                            paint={{
                                "text-color": pillTextColor,
                                "icon-opacity": 1,
                                "text-opacity": 1,
                            }}
                        />
                    ))}
                    {followLayer(SEL.follow, 1)}
                </Source>
                <MapAttribution
                    isDesktop={isDesktop}
                    showRailway={settings.showRailwayOverlay}
                    insetLeft={insets.left}
                />
                {placedSelected && (
                    <SelectedLabel
                        info={placedSelected}
                        level={selectedLevel}
                        markerRef={selectedMarkerRef}
                        showSpeed={isDesktop}
                    />
                )}
                {placedHover && placedHover.vehicleId !== selectedId && (
                    <HoverTooltip info={placedHover} popupRef={popupRef} />
                )}
                {clusterList && (
                    <ClusterList
                        list={clusterList}
                        onSelect={selectFromList}
                        onClose={closeClusterList}
                    />
                )}
            </MapLibreMap>
        </div>
    );
}
