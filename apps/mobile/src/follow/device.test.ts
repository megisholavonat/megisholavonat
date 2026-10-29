import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
    AFTER_FIRST_UNLOCK: 0,
}));
const api = vi.hoisted(() => ({ registerDevice: vi.fn() }));

vi.mock("expo-secure-store", () => store);
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@megisholavonat/api-client", () => api);

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    api.registerDevice.mockResolvedValue({
        data: { deviceId: "d1", token: "t1" },
    });
    store.setItemAsync.mockResolvedValue(undefined);
    store.deleteItemAsync.mockResolvedValue(undefined);
});

describe("device credentials", () => {
    it("doesn't register a second device when the Keychain can't be read", async () => {
        store.getItemAsync.mockRejectedValueOnce(new Error("locked"));
        const { deviceToken } = await import("./device");
        await expect(deviceToken("hu")).rejects.toThrow("locked");
        expect(api.registerDevice).not.toHaveBeenCalled();

        // Read again next time
        store.getItemAsync.mockResolvedValueOnce("d0.t0");
        await expect(deviceToken("hu")).resolves.toBe("d0.t0");
        expect(api.registerDevice).not.toHaveBeenCalled();
    });

    it("keeps a new device for the session when it can't be stored", async () => {
        store.getItemAsync.mockResolvedValue(null);
        store.setItemAsync.mockRejectedValue(new Error("full"));
        const { deviceToken } = await import("./device");
        await expect(deviceToken("hu")).resolves.toBe("d1.t1");
        await expect(deviceToken("hu")).resolves.toBe("d1.t1");
        expect(api.registerDevice).toHaveBeenCalledTimes(1);
    });

    it("replaces a device the API forgot (401) and runs the call again", async () => {
        store.getItemAsync.mockResolvedValue("d0.t0");
        const { withDevice } = await import("./device");
        const call = vi
            .fn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockResolvedValueOnce("ok");
        await expect(withDevice("hu", call)).resolves.toEqual({
            result: "ok",
            replaced: true,
        });
        expect(call.mock.calls).toEqual([["d0.t0"], ["d1.t1"]]);
        expect(store.deleteItemAsync).toHaveBeenCalled();
    });
});
