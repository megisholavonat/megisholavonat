import { registerDevice } from "@megisholavonat/api-client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// The anonymous device behind follows and alerts. Its token is shown only
// once by the API, so it lives in the Keychain / Keystore.

const KEY = "device-credentials";

let credentials: string | null | undefined;
let registering: Promise<string> | null = null;

async function stored(): Promise<string | null> {
    if (credentials === undefined) {
        credentials = await SecureStore.getItemAsync(KEY).catch(() => null);
    }
    return credentials;
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
        await SecureStore.setItemAsync(KEY, value);
        credentials = value;
        return value;
    })().finally(() => {
        registering = null;
    });
    return registering;
}

/** Forget a device the API no longer knows (deleted after 180 idle days). */
async function forgetDevice(): Promise<void> {
    credentials = null;
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
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
    try {
        return {
            result: await call(await deviceToken(locale)),
            replaced: false,
        };
    } catch (error) {
        if (!isStatus(error, 401)) throw error;
        await forgetDevice();
        return {
            result: await call(await deviceToken(locale)),
            replaced: true,
        };
    }
}
