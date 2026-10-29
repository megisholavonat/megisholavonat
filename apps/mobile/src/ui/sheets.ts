// The native sheets' detents, as shares of the screen height: the root
// layout presents the sheets with them and the map keeps clear of them.

/**
 * Train: peek · half · full (design board 2). Android allows at most three
 * detents, iOS any number; both use the native sheet.
 */
export const TRAIN_DETENTS = [0.22, 0.5, 1];
/** Station board: half and full */
export const STATION_DETENTS = [0.6, 1];
/** Search on iOS: medium (map in view) and large (typing) */
export const SEARCH_DETENTS = [0.55, 1];
