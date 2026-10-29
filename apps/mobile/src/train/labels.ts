import {
    getMavRouteCode,
    getMavRouteName,
} from "@megisholavonat/core/mavRoutes";

export type RouteLabel =
    | { kind: "glyph"; glyph: string; name: string | null }
    | { kind: "text"; text: string }
    | null;

/**
 * Turns the API's `routeShortName` (an HTML snippet such as
 * `<span class="MNR2007">&#484;</span>`, or plain text) into something a
 * native Text can render: a glyph of the MNR2007 font, or plain text.
 */
export function routeLabel(routeShortName?: string | null): RouteLabel {
    if (!routeShortName) return null;

    const isFontGlyph = /&#[xX]?[0-9a-fA-F]+;/.test(routeShortName);
    const code = getMavRouteCode(routeShortName);
    if (isFontGlyph && code !== null) {
        return {
            kind: "glyph",
            glyph: String.fromCodePoint(code),
            name: getMavRouteName(routeShortName),
        };
    }

    const name = getMavRouteName(routeShortName);
    return name ? { kind: "text", text: name } : null;
}
