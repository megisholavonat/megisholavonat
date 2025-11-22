import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

import TooltipPopover from "./TooltipPopover";

export default function NewFeature() {
    const t = useTranslations("NewFeature");

    return (
        <TooltipPopover content={t("text")}>
            <Badge className=" dark:bg-blue-800 bg-blue-600 text-white">
                <span aria-hidden="true" className="scale-125">
                    🎉
                </span>
            </Badge>
        </TooltipPopover>
    );
}
