"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";

const OSM = {
    name: "© OpenStreetMap",
    href: "https://www.openstreetmap.org/copyright",
};

function credits(showRailway: boolean) {
    return [
        OSM,
        { name: "OpenFreeMap", href: "https://openfreemap.org" },
        { name: "OpenMapTiles", href: "https://www.openmaptiles.org" },
        ...(showRailway
            ? [
                  {
                      name: "OpenRailwayMap",
                      href: "https://www.openrailwaymap.org",
                  },
              ]
            : []),
        { name: "MapLibre", href: "https://maplibre.org" },
    ];
}

function Credit({ name, href }: { name: string; href: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink hover:underline"
        >
            {name}
        </a>
    );
}

/**
 * Map credits (the basemap's own control is off), per the design and the
 * OSMF attribution guidelines: "© OpenStreetMap" just above the sheet on
 * phones (the full list is in Settings), a full row in the bottom-right
 * corner on desktop, shortened when a side panel leaves too little room.
 */
export function MapAttribution({
    isDesktop,
    showRailway,
    insetLeft,
}: {
    isDesktop: boolean;
    showRailway: boolean;
    /** Width covered by a side panel on desktop */
    insetLeft: number;
}) {
    const t = useTranslations("Map");
    if (!isDesktop) {
        return (
            // biome-ignore lint/a11y/useSemanticElements: a labelled group of links
            <div
                role="group"
                aria-label={t("map_data")}
                className="map-attribution absolute right-4 bottom-[calc(var(--mhav-sheet-inset,0px)+0.5rem)] z-10 rounded-sm px-2 py-0.5 leading-4 transition-[bottom] duration-300 ease-sheet"
            >
                <Credit {...OSM} />
            </div>
        );
    }
    return (
        <div
            className="@container pointer-events-none absolute right-0 bottom-0 z-10 flex justify-end"
            style={{ left: insetLeft }}
        >
            {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of links */}
            <div
                role="group"
                aria-label={t("map_data")}
                className="map-attribution pointer-events-auto rounded-tl-sm px-2 py-0.5 leading-4"
            >
                <span className="hidden @[34rem]:inline">
                    {credits(showRailway).map((credit, i) => (
                        <Fragment key={credit.href}>
                            {i > 0 && <span aria-hidden> · </span>}
                            <Credit {...credit} />
                        </Fragment>
                    ))}
                </span>
                <span className="@[34rem]:hidden">
                    <Credit {...OSM} />
                </span>
            </div>
        </div>
    );
}
