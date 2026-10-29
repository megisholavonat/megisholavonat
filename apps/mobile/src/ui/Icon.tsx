import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

// SF Symbols on iOS, Material Symbols on Android (design board "Ikonok").

type SymbolNames = Extract<SymbolViewProps["name"], { ios?: unknown }>;
type IosSymbol = NonNullable<SymbolNames["ios"]>;
type AndroidSymbol = NonNullable<SymbolNames["android"]>;

function symbol(ios: IosSymbol, android: AndroidSymbol) {
    return { ios, android };
}

export const ICONS = {
    close: symbol("xmark", "close"),
    search: symbol("magnifyingglass", "search"),
    settings: symbol("gearshape", "settings"),
    location: symbol("location", "my_location"),
    locationOn: symbol("location.fill", "my_location"),
    info: symbol("info.circle", "info"),
    share: symbol("square.and.arrow.up", "share"),
    ticket: symbol("ticket", "confirmation_number"),
    warning: symbol("exclamationmark.triangle", "warning"),
    stale: symbol("clock", "schedule"),
    station: symbol("signpost.right", "departure_board"),
    // Stops that are not railway stations, shaped like their vehicles' markers
    hevStop: symbol("square", "crop_square"),
    tramTrainStop: symbol("hexagon", "hexagon"),
    childrensRailwayStop: symbol("circle", "radio_button_unchecked"),
    chevron: symbol("chevron.right", "chevron_right"),
    external: symbol("arrow.up.right", "arrow_outward"),
    noTrains: symbol("moon.zzz", "bedtime"),
    offline: symbol("wifi.slash", "cloud_off"),
    position: symbol("arrowtriangle.right.fill", "play_arrow"),
    back: symbol("chevron.left", "arrow_back"),
    collapse: symbol("chevron.down", "keyboard_arrow_down"),
    follow: symbol("star", "star_border"),
    followed: symbol("star.fill", "star"),
    route: symbol("arrow.triangle.turn.up.right.diamond", "directions"),
    swap: symbol("arrow.up.arrow.down", "swap_vert"),
    walk: symbol("figure.walk", "directions_walk"),
    list: symbol("list.bullet", "format_list_bulleted"),
    // Delay reasons, by the lucide names in core/delayReasons
    construction: symbol("hammer", "construction"),
    wrench: symbol("wrench.and.screwdriver", "build"),
    "train-front": symbol("tram.fill", "train"),
    timer: symbol("timer", "timer"),
    globe: symbol("globe", "public"),
    "git-merge": symbol("arrow.triangle.merge", "merge"),
    "traffic-cone": symbol("exclamationmark.octagon", "traffic"),
    "circle-alert": symbol("exclamationmark.circle", "error"),
    "cloud-lightning": symbol("cloud.bolt", "thunderstorm"),
    "hard-hat": symbol("hammer", "engineering"),
    siren: symbol("light.beacon.max", "emergency"),
    split: symbol("arrow.triangle.branch", "call_split"),
    "list-ordered": symbol("list.number", "format_list_numbered"),
    "zap-off": symbol("bolt.slash", "power_off"),
    shield: symbol("shield", "shield"),
    hammer: symbol("hammer", "handyman"),
    bus: symbol("bus", "directions_bus"),
} as const;

export type IconName = keyof typeof ICONS;

export function isIconName(name: string): name is IconName {
    return Object.hasOwn(ICONS, name);
}

export function Icon({
    name,
    size = 20,
    color,
    style,
}: {
    name: IconName;
    size?: number;
    color: ColorValue;
    style?: StyleProp<ViewStyle>;
}) {
    return (
        <SymbolView
            name={ICONS[name]}
            size={size}
            tintColor={color}
            style={style}
            accessible={false}
            importantForAccessibility="no"
        />
    );
}
