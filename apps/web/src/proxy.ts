import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { SEARCH_HEADER } from "./lib/og/server";

const intl = createMiddleware(routing);

export default function proxy(request: NextRequest): NextResponse {
    // Layouts don't get the query string; the link preview metadata needs it
    const headers = new Headers(request.headers);
    headers.set(SEARCH_HEADER, request.nextUrl.search);
    // next-intl decodes the path and rewrites to it: an encoded "%" ("%25")
    // becomes a bare "%" that Next cannot parse, a 500. Such a path skips
    // it; the page still has its locale from the [locale] segment.
    if (request.nextUrl.pathname.toLowerCase().includes("%25")) {
        return NextResponse.next({ request: { headers } });
    }
    return intl(new NextRequest(request, { headers }));
}

// Never /.well-known/: the app link files must come back as they are, not
// redirected to a locale
export const config = {
    matcher: "/((?!api|_next|relay-OfoJ|\\.well-known|.*\\..*).*)",
};
