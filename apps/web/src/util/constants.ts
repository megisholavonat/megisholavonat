export const RED_THRESHOLD = 60;
export const ORANGE_THRESHOLD = 15;
export const YELLOW_THRESHOLD = 5;

export const Z_LAYERS = {
    BASE: 0,
    ROUTE_LINE: 1, // Blue route polyline
    TRAIN_MARKERS_DEFAULT: 50, // Unselected trains
    STOP_MARKERS: 100, // White stop markers
    STOP_LABELS: 200, // Stop name labels (part of stop markers)
    TRAIN_MARKERS_SELECTED: 400, // Selected train
    USER_LOCATION_MARKER: 500, // User location marker
    MAP_CONTROLS: 1300, // Zoom buttons, location button
    SEARCH_BUTTON: 1400, // Search button
    HEADER: 1500, // Top header bar (must be higher than MAP_CONTROLS)
    PANELS: 2000, // Train panels, modals
    SEARCH_DROPDOWN: 2500, // Search results dropdown
    DIALOGS: 5000, // Settings dialog
    DIALOG_SELECT: 5100, // Select dropdowns inside dialogs
    TOOLTIPS: 6000, // Tooltips and popovers
} as const;
