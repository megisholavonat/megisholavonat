import { webLinkPath } from "../linking/webLink";

/**
 * Website links handed to the app (Universal Links, App Links) go to the
 * route of their train or station; scheme links pass through to the router.
 */
export function redirectSystemPath({ path }: { path: string }): string {
    try {
        return webLinkPath(path);
    } catch {
        return "/";
    }
}
