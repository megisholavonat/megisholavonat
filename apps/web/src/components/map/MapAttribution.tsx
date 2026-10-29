"use client";

import { useTranslations } from "next-intl";
import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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

function CreditLinks({ showRailway }: { showRailway: boolean }) {
    return credits(showRailway).map((credit, i) => (
        <Fragment key={credit.href}>
            {i > 0 && <span aria-hidden> · </span>}
            <a
                href={credit.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink hover:underline"
            >
                {credit.name}
            </a>
        </Fragment>
    ));
}

/**
 * "© OpenStreetMap" that opens the full credits: on phones above the sheet,
 * on desktop when a side panel leaves little room for the full row.
 */
function CompactAttribution({
    showRailway,
    className,
}: {
    showRailway: boolean;
    className?: string;
}) {
    const t = useTranslations("Map");
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [open]);

    return (
        <div ref={ref} className={cn("map-attribution", className)}>
            {open ? (
                <p className="max-w-[min(20rem,calc(100vw-2rem))] px-2 py-1 leading-4">
                    <CreditLinks showRailway={showRailway} />
                </p>
            ) : (
                <button
                    type="button"
                    className="cursor-pointer px-2 py-0.5 leading-4"
                    aria-label={`${t("map_data")}: ${OSM.name}`}
                    onClick={() => setOpen(true)}
                >
                    {OSM.name}
                </button>
            )}
        </div>
    );
}

/**
 * Map credits (the basemap's own control is off): "© OpenStreetMap" just
 * above the sheet on phones, a full row in the bottom-right corner on desktop.
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
    if (!isDesktop) {
        return (
            <CompactAttribution
                showRailway={showRailway}
                className="absolute right-4 bottom-[calc(var(--mhav-sheet-inset,0px)+0.5rem)] z-10 rounded-sm transition-[bottom] duration-300 ease-sheet"
            />
        );
    }
    return (
        <div
            className="@container pointer-events-none absolute right-0 bottom-0 z-10 flex justify-end"
            style={{ left: insetLeft }}
        >
            <p className="map-attribution pointer-events-auto hidden rounded-tl-sm px-2 py-0.5 leading-4 @[34rem]:block">
                <CreditLinks showRailway={showRailway} />
            </p>
            <CompactAttribution
                showRailway={showRailway}
                className="pointer-events-auto mr-4 mb-1 rounded-sm @[34rem]:hidden"
            />
        </div>
    );
}
