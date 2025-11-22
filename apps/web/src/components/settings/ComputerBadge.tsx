import { useTranslations } from "next-intl";
import { FaComputer } from "react-icons/fa6";
import { Badge } from "@/components/ui/badge";
import TooltipPopover from "@/components/ui/TooltipPopover";

export default function ComputerBadge() {
    const t = useTranslations("ComputerBadge");
    return (
        <TooltipPopover content={t("text")}>
            <Badge variant="outline">
                <FaComputer />
            </Badge>
        </TooltipPopover>
    );
}
