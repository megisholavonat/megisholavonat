/**
 * The files that let a shared train or station link open the native app
 * (iOS Universal Links, Android App Links), served under /.well-known/.
 * Any other link, and every link without the app, stays on the web.
 */

const APPLE_TEAM_ID = "YMX8RUHNUC";
export const APP_ID = "info.megisholavonat.app";

/**
 * SHA-256 fingerprints of the Android signing certificates, "AA:BB:...".
 * PLACEHOLDER: replace with the one `eas credentials -p android` shows for
 * the production build profile (and, once on Google Play, also the app
 * signing key from Play Console > Test and release > App signing). Until
 * then Android can't verify the domain and links keep opening the browser.
 */
export const ANDROID_CERT_FINGERPRINTS = [
    "REPLACE_WITH_EAS_SHA256_FINGERPRINT",
];

/** Share links: /{hu|en}?vehicleId=… or ?station=… (shareUrl in core). */
const SHARE_PATHS = ["/", "/hu", "/en"];
const SHARE_PARAMS = ["vehicleId", "station"];

export const appleAppSiteAssociation = {
    applinks: {
        details: [
            {
                appIDs: [`${APPLE_TEAM_ID}.${APP_ID}`],
                components: [
                    // Stats, privacy, link previews: always the web
                    ...["/hu/*", "/en/*"].map((path) => ({
                        "/": path,
                        exclude: true,
                    })),
                    ...SHARE_PATHS.flatMap((path) =>
                        SHARE_PARAMS.map((param) => ({
                            "/": path,
                            "?": { [param]: "?*" },
                        })),
                    ),
                ],
            },
        ],
    },
};

export const assetLinks = [
    {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
            namespace: "android_app",
            package_name: APP_ID,
            sha256_cert_fingerprints: ANDROID_CERT_FINGERPRINTS,
        },
    },
];
