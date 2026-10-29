import type { Station } from "@megisholavonat/api-client";
import { type PlannerParam, plannerLink } from "@megisholavonat/core/links";
import { ANY_BUDAPEST } from "@megisholavonat/core/planner";
import { fromBudapestTime } from "@megisholavonat/core/time";
import type { PlannerState } from "./store";

// The planner of a shared web link (see webLinkPath): its parameters as the
// website writes them, read by the same rules (core links). Unit tested.

const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A station known by id only, until its name is looked up. */
export function stationStub(id: string): Station {
    return id === ANY_BUDAPEST.id
        ? ANY_BUDAPEST
        : { id, name: "", lat: 0, lon: 0 };
}

export function plannerFromLink(
    params: Partial<Record<PlannerParam, string>>,
): Partial<PlannerState> | null {
    const link = plannerLink({ get: (name) => params[name as PlannerParam] });
    if (!link) return null;
    const station = (id: string | null) => (id ? stationStub(id) : null);
    const from = station(link.from);
    const to = station(link.to);
    const match = link.time ? TIME.exec(link.time) : null;
    const time = match
        ? fromBudapestTime({
              year: Number(match[1]),
              month: Number(match[2]),
              day: Number(match[3]),
              hour: Number(match[4]),
              minute: Number(match[5]),
          })
        : null;
    return { from, to, time, arriveBy: time !== null && link.arriveBy };
}
