import { describe, expect, it } from "vitest";
import { isOtherStop, stationType } from "./stationType";

describe("stationType", () => {
    it("takes the API's type", () => {
        expect(stationType({ type: "hev" })).toBe("hev");
        expect(isOtherStop({ type: "tramtrain" })).toBe(true);
    });

    it("counts stations without a type as railway stations", () => {
        // Recent stations saved before the API typed them
        expect(stationType({})).toBe("rail");
        expect(isOtherStop({ type: null })).toBe(false);
    });
});
