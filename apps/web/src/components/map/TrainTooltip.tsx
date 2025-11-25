import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import MAVRouteIcon from "@/components/ui/MavRouteIcon";

interface TrainTooltipProps {
    featureProperties: TrainFeatureProperties;
}

export function TrainTooltip({ featureProperties }: TrainTooltipProps) {
    const tripName = featureProperties.tripShortName;
    const isCapital = (char: string) => {
        return (char >= "A" && char <= "Z") || "ÁÉÍÓÖŐÚÜŰ".includes(char);
    };

    // Find first 2 consecutive capitals
    let startPos = -1;
    if (tripName) {
        for (let i = 0; i < tripName.length - 1; i++) {
            if (isCapital(tripName[i]) && isCapital(tripName[i + 1])) {
                startPos = i;
                break;
            }
        }
    }

    // Find last 2 consecutive capitals
    let endPos = -1;
    if (tripName) {
        for (let i = tripName.length - 2; i >= 0; i--) {
            if (isCapital(tripName[i]) && isCapital(tripName[i + 1])) {
                endPos = i + 1; // Include the second capital
                break;
            }
        }
    }

    // Extract text from first capital to last capital (inclusive)
    let extractedText: string | null = null;
    if (startPos !== -1 && endPos !== -1 && startPos <= endPos && tripName) {
        extractedText = tripName.substring(startPos, endPos + 1);
    }

    const tripNameDisplay = tripName ? (
        <>
            {extractedText && (
                <span className="text-sm font-bold">{extractedText}</span>
            )}
            {tripName.endsWith("TramTrain") && (
                <span className="text-sm font-bold">TramTrain</span>
            )}
        </>
    ) : null;

    return (
        <div
            className="text-base font-medium flex items-center gap-2 pt-1"
            style={{
                color: `#${featureProperties.routeTextColor}`,
                fontFamily: "inherit",
            }}
        >
            <MAVRouteIcon routeShortName={featureProperties.routeShortName} />
            {tripNameDisplay}
        </div>
    );
}
