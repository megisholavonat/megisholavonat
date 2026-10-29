/**
 * Product analytics: one typed event list for the web and the app.
 *
 * Every event and every property it may carry is declared in
 * {@link EVENT_SCHEMA}. The types come from that schema, and the same schema
 * filters each event at runtime: unknown properties, wrong types, free text
 * and out-of-range numbers are dropped before anything leaves the device.
 *
 * What may be sent: enums, counts, durations, booleans, and public timetable
 * ids (train numbers, station ids, route codes, vehicle ids). Never a search
 * query (only its length), a place the user typed, a position, or a pair of
 * stations that would describe someone's commute.
 */

// --- Property specs ----------------------------------------------------

interface EnumSpec<T extends string> {
    readonly kind: "enum";
    readonly values: readonly T[];
}
interface IntSpec {
    readonly kind: "int";
    readonly max: number;
}
interface BoolSpec {
    readonly kind: "bool";
}
/** A public timetable id: train number, station id, route code. */
interface IdSpec {
    readonly kind: "id";
}
type Spec = EnumSpec<string> | IntSpec | BoolSpec | IdSpec;

type SpecValue<S> =
    S extends EnumSpec<infer T>
        ? T
        : S extends IntSpec
          ? number
          : S extends BoolSpec
            ? boolean
            : S extends IdSpec
              ? string
              : never;

const oneOf = <const T extends string>(...values: T[]): EnumSpec<T> => ({
    kind: "enum",
    values,
});
/** A non-negative whole number, capped at `max`. */
const int = (max: number): IntSpec => ({ kind: "int", max });
const bool: BoolSpec = { kind: "bool" };
const id: IdSpec = { kind: "id" };

/** Ids are short and plain: "8", "005513748", "1:915504313395", "80a". */
const ID_PATTERN = /^[A-Za-z0-9:._-]{1,32}$/;

// --- Shared vocabularies ---------------------------------------------------

export const PLATFORMS = ["web", "ios", "android"] as const;
export type AnalyticsPlatform = (typeof PLATFORMS)[number];

/** How the train or station is shown: a bottom sheet, a docked panel. */
const surface = oneOf("sheet", "panel", "screen");
/** Where the user came from to open a train or a station. */
const entry = oneOf(
    "search",
    "map",
    "board",
    "commute",
    "planner",
    "disruptions",
    "share_link",
    "notification",
    "reload",
    "other",
);
const detent = oneOf("peek", "half", "full");
/** The delay colour the user saw (`TrainDisplay.level`). */
const delayLevel = oneOf(
    "onTime",
    "slight",
    "moderate",
    "severe",
    "stale",
    "unknown",
);
const trainState = oneOf("running", "stale", "idle", "cancelled", "unknown");
const followKind = oneOf("commute", "single");
const board = oneOf("departures", "arrivals");

