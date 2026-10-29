export interface TimeFieldProps {
    /** Unix milliseconds; null is now */
    value: number | null;
    onChange: (value: number | null) => void;
}
