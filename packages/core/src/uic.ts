export function formatUICCode(vehicleId: string): string {
    // Remove the prefix and get the numeric part
    const numericPart = vehicleId.split(":")[1] || vehicleId;

    // Ensure we have exactly 12 digits, pad with zeros if necessary
    const paddedNumber = numericPart.padStart(12, "0");

    // Format as: XX XX XXXX XXX-X
    const formatted = `${paddedNumber.slice(0, 2)} ${paddedNumber.slice(
        2,
        4,
    )} ${paddedNumber.slice(4, 8)} ${paddedNumber.slice(
        8,
        11,
    )}-${paddedNumber.slice(11, 12)}`;

    return formatted;
}

export function vehicleTypeFromUICCode(vehicleId: string): string {
    // Remove the prefix and get the numeric part
    const numericPart = vehicleId.split(":")[1] || vehicleId;

    // Ensure we have exactly 12 digits, pad with zeros if necessary
    const paddedNumber = numericPart.padStart(12, "0");
    const typeId = paddedNumber.slice(4, 8);
    const serialNumber = Number.parseInt(paddedNumber.slice(8, 11), 10);
    switch (typeId) {
        case "0480":
            return "traxx";

        case "0470":
            return "taurus1";

        case "0630":
            // TODO Differentiate 1xx and 0xx series(some 1xx units can go with 160km/h)
            return "v63";

        case "0431":
            return "v431";

        case "0432":
            return "v432";

        case "0433":
            return "v433";

        case "0460":
            // Shunting locomotive, should not appear in passenger service
            return "v46";

        case "1815":
            return "kiss";

        case "1415":
            //There is also a green one
            if (serialNumber <= 60) return "flirt2_older";
            return "flirt2_new";

        case "1435":
            // Softer seats, only at GySEV
            return "flirt3";

        case "1426":
            return "desiro";

        case "0117":
            return "bzmot";

        case "1416":
            // Does not have a proper type name from the manufacturer
            return "mvm";

        case "0136":
            return "twin_bzmot";

        case "0127":
            return "ip_bzmot";

        case "1425":
            return "talent";

        case "1116":
            return "taurus2";

        case "6182":
            return "taurus3";

        case "6193":
        case "7193":
            return "vectron1";

        case "0471":
            return "vectron2";

        case "1406":
            return "citylink";

        case "0247":
            return "jenbacher";

        case "0418":
            return "m41";

        case "0478":
            return "m47";

        case "0001":
            return "dsb_me";

        case "1446":
            return "twin_jenbacher";

        //HÉV trains do not have an UIC code so it gets parsed as all zeros in the type part
        case "0000":
            //Currently MIX/MIXAs are pulled from service but there is one "modernised" unit
            return "suburban";

        default:
            // TODO Use localization
            return "unknown";
    }
}
