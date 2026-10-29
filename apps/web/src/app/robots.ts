import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/og/server";

/**
 * Pages are open to crawlers; link-preview images and the API proxies are
 * not. Preview bots still fetch the images: X's bot obeys robots.txt, so it
 * gets a group of its own.
 */
export default function robots(): MetadataRoute.Robots {
    const origin = siteUrl();
    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: ["/api/", "/relay-OfoJ/", "/hu/og", "/en/og"],
            },
            {
                userAgent: ["Twitterbot", "facebookexternalhit"],
                allow: "/",
                disallow: ["/api/", "/relay-OfoJ/"],
            },
        ],
        sitemap: `${origin}/sitemap.xml`,
    };
}
