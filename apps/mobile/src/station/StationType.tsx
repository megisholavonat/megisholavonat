import type { Station } from "@megisholavonat/api-client";
import {
    isOtherStop,
    type StationType,
    stationType,
} from "@megisholavonat/core/stationType";
import { Text } from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import type { IconName } from "../ui/Icon";

// The kind of a stop that is not a railway station (HÉV, tram-train,
// Children's Railway), as on the web: a mark in the shape of its vehicles on
// the map and a short label.

const ICON: Record<StationType, IconName> = {
    rail: "station",
    hev: "hevStop",
    tramtrain: "tramTrainStop",
    childrens_railway: "childrensRailwayStop",
};

/** A stop's icon in lists: the signpost for railway stations. */
export function stationIcon(station: Pick<Station, "type">): IconName {
    return ICON[stationType(station)];
}

/** "HÉV-megálló", "villamos-megálló", ...; nothing for railway stations. */
export function StationTypeLabel({
    station,
}: {
    station: Pick<Station, "type">;
}) {
    const t = useTranslations("StationType");
    const theme = useAppTheme();
    if (!isOtherStop(station)) return null;
    return (
        <Text
            style={[theme.type.caption, { color: theme.colors.ink2 }]}
            numberOfLines={1}
        >
            {t(stationType(station))}
        </Text>
    );
}
