import type {
    StationBoard,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { trainShareText } from "@megisholavonat/core/share";
import { describe, expect, it } from "vitest";
import board from "../../../e2e/fixtures/board-departures.json";
import delayed from "../../../e2e/fixtures/train-delayed.json";
import ontime from "../../../e2e/fixtures/train-ontime.json";
import waiting from "../../../e2e/fixtures/train-waiting.json";
import {
    buildMetadata,
    type Preview,
    previewImagePath,
    previewTarget,
} from "./metadata";
import { glyphText, stationCard, trainCard, trainShareInfo } from "./model";

const ORIGIN = "https://megisholavonat.info";
const APP = {
    appTitle: "Mégis hol a vonat?",
    appDescription: "Vonatkövető alkalmazás",
};

/** Half a minute after the fixture's last position: fresh data. */
function at(vehicle: { lastUpdated: number }): Date {
    return new Date((vehicle.lastUpdated + 30) * 1000);
}

const asVehicle = (v: unknown) => v as VehiclePositionWithDelay;

describe("previewTarget", () => {
    it("reads the selection from the query", () => {
        expect(previewTarget("?vehicleId=1%3A915504313395")).toEqual({
            vehicleId: "1:915504313395",
        });
        expect(previewTarget("station=005513748")).toEqual({
            station: "005513748",
        });
        expect(previewTarget("?station=1&vehicleId=2")).toEqual({
            vehicleId: "2",
        });
        expect(previewTarget("")).toBeNull();
        expect(previewTarget("?vehicleId=")).toBeNull();
    });
});

describe("trainCard", () => {
    it("summarises a delayed train", () => {
        const card = trainCard(asVehicle(delayed), at(delayed));
        expect(card).toMatchObject({
            number: "8",
            name: "RUTHENIA",
            delay: 45,
            level: "moderate",
            stale: false,
            waiting: false,
        });
        expect(card.next?.name).toBe("Záhony");
        expect(card.next?.time).toMatch(/^\d\d:\d\d$/);
        expect(card.glyph).toBeTruthy();
    });

    it("shows the first stop of a train waiting to depart", () => {
        const vehicle = asVehicle(waiting);
        const first = vehicle.trip.stoptimes[0];
        const card = trainCard(vehicle, at(waiting));
        expect(card.waiting).toBe(true);
        expect(card.delay).toBe(0);
        expect(card.next?.name).toBe(first?.stop.name);
        expect(card.progress).toBe(0);
    });

    it("tells no delay for a cancelled, arrived or stale train", () => {
        const late = asVehicle(delayed);
        const now = at(delayed);
        for (const [activity, status] of [
            ["cancelled", "cancelled"],
            ["arrived", "arrived"],
            ["offRoute", "noData"],
        ] as const) {
            const card = trainCard({ ...late, activity }, now);
            expect(card).toMatchObject({ status, delay: 0, next: null });
            expect(trainShareText("hu", trainShareInfo(card))).not.toMatch(
                /késés/,
            );
        }
        // No position for 20 minutes
        const old = new Date((late.lastUpdated + 20 * 60) * 1000);
        const stale = trainCard({ ...late, activity: "running" }, old);
        expect(stale).toMatchObject({ status: "noData", delay: 0 });
        const running = trainCard({ ...late, activity: "running" }, now);
        expect(running).toMatchObject({ status: "running", delay: 45 });
    });

    it("fits the route sketch into the unit box", () => {
        const card = trainCard(asVehicle(ontime), at(ontime), 1.2);
        const sketch = card.sketch;
        expect(sketch).not.toBeNull();
        const points = [...(sketch?.passed ?? []), ...(sketch?.ahead ?? [])];
        expect(points.length).toBeGreaterThan(2);
        for (const [x, y] of points) {
            expect(x).toBeGreaterThanOrEqual(-0.01);
            expect(x).toBeLessThanOrEqual(1.01);
            expect(y).toBeGreaterThanOrEqual(-0.01);
            expect(y).toBeLessThanOrEqual(1.01);
        }
        expect(sketch?.ends.map((e) => e.name)).toHaveLength(2);
    });
});

describe("glyphText", () => {
    it("decodes the MNR2007 route glyph", () => {
        expect(glyphText('<span class="MNR2007">&#473;</span>')).toBe(
            String.fromCodePoint(473),
        );
        expect(glyphText("")).toBeNull();
    });
});

describe("buildMetadata", () => {
    const now = at(delayed);

    it("describes a train with a large preview image", () => {
        const preview: Preview = {
            kind: "train",
            vehicleId: "1:915504313395",
            card: trainCard(asVehicle(delayed), now),
        };
        const meta = buildMetadata({
            locale: "hu",
            origin: ORIGIN,
            ...APP,
            preview,
            now,
        });
        const og = meta.openGraph as Record<string, unknown>;
        const twitter = meta.twitter as Record<string, unknown>;
        expect(meta.title).toBe(APP.appTitle);
        expect(og.title).toBe(
            `8 RUTHENIA → ${asVehicle(delayed).trip.stoptimes.at(-1)?.stop.name}`,
        );
        expect(meta.description).toMatch(
            /^A 8-as vonat \+45 perc késésben, Záhony \d\d:\d\d$/,
        );
        expect(og.url).toBe(`${ORIGIN}/hu?vehicleId=1%3A915504313395`);
        expect(og.siteName).toBe(APP.appTitle);
        expect(og.images).toEqual([
            expect.objectContaining({
                url: previewImagePath("hu", preview, now),
                width: 1200,
                height: 630,
                type: "image/png",
            }),
        ]);
        expect(twitter.card).toBe("summary_large_image");
        expect(meta.metadataBase?.toString()).toBe(`${ORIGIN}/`);
    });

    it("stamps train images by the minute", () => {
        const preview: Preview = {
            kind: "train",
            vehicleId: "1:2",
            card: trainCard(asVehicle(delayed), now),
        };
        const path = previewImagePath(
            "en",
            preview,
            new Date("2026-10-29T03:00:30Z"),
        );
        expect(path).toBe(
            `/en/og/train/1%3A2?v=${Math.floor(Date.parse("2026-10-29T03:00:00Z") / 60_000)}`,
        );
    });

    it("lists a station's next departures", () => {
        const meta = buildMetadata({
            locale: "en",
            origin: ORIGIN,
            ...APP,
            preview: {
                kind: "station",
                stationId: "005513748",
                card: stationCard(board as StationBoard),
            },
            now,
        });
        const og = meta.openGraph as Record<string, unknown>;
        expect(og.title).toBe("Szolnok");
        expect(og.locale).toBe("en_GB");
        expect(meta.description).toMatch(
            /^Departures: \d\d:\d\d Budapest-Nyugati on time · \d\d:\d\d Hatvan cancelled · /,
        );
        expect(og.url).toBe(`${ORIGIN}/en?station=005513748`);
    });

    it("falls back to the app card for a train that is gone", () => {
        const meta = buildMetadata({
            locale: "hu",
            origin: ORIGIN,
            ...APP,
            preview: { kind: "none" },
            now,
        });
        const og = meta.openGraph as Record<string, unknown>;
        expect(og.title).toBe(APP.appTitle);
        expect(meta.description).toBe(APP.appDescription);
        expect(og.images).toEqual([
            expect.objectContaining({ url: "/hu/og", alt: APP.appTitle }),
        ]);
    });
});
