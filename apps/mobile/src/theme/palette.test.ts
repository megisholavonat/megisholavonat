import { COLORS } from "@megisholavonat/core/tokens";
import { describe, expect, it } from "vitest";
import { materialOverrides, rolesFromMaterial, withAlpha } from "./palette";

describe("withAlpha", () => {
    it("replaces the alpha of 6 and 8 digit colours", () => {
        expect(withAlpha("#1A6CCF", 0.12)).toBe("#1A6CCF1F");
        expect(withAlpha("#1A6CCFFF", 0)).toBe("#1A6CCF00");
        expect(withAlpha("#fff", 1)).toBe("#FFFFFFFF");
    });
});

describe("materialOverrides", () => {
    it("maps the neutral roles to #RRGGBBAA Material roles", () => {
        const m = materialOverrides(COLORS.light);
        expect(m.primary).toBe("#14161AFF");
        expect(m.onPrimary).toBe("#FFFFFFFF");
        expect(m.surface).toBe("#F4F5F7FF");
        expect(m.surfaceContainer).toBe("#FFFFFFFF");
        expect(m.outlineVariant).toBe("#DADDE2FF");
    });

    it("round-trips through rolesFromMaterial", () => {
        const roles = rolesFromMaterial(
            materialOverrides(COLORS.dark),
            COLORS.dark,
        );
        expect(roles.ink).toBe("#F2F3F5FF");
        expect(roles.surface).toBe("#17191DFF");
        expect(roles.accent).toBe(COLORS.dark.accent);
    });
});
