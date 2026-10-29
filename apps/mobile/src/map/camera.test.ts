import { FRAME_INTERVAL_MS } from "@megisholavonat/core/vehicleMotion";
import { describe, expect, it } from "vitest";
import {
    contains,
    degreesPerPx,
    frameIntervalMs,
    grow,
    MAX_FRAME_INTERVAL_MS,
    projectPx,
    STACK_SPREAD_PX,
    sheetPadding,
    shouldListStack,
    spreadPx,
} from "./camera";

describe("projection", () => {
    it("doubles distances with every zoom level", () => {
        const a: [number, number] = [19.0, 47.5];
        const b: [number, number] = [19.01, 47.5];
        const d12 = projectPx(b, 12)[0] - projectPx(a, 12)[0];
        const d13 = projectPx(b, 13)[0] - projectPx(a, 13)[0];
        expect(d13).toBeCloseTo(d12 * 2, 6);
        // 0.01° of longitude is 512 · 2^12 / 36 000 px at z12
        expect(d12).toBeCloseTo((512 * 4096) / 36_000, 6);
    });

    it("measures a group's spread on its larger side", () => {
        expect(spreadPx([[19, 47.5]], 12)).toBe(0);
        const spread = spreadPx(
            [
                [19, 47.5],
                [19.0001, 47.5001],
            ],
            19,
        );
        expect(spread).toBeGreaterThan(30);
    });
});

describe("shouldListStack", () => {
    const platform: [number, number][] = [
        [19.0834, 47.5],
        [19.08341, 47.50001],
        [19.08342, 47.5],
    ];

    it("lists trains that still overlap when the bubble expands", () => {
        expect(spreadPx(platform, 15)).toBeLessThan(STACK_SPREAD_PX);
        expect(shouldListStack(platform, 15, 19)).toBe(true);
    });

    it("zooms when they come apart, or lists past the max zoom", () => {
        const apart: [number, number][] = [
            [19.08, 47.5],
            [19.09, 47.5],
            [19.1, 47.5],
        ];
        expect(shouldListStack(apart, 14, 19)).toBe(false);
        expect(shouldListStack(apart, 20, 19)).toBe(true);
    });
});

describe("sheetPadding", () => {
    it("keeps the target above the sheet, up to 60 % of the screen", () => {
        expect(sheetPadding(null, 800)).toBe(0);
        expect(sheetPadding(0.22, 800)).toBe(176);
        expect(sheetPadding(1, 800)).toBe(480);
    });
});

describe("frameIntervalMs", () => {
    it("redraws at 12 fps close in and rarely at country zoom", () => {
        expect(frameIntervalMs(15)).toBe(FRAME_INTERVAL_MS);
        expect(frameIntervalMs(6)).toBe(MAX_FRAME_INTERVAL_MS);
        const city = frameIntervalMs(11);
        expect(city).toBeGreaterThan(FRAME_INTERVAL_MS);
        expect(city).toBeLessThan(MAX_FRAME_INTERVAL_MS);
        expect(frameIntervalMs(10)).toBeGreaterThan(city);
    });

    it("snaps jumps under a pixel", () => {
        expect(degreesPerPx(13)).toBeCloseTo(360 / (512 * 8192), 12);
    });
});

describe("bounds", () => {
    it("grows the view by a margin and tests points in it", () => {
        const view = [19, 47, 20, 48] as const;
        const area = grow(view, 0.1);
        expect(area).toEqual([18.9, 46.9, 20.1, 48.1]);
        expect(contains(area, [20.05, 47.5])).toBe(true);
        expect(contains(view, [20.05, 47.5])).toBe(false);
    });
});
