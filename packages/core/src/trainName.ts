// Train numbers and names from a trip's `tripShortName`, such as
// "10 TRANSCARPATHIA gyorsvonat", "2010 személyvonat" or "H1500 HÉV".
// The API derives the number the same way (util/trip.py).

/** "10 TRANSCARPATHIA gyorsvonat" -> "10"; the key of the history endpoints. */
export function trainNumber(tripShortName: string): string {
    return tripShortName.trim().split(/\s+/, 1)[0] ?? tripShortName;
}

/**
 * The train's name without its category: "10 TRANSCARPATHIA gyorsvonat" ->
 * "TRANSCARPATHIA", "2010 személyvonat" -> null. Names are the upper-case run.
 */
export function trainName(tripShortName: string): string | null {
    const words = tripShortName.trim().split(/\s+/).slice(1);
    const named = words.filter(
        (w) => w.length > 1 && w === w.toLocaleUpperCase("hu"),
    );
    return named.length > 0 ? named.join(" ") : null;
}
