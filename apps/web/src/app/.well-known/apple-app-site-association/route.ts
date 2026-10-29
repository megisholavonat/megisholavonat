import { appleAppSiteAssociation } from "@/lib/appLinks";

export const dynamic = "force-static";

// Apple's CDN fetches it: JSON, no extension, no redirect
export function GET(): Response {
    return Response.json(appleAppSiteAssociation);
}
