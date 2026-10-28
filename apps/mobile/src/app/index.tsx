import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { TrainMap } from "../map/TrainMap";
import { TrainSheet } from "../train/TrainSheet";

export default function MapScreen() {
    const router = useRouter();
    // Android keeps the selection here for its Compose sheet; iOS pushes the
    // form sheet route instead.
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const openTrain = (vehicleId: string) => {
        if (Platform.OS === "ios") {
            router.push({
                pathname: "/train/[vehicleId]",
                params: { vehicleId },
            });
        } else {
            setSelectedId(vehicleId);
        }
    };

    return (
        <View style={{ flex: 1 }}>
            <TrainMap onTrainPress={openTrain} />
            <TrainSheet
                vehicleId={selectedId}
                onClose={() => setSelectedId(null)}
            />
        </View>
    );
}
