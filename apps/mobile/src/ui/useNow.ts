import { useEffect, useState } from "react";

/** The current time, updated every `intervalMs`, for ages and staleness. */
export function useNow(intervalMs: number): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return now;
}
