import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Permission and push token plumbing. Permission is asked only when the user
// follows a train, never on launch.

export const ALERTS_CHANNEL_ID = "train-alerts";

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

/** Android 13+ only shows the permission prompt once a channel exists. */
async function ensureAndroidChannel(name: string) {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
        name,
        importance: Notifications.AndroidImportance.HIGH,
    });
}

export async function getNotificationPermission() {
    return Notifications.getPermissionsAsync();
}

/** Asks for permission if it hasn't been decided yet. */
export async function requestNotificationPermission(channelName: string) {
    await ensureAndroidChannel(channelName);
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || !current.canAskAgain) return current;
    return Notifications.requestPermissionsAsync();
}

/** The Expo push token, or null without permission (or on a simulator). */
export async function expoPushToken(): Promise<string | null> {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return null;
    const projectId =
        Constants.easConfig?.projectId ??
        (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
            ?.projectId;
    try {
        const { data } = await Notifications.getExpoPushTokenAsync({
            projectId,
        });
        return data;
    } catch {
        return null;
    }
}

/** The train a notification is about, from the alert's data. */
export function notificationVehicleId(
    response: Notifications.NotificationResponse,
): string | null {
    const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
    const vehicleId = data?.vehicleId;
    return typeof vehicleId === "string" && vehicleId ? vehicleId : null;
}
