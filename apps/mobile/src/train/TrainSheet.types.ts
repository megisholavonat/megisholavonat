export type TrainSheetProps = {
    /** Selected train, or null when the sheet should be closed. */
    vehicleId: string | null;
    onClose: () => void;
};
