import type { Disruption } from "@megisholavonat/api-client";
import { getDisruptionsOptions } from "@megisholavonat/api-client/react-query";
import { isDisruptionActive } from "@megisholavonat/core/disruptions";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNow } from "../ui/useNow";

/** The feed changes slowly; the API caches it for two minutes */
const REFRESH_MS = 2 * 60_000;

/** Active line and network disruptions, worst and newest first. */
export function useDisruptions(): Disruption[] {
    const now = useNow();
    const { data } = useQuery({
        ...getDisruptionsOptions(),
        refetchInterval: REFRESH_MS,
        staleTime: REFRESH_MS,
    });
    return useMemo(
        () =>
            (data ?? []).filter((d) =>
                isDisruptionActive(d, now.getTime() / 1000),
            ),
        [data, now],
    );
}
