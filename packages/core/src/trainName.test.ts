import { describe, expect, it } from "vitest";
import { trainName, trainNumber } from "./trainName";

describe("trainNumber", () => {
    it("takes the first word of the trip name", () => {
        expect(trainNumber("559 AGRIA InterRégió")).toBe("559");
        expect(trainNumber("  2010   személyvonat ")).toBe("2010");
        expect(trainNumber("H1500 HÉV")).toBe("H1500");
        expect(trainNumber("")).toBe("");
    });

    it("keeps the case", () => {
        expect(trainNumber("h1500 HÉV")).toBe("h1500");
    });
});

describe("trainName", () => {
    it("keeps the upper-case name and drops the category", () => {
        // Mobile used to need the whole rest upper case and showed no name
        expect(trainName("10 TRANSCARPATHIA gyorsvonat")).toBe(
            "TRANSCARPATHIA",
        );
        expect(trainName("10 TRANSCARPATHIA")).toBe("TRANSCARPATHIA");
        expect(trainName("559 AGRIA InterRégió")).toBe("AGRIA");
    });

    it("joins a name of several words", () => {
        expect(trainName("1 IC KATEDRÁLIS   InterCity")).toBe("IC KATEDRÁLIS");
    });

    it("upper-cases Hungarian letters", () => {
        expect(trainName("905 ŐRSÉG InterRégió")).toBe("ŐRSÉG");
    });

    it("has no name for a plain category", () => {
        expect(trainName("2010 személyvonat")).toBeNull();
        expect(trainName("2010")).toBeNull();
        // One letter is not a name
        expect(trainName("2010 S személyvonat")).toBeNull();
    });
});
