import type { ReactNode } from "react";

export interface MapChromeProps {
    onSearch: () => void;
    onSettings: () => void;
    onLocate: () => void;
    /** The camera follows the user */
    following: boolean;
    /** Opens the native attribution list of the map */
    onAttribution: () => void;
    /** Cards above the search bar: states, consent */
    children?: ReactNode;
}
