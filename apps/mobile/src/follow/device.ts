import { registerDevice } from "@megisholavonat/api-client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// The anonymous device behind follows and alerts. Its token is shown only
// once by the API, so it lives in the Keychain / Keystore.

const KEY = "device-credentials";
/** Readable while the phone is locked too (a launch from an alert) */
const OPTIONS: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

let credentials: string | null | undefined;
let registering: Promise<string> | null = null;

/**
 * The stored credentials, or null when there are none. A failed read
 * throws and is tried again next time: taking it for "no device" would
 * register a second device, and the first one's alerts would keep coming.
 */
async function stored(): Promise<string | null> {
    if (credentials === undefined) {
        credentials = await SecureStore.getItemAsync(KEY, OPTIONS);
    }
    return credentials;
}

/** The stored `<deviceId>.<token>`, or null; a failed read throws. */
export async function storedCredentials(): Promise<string | null> {
    return stored();
}

/**
 * Forgets the device on this phone (data deletion). The next follow
 * registers a new one.
 */
export async function clearDevice(): Promise<void> {
    await registering?.catch(() => {});
    credentials = null;
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
}

/** Whether this install has registered a device yet. */
export async function hasDevice(): Promise<boolean> {
    return (await stored()) !== null;
}

/** `<deviceId>.<token>` for the bearer header; registers on first use. */
export async function deviceToken(locale: string): Promise<string> {
    const existing = await stored();
    if (existing) return existing;
    registering ??= (async () => {
        const { data } = await registerDevice({
            body: {
                platform: Platform.OS === "ios" ? "ios" : "android",
                locale,
            },
            throwOnError: true,
        });
        const value = `${data.deviceId}.${data.token}`;
        // The device exists now: use it this session even if it can't be
        // stored, rather than fail the follow being saved
        credentials = value;
        await SecureStore.setItemAsync(KEY, value, OPTIONS).catch(() => {});
        return value;
    })().finally(() => {
        registering = null;
    });
    return registering;
}

/**
 * Forget a device the API no longer knows (deleted after 180 idle days).
 * Only if it is still the current one: calls that failed together forget
 * it once and then share one new device.
 */
async function forgetDevice(stale: string): Promise<void> {
    if (credentials !== stale) return;
    credentials = null;
    await SecureStore.deleteItemAsync(KEY, OPTIONS).catch(() => {});
}

/** The HTTP status of a failed API call (an AxiosError). */
export function isStatus(error: unknown, status: number): boolean {
    const response = (error as { response?: { status?: unknown } } | null)
        ?.response;
    return response?.status === status;
}

/**
 * Runs `call` with the device token. A 401 means the device is gone: a new
 * one is registered and `call` runs once more. Returns whether the device
 * was replaced, as its follows are gone with it.
 */
export async function withDevice<T>(
    locale: string,
    call: (auth: string) => Promise<T>,
): Promise<{ result: T; replaced: boolean }> {
    const auth = await deviceToken(locale);
    try {
        return { result: await call(auth), replaced: false };
    } catch (error) {
        if (!isStatus(error, 401)) throw error;
        await forgetDevice(auth);
        return {
            result: await call(await deviceToken(locale)),
            replaced: true,
        };
    }
}
