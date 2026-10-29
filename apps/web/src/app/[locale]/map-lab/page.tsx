import type { Metadata } from "next";
import { MapLab } from "./MapLab";

/** A design lab for the map: not linked anywhere and kept out of search. */
export const metadata: Metadata = {
    title: "Map lab · MHaV",
    robots: { index: false, follow: false },
};

export default function Page() {
    return <MapLab />;
}