export const EVENT_SCHEMA = {
    /** A page load (web) or a launch / return from the background (app). */
    app_open: {
        entry: oneOf("direct", "share_link", "notification", "reload"),
    },
    /** First trains on the map. */
    map_ready: { ms: int(120_000), trains: int(5_000) },

    search_opened: { surface },
    /** `query_length` 0: a quick pick (recent station, late train). */
    search_result_selected: {
        type: oneOf("train", "station"),
        position: int(100),
        query_length: int(100),
        trains: int(100),
        stations: int(100),
    },

    train_opened: {
        entry,
        surface,
        delay_level: delayLevel,
        state: trainState,
        followed: bool,
        train_number: id,
        route: id,
    },
    sheet_detent_changed: {
        sheet: oneOf("home", "train", "station", "disruptions", "planner"),
        detent,
    },
    train_closed: {
        surface,
        dwell_s: int(86_400),
        max_detent: detent,
    },

    station_opened: { entry, surface, station_id: id },
    board_row_opened: { board, position: int(100) },
    board_kind_changed: { board },

    /** The follow editor opened. */
    follow_started: { target: oneOf("train", "edit") },
    follow_saved: {
        kind: followKind,
        days: int(7),
        is_new: bool,
        alerts: bool,
    },
    follow_removed: { kind: followKind },
    commute_row_opened: { position: int(50), delay_level: delayLevel },
    /** App: alerts for a follow turned on or off. */
    follow_alerts_changed: { enabled: bool },

    planner_opened: { surface },
    planner_searched: {
        results: int(50),
        departure_set: bool,
        error: bool,
    },
    planner_result_expanded: {
        position: int(50),
        transfers: int(10),
        max_risk: oneOf("none", "safe", "tight", "likely_missed"),
    },

    stats_viewed: {
        kind: oneOf("rankings", "train", "station", "train_history"),
        ranking: oneOf("lines", "trains", "stations"),
        days: int(366),
    },

    disruptions_opened: { surface, count: int(500), affects_follow: bool },
    disruption_expanded: { position: int(500), affects_follow: bool },

    share_clicked: {
        target: oneOf("train", "station", "departure"),
        method: oneOf("native", "copy"),
        completed: bool,
    },

    /** The value only where it is one of a few public choices. */
    settings_changed: {
        key: oneOf(
            "theme",
            "language",
            "analytics",
            "tooltip",
            "station_names",
            "station_names_opacity",
            "trains",
            "tram_trains",
            "hev",
            "railway_layer",
            "animate_vehicles",
            "dynamic_color",
        ),
        value: oneOf("light", "dark", "system", "hu", "en", "on", "off"),
    },

    consent_shown: { surface: oneOf("banner", "card") },
    consent_decided: {
        decision: oneOf("granted", "denied"),
        source: oneOf("prompt", "settings"),
    },

    error_shown: {
        kind: oneOf(
            "feed_down",
            "feed_unreachable",
            "feed_empty",
            "feed_stale",
            "train_gone",
            "station_unknown",
        ),
    },

    /** App: the answer to the notification permission prompt. */
    notification_permission_result: {
        result: oneOf("granted", "denied", "undetermined"),
        prompted: bool,
    },
    /** App: an alert was tapped. */
    notification_opened: {
        alert_type: oneOf(
            "delay",
            "on_time",
            "platform",
            "train_ahead",
            "multiple",
            "unknown",
        ),
        cold_start: bool,
    },
} as const satisfies Record<string, Record<string, Spec>>;

/** Stable properties sent with every event. */
export const SUPER_SCHEMA = {
    platform: oneOf(...PLATFORMS),
    app_version: id,
    locale: oneOf("hu", "en"),
    theme: oneOf("light", "dark", "system"),
    follows: oneOf("0", "1", "2-3", "4+"),
} as const satisfies Record<string, Spec>;

type Schema = typeof EVENT_SCHEMA;
export type AnalyticsEvent = keyof Schema;

type PropsOf<S extends Record<string, Spec>> = {
    -readonly [K in keyof S]?: SpecValue<S[K]>;
};
/** The properties an event may carry; all optional, nothing else allowed. */
export type EventProps<E extends AnalyticsEvent> = PropsOf<Schema[E]>;
export type SuperProps = PropsOf<typeof SUPER_SCHEMA>;

type Clean = Record<string, string | number | boolean>;

function cleanValue(
    spec: Spec,
    value: unknown,
): string | number | boolean | undefined {
    switch (spec.kind) {
        case "enum":
            return typeof value === "string" && spec.values.includes(value)
                ? value
                : undefined;
        case "int":
            return typeof value === "number" && Number.isFinite(value)
                ? Math.min(spec.max, Math.max(0, Math.round(value)))
                : undefined;
        case "bool":
            return typeof value === "boolean" ? value : undefined;
        case "id":
            return typeof value === "string" && ID_PATTERN.test(value)
                ? value
                : undefined;
    }
}

