import type { ApiResponse } from "@megisholavonat/api-client";
import { Polyline } from "react-leaflet";
import { decodePolyline } from "@/util/polyline";

type Train = ApiResponse["locations"][number];

interface TrainPolylineProps {
    selectedTrain: Train | null;
}

export function TrainPolyline({ selectedTrain }: TrainPolylineProps) {
    const polylineCoordinates = selectedTrain?.trip?.tripGeometry?.points
        ? decodePolyline(selectedTrain.trip.tripGeometry.points)
        : [];

    if (polylineCoordinates.length === 0) return null;

    return (
        <Polyline
            positions={polylineCoordinates}
            pathOptions={{
                color: "#0066ff",
                weight: 4,
                opacity: 0.8,
            }}
        />
    );
}
