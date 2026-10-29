import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalFollow } from "./model";

// A fake API: devices d1, d2, ...; a call with a forgotten device is a 401
const fake = vi.hoisted(() => ({
    calls: [] as string[],
    devices: 0,
    valid: "",
    remote: [] as { id: string }[],
    keychain: new Map<string, string>(),
    follows: [] as unknown[],
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
vi.mock("../notifications", () => ({
    expoPushToken: async () => "ExpoToken[x]",
}));
vi.mock("./store", () => ({
    getFollows: () => fake.follows,
    putFollow: (f: { id: string }, replaces?: string) => {
        fake.follows = [
            ...(fake.follows as { id: string }[]).filter(
                (x) => x.id !== f.id && x.id !== replaces,
            ),
            f,
        ];
    },
    removeLocalFollow: (id: string) => {
        fake.follows = (fake.follows as { id: string }[]).filter(
            (x) => x.id !== id,
        );
    },
    replaceFollows: (next: unknown[]) => {
        fake.follows = next;
    },
}));
vi.mock("@megisholavonat/api-client", () => {
    const authed =
        <T>(name: string, result: (auth: string, arg: never) => T) =>
        async (arg: { auth: string }) => {
            if (!arg.auth.startsWith(`${fake.valid}.`)) {
                throw Object.assign(new Error("401"), {
                    response: { status: 401 },
                });
            }
            fake.calls.push(`${name}->${arg.auth.split(".")[0]}`);
            return result(arg.auth, arg as never);
        };
    return {
        registerDevice: async () => {
            fake.devices++;
            fake.valid = `d${fake.devices}`;
            return { data: { deviceId: fake.valid, token: "t" } };
        },
        registerPushToken: authed("push", () => ({})),
        createFollow: authed("create", (auth) => ({
            data: { id: `f-${auth.split(".")[0]}` },
        })),
        listFollows: authed("list", () => ({ data: fake.remote })),
        deleteFollow: authed(
            "delete",
            (_auth, arg: { path: { follow_id: string } }) => {
                fake.calls.push(`deleted ${arg.path.follow_id}`);
                return {};
            },
        ),
        updateFollow: authed("update", () => ({})),
    };
});

const stops = [
    { stopId: "a", stationId: "A", name: "A", time: 100 },
    { stopId: "b", stationId: "B", name: "B", time: 200 },
];
const train = {
    tripShortName: "1",
    routeShortName: null,
    stops,
    tripId: "t",
    vehicleId: null,
    serviceDate: "2099-10-29",
};
const draft = {
    weekdays: [],
    from: 0,
    to: 1,
    delayThresholdMin: 5,
    notifyPlatformChange: true,
};
const follow = (id: string): LocalFollow => ({
    ...train,
    id,
    kind: "trip",
    from: 0,
    to: 1,
    weekdays: [],
    delayThresholdMin: 5,
    notifyPlatformChange: true,
});

beforeEach(() => {
    vi.resetModules();
    fake.calls = [];
    fake.devices = 0;
    fake.valid = "";
    fake.remote = [];
    fake.keychain.clear();
    fake.follows = [];
});

describe("push token", () => {
    it("is registered again on a device that replaced a forgotten one", async () => {
        const { saveFollow, registerPush } = await import("./sync");
        await registerPush("hu");
        // The API dropped d1: the follow's 401 registers d2
        fake.valid = "gone";
        await saveFollow({ train, draft, existing: null, locale: "hu" });
        await new Promise((r) => setTimeout(r, 0));
        expect(fake.calls).toEqual(["push->d1", "create->d2", "push->d2"]);
    });

    it("is registered once per device", async () => {
        const { registerPush } = await import("./sync");
        await registerPush("hu");
        await registerPush("hu");
        expect(fake.calls).toEqual(["push->d1"]);
    });
});

describe("device replacement", () => {
    it("shares one new device between calls that got a 401 together", async () => {
        const { withDevice } = await import("./device");
        await withDevice("hu", async () => {});
        fake.valid = "gone";
        const api = await import("@megisholavonat/api-client");
        const list = (auth: string) =>
            api.listFollows({ auth, throwOnError: true } as never);
        // The second call's 401 comes back after the first replaced d1
        let release = () => {};
        const gate = new Promise<void>((r) => {
            release = r;
        });
        const late = withDevice("hu", async (auth) => {
            await gate;
            return list(auth);
        });
        const first = await withDevice("hu", list);
        release();
        const second = await late;
        expect([first.replaced, second.replaced]).toEqual([true, true]);
        expect(fake.devices).toBe(2);
        expect(fake.calls).toEqual(["list->d2", "list->d2"]);
    });
});

describe("syncFollows", () => {
    it("doesn't register a device just to sync nothing", async () => {
        const { syncFollows } = await import("./sync");
        await syncFollows("hu");
        expect(fake.devices).toBe(0);
    });

    it("deletes the API's follows the app no longer has (iOS reinstall)", async () => {
        fake.keychain.set("device-credentials", "d1.t");
        fake.valid = "d1";
        fake.remote = [{ id: "old" }];
        const { syncFollows } = await import("./sync");
        await syncFollows("hu");
        expect(fake.calls).toContain("deleted old");
    });

    it("keeps the follows the app has", async () => {
        fake.keychain.set("device-credentials", "d1.t");
        fake.valid = "d1";
        fake.remote = [{ id: "mine" }, { id: "stray" }];
        fake.follows = [follow("mine")];
        const { syncFollows } = await import("./sync");
        await syncFollows("hu");
        expect(fake.calls.filter((c) => c.startsWith("deleted"))).toEqual([
            "deleted stray",
        ]);
    });
});
