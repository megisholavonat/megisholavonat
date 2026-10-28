import { describe, expect, it } from "vitest";
import {
    DELAY_REASON_TEXTS,
    DELAY_REASONS,
    delayReasonCode,
    delayReasonLabel,
    delayReasonLabelOf,
} from "./delayReasons";

describe("delayReasonCode", () => {
    it.each([
        ["Pálya állapota miatti késés", "track"],
        ["  VONAT  műszaki hibája miatti késés. ", "technical"],
        ["Más vonat által okozott késés", "other_train"],
        ["Csatlakozásra várás miatti késés", "connection"],
    ] as const)("maps exact text %j to %s", (text, code) => {
        expect(delayReasonCode(text)).toBe(code);
    });

    it.each([
        ["Győrben műszaki hiba miatt várakozik.", "technical"],
        [
            "Sülysápon hatósági intézkedés miatt várakozik. Utasai pótlóbusszal utaznak.",
            "police",
        ],
        [
            "A vonat a Kastélyparknál történt közúti baleset miatt várakozik",
            "accident",
        ],
        [
            "Várhatóan 15-20 perces késéssel érkezik a magyarországi szakaszra.",
            "partner_railway",
        ],
        [
            "Biztosítóberendezési hiba miatt a vonatok hosszabb menetidővel közlekednek.",
            "signalling",
        ],
    ] as const)("maps templated text %j to %s", (text, code) => {
        expect(delayReasonCode(text)).toBe(code);
    });

    it.each([
        "Várhatóan 10 perces késéssel indul.",
        "Utolsó kocsija lezárva közlekedik, utazásra nem vehető igénybe.",
        "constructor",
        "",
        null,
        undefined,
    ])("returns null for unknown text %j", (text) => {
        expect(delayReasonCode(text)).toBeNull();
    });
});

describe("labels", () => {
    it("labels in both locales", () => {
        expect(delayReasonLabel("technical", "hu")).toBe("Műszaki hiba");
        expect(delayReasonLabel("technical", "en")).toBe("Technical fault");
        expect(delayReasonLabelOf("Időjárási ok miatti késés", "hu")).toBe(
            "Időjárás",
        );
        expect(delayReasonLabelOf("Időjárási ok miatti késés", "en")).toBe(
            "Weather",
        );
        expect(delayReasonLabelOf("Ismeretlen szöveg", "en")).toBeNull();
    });

    it("has a label for every mapped code", () => {
        for (const code of Object.values(DELAY_REASON_TEXTS)) {
            expect(DELAY_REASONS[code].hu).toBeTruthy();
            expect(DELAY_REASONS[code].en).toBeTruthy();
        }
    });
});
