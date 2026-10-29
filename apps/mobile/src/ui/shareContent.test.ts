import { describe, expect, it } from "vitest";
import { shareContent } from "./shareContent";

const link = {
    title: "8 → Debrecen",
    url: "https://megisholavonat.info/hu?vehicleId=1%3A915504313395",
};

describe("shareContent", () => {
    it("shares only the link on iOS, the title as a subject", () => {
        expect(shareContent("ios", link)).toEqual({
            content: { url: link.url },
            options: { subject: link.title },
        });
    });

    it("sends the bare URL as Android's message, no prefilled text", () => {
        const { content } = shareContent("android", link);
        expect(content).toEqual({ message: link.url, title: link.title });
    });
});
