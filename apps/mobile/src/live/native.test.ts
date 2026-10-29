/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Swift side can't be compiled in these tests: check what must agree
// between the app, the widget extension and the API's pushes.

const read = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const MODULE_ATTRIBUTES =
    "modules/live-activity/ios/TrainActivityAttributes.swift";
const WIDGET_ATTRIBUTES = "targets/widgets/TrainActivityAttributes.swift";

/** `var name: Type` lines of a Swift struct body */
function fields(swift: string, struct: string): Record<string, string> {
    const start = swift.indexOf(`struct ${struct}`);
    const body = swift.slice(swift.indexOf("{", start) + 1);
    const result: Record<string, string> = {};
    let depth = 0;
    for (const line of body.split("\n")) {
        if (depth === 0) {
            const m = line.match(/^\s*var (\w+): ([\w?]+)/);
            if (m?.[1] && m[2]) result[m[1]] = m[2];
        }
        depth += (line.match(/{/g) ?? []).length;
        depth -= (line.match(/}/g) ?? []).length;
        if (depth < 0) break;
    }
    return result;
}

describe("TrainActivityAttributes", () => {
    it("is the same in the app module and the widget extension", () => {
        expect(read(MODULE_ATTRIBUTES)).toBe(read(WIDGET_ATTRIBUTES));
    });

    it("has the content state the app and the API send", () => {
        expect(fields(read(WIDGET_ATTRIBUTES), "ContentState")).toEqual({
            delayMin: "Int?",
            nextStop: "String?",
            nextStopAt: "Int?",
            platform: "String?",
            platformSure: "Bool?",
            eta: "Int?",
            progress: "Double?",
            departed: "Bool?",
        });
        const api = read("../api/api/services/push_alerts.py");
        const content = api.slice(api.indexOf("def live_activity_content"));
        for (const key of Object.keys(
            fields(read(WIDGET_ATTRIBUTES), "ContentState"),
        )) {
            expect(content).toContain(`"${key}":`);
        }
    });

    it("has the attributes the app starts it with", () => {
        expect(
            Object.keys(
                fields(read(WIDGET_ATTRIBUTES), "TrainActivityAttributes"),
            ),
        ).toEqual(["followId", "badge", "title", "from", "to", "url"]);
    });
});

describe("App Group", () => {
    it("is the same for the app, the extension and the module", () => {
        const group = "group.info.megisholavonat.app";
        const app = JSON.parse(read("app.json"));
        expect(
            app.expo.ios.entitlements["com.apple.security.application-groups"],
        ).toEqual([group]);
        expect(read("targets/widgets/CommuteWidget.swift")).toContain(
            `let appGroup = "${group}"`,
        );
        expect(
            read("modules/live-activity/ios/LiveActivityModule.swift"),
        ).toContain(`let appGroup = "${group}"`);
    });
});
