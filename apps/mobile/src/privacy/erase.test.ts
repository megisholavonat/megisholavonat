import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
    keychain: new Map<string, string>(),
    /** What DELETE /v1/devices/me does: ok, a status, or offline */
    api: "ok" as "ok" | 401 | 404 | 500 | "offline",
    deleted: [] as string[],
    local: [] as string[],
}));

vi.mock("expo-secure-store", () => ({
    AFTER_FIRST_UNLOCK: 0,
    getItemAsync: async (k: string) => fake.keychain.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
        fake.keychain.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
        fake.keychain.delete(k);
    },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@megisholavonat/api-client", () => ({
    registerDevice: async () => ({ data: { deviceId: "d9", token: "t" } }),
    deleteDevice: async ({ auth }: { auth: string }) => {
        if (fake.api === "offline") throw new Error("Network Error");
        if (fake.api !== "ok") {
            throw Object.assign(new Error(String(fake.api)), {
                response: { status: fake.api },
            });
        }
        fake.deleted.push(auth);
        return {};
    },
}));
vi.mock("../api", () => ({
    queryClient: { clear: () => fake.local.push("queries") },
}));
vi.mock("../follow/store", () => ({
    clearFollows: () => fake.local.push("follows"),
}));
vi.mock("../follow/sync", () => ({
    resetPushRegistration: () => fake.local.push("push registration"),
}));
vi.mock("../notifications", () => ({
    forgetPushToken: async () => {
        fake.local.push("push token");
    },
}));
vi.mock("../journey/store", () => ({
    planner: { reset: () => fake.local.push("planner") },
}));

const LOCAL = [
    "follows",
    "push registration",
    "push token",
    "planner",
    "queries",
];

beforeEach(() => {
    vi.resetModules();
    fake.keychain = new Map([["device-credentials", "d1.t1"]]);
    fake.api = "ok";
    fake.deleted = [];
    fake.local = [];
});

describe("delete my data", () => {
    it("deletes the device on the API and everything on the phone", async () => {
        const { eraseMyData, onErase } = await import("./erase");
        onErase(() => fake.local.push("live activities"));
        await expect(eraseMyData()).resolves.toBe("deleted");
        expect(fake.deleted).toEqual(["d1.t1"]);
        expect(fake.keychain.size).toBe(0);
        expect(fake.local).toEqual(["live activities", ...LOCAL]);
    });

    it.each([
        401, 404,
    ] as const)("takes a device the API no longer has (%i) as deleted", async (status) => {
        fake.api = status;
        const { eraseMyData } = await import("./erase");
        await expect(eraseMyData()).resolves.toBe("deleted");
        expect(fake.keychain.size).toBe(0);
        expect(fake.local).toEqual(LOCAL);
    });

    it("clears the phone without a device", async () => {
        fake.keychain.clear();
        const { eraseMyData } = await import("./erase");
        await expect(eraseMyData()).resolves.toBe("deleted");
        expect(fake.deleted).toEqual([]);
        expect(fake.local).toEqual(LOCAL);
    });

    it.each([
        "offline",
        500,
    ] as const)("%s: clears the phone and retries on a later launch", async (failure) => {
        fake.api = failure;
        const { eraseMyData, retryPendingErasure } = await import("./erase");
        await expect(eraseMyData()).resolves.toBe("pending");
        expect(fake.local).toEqual(LOCAL);
        // Only the credentials needed to delete it are kept
        expect([...fake.keychain]).toEqual([["pending-erasure", "d1.t1"]]);

        await retryPendingErasure();
        expect(fake.keychain.size).toBe(1);

        fake.api = "ok";
        await retryPendingErasure();
        expect(fake.deleted).toEqual(["d1.t1"]);
        expect(fake.keychain.size).toBe(0);
    });

    it("keeps every pending device until each is deleted", async () => {
        fake.api = "offline";
        let erase = await import("./erase");
        await erase.eraseMyData();
        // A new follow made a new device, deleted offline too
        fake.keychain.set("device-credentials", "d2.t2");
        vi.resetModules();
        erase = await import("./erase");
        await erase.eraseMyData();
        expect(fake.keychain.get("pending-erasure")).toBe("d1.t1\nd2.t2");

        fake.api = "ok";
        await erase.retryPendingErasure();
        expect(fake.deleted).toEqual(["d1.t1", "d2.t2"]);
        expect(fake.keychain.size).toBe(0);
    });

    it("deletes nothing when the credentials can't be read", async () => {
        const store = await import("expo-secure-store");
        vi.spyOn(store, "getItemAsync").mockRejectedValueOnce(
            new Error("locked"),
        );
        const { eraseMyData } = await import("./erase");
        await expect(eraseMyData()).rejects.toThrow("locked");
        expect(fake.local).toEqual([]);
        expect(fake.keychain.get("device-credentials")).toBe("d1.t1");
    });
});
