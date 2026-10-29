// Fails when the translations do not have the same keys: a key missing in
// one language shows up as a raw "Namespace.key" on screen.
import { readFileSync } from "node:fs";

const LOCALES = ["hu", "en"];

function keys(value, prefix = "") {
    if (typeof value !== "object" || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, child]) =>
        keys(child, prefix ? `${prefix}.${key}` : key),
    );
}

const sets = Object.fromEntries(
    LOCALES.map((locale) => {
        const url = new URL(`../messages/${locale}.json`, import.meta.url);
        return [locale, new Set(keys(JSON.parse(readFileSync(url, "utf8"))))];
    }),
);

let failed = false;
for (const locale of LOCALES) {
    for (const other of LOCALES) {
        if (other === locale) continue;
        const missing = [...sets[other]].filter((k) => !sets[locale].has(k));
        for (const key of missing) {
            console.error(`messages/${locale}.json is missing ${key}`);
            failed = true;
        }
    }
}
if (failed) process.exit(1);
console.log(`messages: ${sets.hu.size} keys in ${LOCALES.join(" and ")}`);
