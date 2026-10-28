import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Permission plumbing only. Device registration with the API (/v1/devices)
// comes with the alerts backend.

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
