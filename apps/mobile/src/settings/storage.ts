import { File, Paths } from "expo-file-system";
import { parseSettings, type Settings } from "./settings";

// A small JSON file in the app's documents. Read synchronously once at
// startup so the language and theme are right on the first frame.

const file = new File(Paths.document, "settings.json");

export function readSettings(): Settings {
    try {
        return parseSettings(file.exists ? file.textSync() : null);
    } catch {
        return parseSettings(null);
    }
}

export function writeSettings(settings: Settings): void {
    file.write(JSON.stringify(settings)).catch(() => {
        // Not critical: the next change writes again
    });
}
