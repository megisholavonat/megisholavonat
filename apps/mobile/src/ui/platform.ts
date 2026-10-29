import { Platform } from "react-native";

/** iOS 26+: Liquid Glass materials (`.glass` button styles, glassEffect). */
export const liquidGlass =
    Platform.OS === "ios" &&
    Number.parseInt(String(Platform.Version), 10) >= 26;
