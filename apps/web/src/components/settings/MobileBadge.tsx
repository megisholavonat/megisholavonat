import { useTranslations } from "next-intl";
import { FaMobile } from "react-icons/fa6";
import { Badge } from "@/components/ui/badge";
import TooltipPopover from "../ui/TooltipPopover";

export default function MobileBadge() {
    const t = useTranslations("MobileBadge");
    return (
        <TooltipPopover content={t("text")}>
            <Badge variant="outline">
                <FaMobile />
            </Badge>
        </TooltipPopover>
    );
}
