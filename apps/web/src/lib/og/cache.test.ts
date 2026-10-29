import { describe, expect, it } from "vitest";
import { cachedLoad } from "./cache";

describe("cachedLoad", () => {
    it("tries again after a failed load, then keeps the result", async () => {
        let calls = 0;
        const load = cachedLoad(async () => {
            calls += 1;
            if (calls === 1) throw new Error("EIO");
            return calls;
        });
        await expect(load()).rejects.toThrow("EIO");
        expect(await load()).toBe(2);
        expect(await load()).toBe(2);
        expect(calls).toBe(2);
    });

    it("shares one load between concurrent calls", async () => {
        let calls = 0;
        const load = cachedLoad(async () => ++calls);
        const [a, b] = await Promise.all([load(), load()]);
        expect([a, b, calls]).toEqual([1, 1, 1]);
    });
});
