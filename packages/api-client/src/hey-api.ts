import type { CreateClientConfig } from "./client.gen";

export const createClientConfig: CreateClientConfig = (config) => ({
    ...config,
    baseURL:
        process.env.API_URL ??
        process.env.NEXT_PUBLIC_API_URL ??
        process.env.EXPO_PUBLIC_API_URL ??
        "/api",
});
