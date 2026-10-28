import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
    input: "../../apps/api/openapi.json",
    output: { path: "src", clean: false, preferExportAll: true },
    plugins: [
        { name: "@hey-api/client-axios", runtimeConfigPath: "./src/hey-api" },
        "@tanstack/react-query",
        "zod",
    ],
});
