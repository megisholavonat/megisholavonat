import { describe, expect, it } from "vitest";
import { formatUICCode, vehicleTypeFromUICCode } from "./uic";

describe("formatUICCode", () => {
    it("formats a prefixed 12-digit UIC number", () => {
        expect(formatUICCode("1:915504800123")).toBe("91 55 0480 012-3");
    });

    it("left-pads short numbers without a prefix", () => {
        expect(formatUICCode("480012")).toBe("00 00 0048 001-2");
    });
});

describe("vehicleTypeFromUICCode", () => {
    it("maps the type digits to a vehicle type", () => {
        expect(vehicleTypeFromUICCode("1:915504800123")).toBe("traxx");
        expect(vehicleTypeFromUICCode("1:000000000000")).toBe("suburban");
        expect(vehicleTypeFromUICCode("1:999999999999")).toBe("unknown");
    });

    it("splits FLIRT units by serial number", () => {
        expect(vehicleTypeFromUICCode("1:945514150600")).toBe("flirt2_older");
        expect(vehicleTypeFromUICCode("1:945514150610")).toBe("flirt2_new");
    });
});
