import { Platform, Share } from "react-native";
import { shareContent } from "./shareContent";

/** Opens the native share sheet with a link alone (see `shareContent`). */
export function shareLink(data: { title: string; url: string }) {
    const { content, options } = shareContent(Platform.OS, data);
    return Share.share(content, options);
}
