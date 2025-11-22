import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
    input: "../../apps/api/openapi.json",
    output: { path: "src", format: "biome", clean: false },
    plugins: [
        { name: "@hey-api/client-axios", runtimeConfigPath: "./hey-api" },
        "@tanstack/react-query",
        "zod",
    ],
});
