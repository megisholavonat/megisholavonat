// Expo uses `expo.name` for the Android launcher label (`app_name`). The full
// name is too long for the home screen, so override it with the same short
// label that iOS gets through `CFBundleDisplayName`.
const { AndroidConfig, withStringsXml } = require("expo/config-plugins");

/** @type {import("expo/config-plugins").ConfigPlugin<{ label: string }>} */
const withAndroidAppLabel = (config, { label }) =>
    withStringsXml(config, (mod) => {
        mod.modResults = AndroidConfig.Strings.setStringItem(
            [
                AndroidConfig.Resources.buildResourceItem({
                    name: "app_name",
                    value: label,
                }),
            ],
            mod.modResults,
        );
        return mod;
    });

module.exports = withAndroidAppLabel;
