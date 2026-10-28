import { defineConfig } from "vitest/config";

// Unit tests cover pure modules only (no react-native imports).
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
