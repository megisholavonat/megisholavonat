import { assetLinks } from "@/lib/appLinks";

export const dynamic = "force-static";

export function GET(): Response {
    return Response.json(assetLinks);
}
