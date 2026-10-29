import type { Station } from "@megisholavonat/api-client";
import { ANY_BUDAPEST } from "@megisholavonat/core/planner";
import { fromBudapestTime } from "@megisholavonat/core/time";
import type { PlannerState } from "./store";

// The planner of a shared web link (see webLinkPath): its parameters as the
// website writes them. Unit tested.

const STATION = /^(\d{9}|budapest)$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A station known by id only, until its name is looked up. */
export function stationStub(id: string): Station {
    return id === ANY_BUDAPEST.id
        ? ANY_BUDAPEST
        : { id, name: "", lat: 0, lon: 0 };
}

export function plannerFromLink(params: {
    from?: string;
    to?: string;
    time?: string;
    arriveBy?: string;
}): Partial<PlannerState> | null {
    const station = (id: string | undefined) =>
        id && STATION.test(id) ? stationStub(id) : null;
    const from = station(params.from);
    const to = station(params.to);
    if (!from && !to) return null;
    const match = params.time ? TIME.exec(params.time) : null;
    const time = match
        ? fromBudapestTime({
              year: Number(match[1]),
              month: Number(match[2]),
              day: Number(match[3]),
              hour: Number(match[4]),
              minute: Number(match[5]),
          })
        : null;
    return { from, to, time, arriveBy: params.arriveBy === "1" };
}
