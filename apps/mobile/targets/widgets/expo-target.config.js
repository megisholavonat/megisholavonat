// The WidgetKit extension (@bacons/apple-targets): the followed train's Live
// Activity and the commute widget. Its App Group must match the app's
// (app.json ios.entitlements) and APP_GROUP in modules/live-activity.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
    type: "widget",
    name: "MHaVWidgets",
    displayName: "MHaV",
    bundleIdentifier: ".widgets",
    deploymentTarget: "17.0",
    frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
    entitlements: {
        "com.apple.security.application-groups":
            config.ios.entitlements["com.apple.security.application-groups"],
    },
});
