import { describe, expect, it } from "vitest";
import {
    huTrainSubject,
    shareUrl,
    stationShareText,
    stationShareTitle,
    trainShareStatus,
    trainShareText,
} from "./share";

describe("shareUrl", () => {
    it("links a train or a station under the locale", () => {
        expect(
            shareUrl("https://megisholavonat.info/", "hu", {
                vehicleId: "1:918061939438",
            }),
        ).toBe("https://megisholavonat.info/hu?vehicleId=1%3A918061939438");
        expect(
            shareUrl("http://localhost:3000", "en", { station: "005510017" }),
        ).toBe("http://localhost:3000/en?station=005510017");
    });
});

describe("huTrainSubject", () => {
    it.each([
        ["10", "A 10-es vonat"],
        ["5", "Az 5-ös vonat"],
        ["1", "Az 1-es vonat"],
        ["6", "A 6-os vonat"],
        ["8", "A 8-as vonat"],
        ["346", "A 346-os vonat"],
        ["2030", "A 2030-as vonat"],
        ["7810", "A 7810-es vonat"],
        ["5819", "Az 5819-es vonat"],
        ["1141", "Az 1141-es vonat"],
        ["100", "A 100-as vonat"],
        ["2000", "A 2000-es vonat"],
        ["55", "Az 55-ös vonat"],
        ["15", "A 15-ös vonat"],
        ["H8000", "A H8000 vonat"],
    ])("%s -> %s", (number, expected) => {
        expect(huTrainSubject(number)).toBe(expected);
    });
});

describe("trainShareText", () => {
    const next = { name: "Debrecen", time: "02:06" };

    it("says the delay and the next stop", () => {
        expect(
            trainShareText("hu", {
                number: "10",
                delay: 9,
                waiting: false,
                next,
            }),
        ).toBe("A 10-es vonat 9 percet késik, Debrecen 02:06");
        expect(
            trainShareText("en", {
                number: "10",
                delay: 9,
                waiting: false,
                next,
            }),
        ).toBe("Train 10 is 9 min late, Debrecen 02:06");
    });

    it("marks a forecast time with ≈", () => {
        expect(
            trainShareText("hu", {
                number: "650",
                delay: 15,
                waiting: false,
                next: { name: "Szolnok", time: "06:07", estimated: true },
            }),
        ).toBe("A 650-es vonat 15 percet késik, Szolnok ≈06:07");
        expect(
            trainShareText("en", {
                number: "650",
                delay: 15,
                waiting: false,
                next: { name: "Szolnok", time: "06:07", estimated: true },
            }),
        ).toBe("Train 650 is 15 min late, Szolnok ≈06:07");
    });

    it("tells small delays in minutes too", () => {
        expect(
            trainShareText("hu", {
                number: "5",
                delay: 2,
                waiting: false,
                next,
            }),
        ).toBe("Az 5-ös vonat 2 percet késik, Debrecen 02:06");
    });

    it("tells a train waiting to depart", () => {
        expect(
            trainShareText("en", {
                number: "10",
                delay: 0,
                waiting: true,
                next: { name: "Budapest-Keleti", time: "22:40" },
            }),
        ).toBe("Train 10 is waiting to depart, Budapest-Keleti 22:40");
    });

    it("leaves out a missing next stop", () => {
        expect(
            trainShareText("hu", {
                number: "10",
                delay: 30,
                waiting: false,
                next: null,
            }),
        ).toBe("A 10-es vonat 30 percet késik");
    });

    it("tells no delay for a train that is not running", () => {
        const info = { number: "10", delay: 12, waiting: false, next };
        expect(trainShareText("hu", { ...info, status: "cancelled" })).toBe(
            "A 10-es vonat törölve",
        );
        expect(trainShareText("hu", { ...info, status: "arrived" })).toBe(
            "A 10-es vonat megérkezett",
        );
        expect(trainShareText("hu", { ...info, status: "noData" })).toBe(
            "A 10-es vonatról nincs friss adat",
        );
        expect(trainShareText("en", { ...info, status: "arrived" })).toBe(
            "Train 10 has arrived",
        );
        expect(
            trainShareText("hu", { ...info, status: "offRoute" }),
        ).not.toMatch(/friss adat/);
        expect(trainShareText("en", { ...info, status: "noData" })).toBe(
            "No fresh data on train 10",
        );
    });
});

describe("trainShareStatus", () => {
    const base = {
        level: "stale" as const,
        outdated: false,
        minutesSinceUpdate: 0,
        label: "",
        delay: null,
    };

    it("follows the train's display state", () => {
        expect(
            trainShareStatus({
                ...base,
                state: "running",
                activity: "running",
                level: "slight",
                delay: 7,
            }),
        ).toBe("running");
        expect(
            trainShareStatus({
                ...base,
                state: "cancelled",
                activity: "cancelled",
            }),
        ).toBe("cancelled");
        expect(
            trainShareStatus({ ...base, state: "idle", activity: "arrived" }),
        ).toBe("arrived");
        expect(
            trainShareStatus({
                ...base,
                state: "idle",
                activity: "beforeDeparture",
            }),
        ).toBe("waiting");
        // Fresh, but off its route: no delay, yet not "no fresh data"
        expect(
            trainShareStatus({ ...base, state: "idle", activity: "offRoute" }),
        ).toBe("offRoute");
        expect(
            trainShareStatus({
                ...base,
                state: "idle",
                activity: "offRoute",
                outdated: true,
            }),
        ).toBe("noData");
        expect(
            trainShareStatus({
                ...base,
                state: "stale",
                activity: "running",
                outdated: true,
                delay: 7,
            }),
        ).toBe("noData");
    });
});

describe("stationShareTitle", () => {
    it("says the link opens the live departures", () => {
        expect(stationShareTitle("hu", "Szolnok")).toBe(
            "Szolnok – indulások élőben",
        );
        expect(stationShareTitle("en", "Szolnok")).toBe(
            "Szolnok – live departures",
        );
    });
});

describe("stationShareText", () => {
    it("lists the next departures", () => {
        expect(
            stationShareText("hu", [
                {
                    time: "04:00",
                    headsign: "Miskolc-Tiszai",
                    delay: 0,
                    canceled: false,
                },
                {
                    time: "04:10",
                    headsign: "Szolnok",
                    delay: 7,
                    canceled: false,
                },
                { time: "04:20", headsign: "Cegléd", delay: 0, canceled: true },
                {
                    time: "04:30",
                    headsign: "Vác",
                    delay: null,
                    canceled: false,
                },
            ]),
        ).toBe(
            "Indulások: 04:00 Miskolc-Tiszai 0 · 04:10 Szolnok +7 · 04:20 Cegléd törölve · 04:30 Vác",
        );
    });

    it("has a fallback for an empty board", () => {
        expect(stationShareText("en", [])).toBe("Live departures and delays");
    });
});