function clean(schema: Record<string, Spec>, props: object): Clean {
    const out: Clean = {};
    for (const [key, value] of Object.entries(props)) {
        if (!Object.hasOwn(schema, key)) continue;
        const spec = schema[key] as Spec;
        const cleaned = cleanValue(spec, value);
        if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
}

/**
 * Drops every property the schema does not allow for this event. Unknown
 * events give `null`.
 */
export function sanitizeEvent(event: string, props: object = {}): Clean | null {
    if (!Object.hasOwn(EVENT_SCHEMA, event)) return null;
    return clean(EVENT_SCHEMA[event as AnalyticsEvent], props);
}

export function sanitizeSuperProps(props: object): Clean {
    return clean(SUPER_SCHEMA, props);
}

// --- Buckets -------------------------------------------------------------

/** Followed trains, bucketed so a count never singles anyone out. */
export function followsBucket(count: number): SuperProps["follows"] {
    if (count <= 0) return "0";
    if (count === 1) return "1";
    if (count <= 3) return "2-3";
    return "4+";
}

// --- Tracker -------------------------------------------------------------

/**
 * - anonymous: no consent (yet). Sent without anything stored on the
 *   device and without an identity that outlives the session (the web's
 *   cookieless mode; the app's in-memory mode).
 * - persistent: consented; a random id kept on the device.
 * - off: nothing is sent.
 */
export type AnalyticsMode = "anonymous" | "persistent" | "off";

export interface AnalyticsSink {
    capture(
        event: string,
        properties: Clean,
        options: { instant: boolean },
    ): void;
}

export interface TrackOptions {
    /** Send now instead of with the next batch (before a mode switch). */
    instant?: boolean;
}

interface Queued {
    event: string;
    props: Clean;
    instant: boolean;
    mode: AnalyticsMode;
}

/** Events kept while the analytics library is still loading. */
const MAX_QUEUE = 50;

export interface Analytics {
    track<E extends AnalyticsEvent>(
        event: E,
        props?: EventProps<E>,
        options?: TrackOptions,
    ): void;
    /**
     * The last call within `ms` wins, per event and `key`: for detents,
     * fast toggles and the like.
     */
    trackDebounced<E extends AnalyticsEvent>(
        event: E,
        props: EventProps<E>,
        ms?: number,
        key?: string,
    ): void;
    setSuperProps(props: SuperProps): void;
    /**
     * The consent mode. Events queued under another mode are dropped, so
     * nothing from before a decision is sent under the new identity.
     */
    setMode(mode: AnalyticsMode): void;
    getMode(): AnalyticsMode;
    /** Connect the analytics library (or disconnect it with `null`). */
    attach(sink: AnalyticsSink | null): void;
}

export function createAnalytics(platform: AnalyticsPlatform): Analytics {
    let sink: AnalyticsSink | null = null;
    let mode: AnalyticsMode = "anonymous";
    let queue: Queued[] = [];
    let superProps: Clean = { platform };
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const send = (item: Queued) => {
        sink?.capture(
            item.event,
            { ...superProps, ...item.props },
            { instant: item.instant },
        );
    };

    const analytics: Analytics = {
        track(event, props, options) {
            if (mode === "off") return;
            const cleaned = sanitizeEvent(event, props ?? {});
            if (!cleaned) return;
            const item: Queued = {
                event,
                props: cleaned,
                instant: options?.instant ?? false,
                mode,
            };
            if (sink) send(item);
            else if (queue.length < MAX_QUEUE) queue.push(item);
        },
        trackDebounced(event, props, ms = 1000, key = "") {
            const timerKey = `${event}:${key}`;
            clearTimeout(timers.get(timerKey));
            timers.set(
                timerKey,
                setTimeout(() => {
                    timers.delete(timerKey);
                    analytics.track(event, props);
                }, ms),
            );
        },
        setSuperProps(props) {
            superProps = { ...superProps, ...sanitizeSuperProps(props) };
            superProps.platform = platform;
        },
        setMode(next) {
            if (next === mode) return;
            mode = next;
            queue = queue.filter((item) => item.mode === next);
            if (next === "off") {
                for (const timer of timers.values()) clearTimeout(timer);
                timers.clear();
            }
        },
        getMode: () => mode,
        attach(next) {
            sink = next;
            if (!sink) return;
            const pending = queue;
            queue = [];
            for (const item of pending) send(item);
        },
    };
    return analytics;
}
