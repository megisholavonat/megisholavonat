import type { ShareContent, ShareOptions } from "react-native";

/**
 * What the native share sheet gets for a link: the link alone, no
 * prefilled message (people delete it); the link's preview (og title,
 * description and image) carries the content. iOS shares `url` as a link,
 * with the title as a mail subject; Android only takes text, so the URL is
 * the whole message there (the title goes along as its subject).
 */
export function shareContent(
    os: string,
    { title, url }: { title: string; url: string },
): { content: ShareContent; options: ShareOptions } {
    if (os === "ios") {
        return { content: { url }, options: { subject: title } };
    }
    return { content: { message: url, title }, options: {} };
}
