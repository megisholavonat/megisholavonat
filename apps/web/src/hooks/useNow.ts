import { useEffect, useState } from "react";

/** How often train states are re-judged against the clock. */
const TICK_MS = 15_000;

const tickOf = (ms: number) => Math.floor(ms / TICK_MS) * TICK_MS;

/**
 * The current time (ms), advancing in whole TICK_MS steps on the wall clock.
 * Every caller sees the same value at the same moment, so the map and the
 * train sheet judge staleness against one clock.
 */
export function useNow(): number {
    const [now, setNow] = useState(() => tickOf(Date.now()));
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const schedule = () => {
            const wall = Date.now();
            setNow(tickOf(wall));
            timer = setTimeout(schedule, tickOf(wall) + TICK_MS - wall + 5);
        };
        schedule();
        return () => clearTimeout(timer);
    }, []);
    return now;
}
