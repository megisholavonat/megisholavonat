import { client } from "@megisholavonat/api-client/client";
import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { API_URL } from "./config";

client.setConfig({ baseURL: API_URL });

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: 2 },
    },
});

// Refetch when the app returns to the foreground, like window focus on the web.
AppState.addEventListener("change", (status) => {
    if (Platform.OS !== "web") {
        focusManager.setFocused(status === "active");
    }
});
