import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..");

const targetDir = join(__dirname, "..", "src");

const WHITELIST = ["hey-api.ts"];

async function cleanSrc() {
    try {
        const filesAndFolders = await readdir(targetDir);
        for (const item of filesAndFolders) {
            if (!WHITELIST.includes(item)) {
                const itemPath = join(targetDir, item);
                await rm(itemPath, { recursive: true, force: true });
                console.log(`Successfully cleaned ${itemPath}`);
            }
        }
        console.log(
            `Successfully cleaned ${targetDir}, excluding ${WHITELIST.join(", ")}`,
        );
    } catch (error) {
        console.error(`Error cleaning ${targetDir}:`, error);
        if (error.code !== "ENOENT") {
            process.exit(1);
        }
    }
}

cleanSrc();
