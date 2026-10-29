import { useState } from "react";
import { Alert } from "react-native";
import { useTranslations } from "use-intl";
import { useSettings } from "../settings/SettingsProvider";
import { eraseMyData } from "./erase";

/**
 * The "Delete my data" row: a native destructive confirmation, then a short
 * note saying whether the server was reached.
 */
export function useDeleteData() {
    const t = useTranslations("Settings");
    const { update } = useSettings();
    const [deleting, setDeleting] = useState(false);

    async function run() {
        setDeleting(true);
        try {
            const result = await eraseMyData();
            // The consent card asks again from a later launch, as if new
            update({
                analytics: "unknown",
                launchCount: 0,
                openedTrain: false,
            });
            Alert.alert(
                t("deleted_title"),
                result === "deleted" ? t("deleted_body") : t("deleted_pending"),
            );
        } catch {
            Alert.alert(t("delete_failed"));
        } finally {
            setDeleting(false);
        }
    }

    return {
        deleting,
        deleteData: () =>
            Alert.alert(t("delete_title"), t("delete_body"), [
                { text: t("cancel"), style: "cancel" },
                {
                    text: t("delete_confirm"),
                    style: "destructive",
                    onPress: () => void run(),
                },
            ]),
    };
}
