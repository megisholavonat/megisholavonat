import { NextRequest, type NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { SEARCH_HEADER } from "./lib/og/server";

const intl = createMiddleware(routing);

export default function proxy(request: NextRequest): NextResponse {
    // Layouts don't get the query string; the link preview metadata needs it
    const headers = new Headers(request.headers);
    headers.set(SEARCH_HEADER, request.nextUrl.search);
    return intl(new NextRequest(request, { headers }));
}

export const config = {
    matcher: "/((?!api|_next|relay-OfoJ|.*\\..*).*)",
};
