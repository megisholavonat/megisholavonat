import { useTranslations } from "next-intl";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Z_LAYERS } from "@/util/constants";

interface NoDataDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    dataAgeMinutes?: number;
}

export function NoDataDialog({
    open,
    onOpenChange,
    dataAgeMinutes,
}: NoDataDialogProps) {
    const t = useTranslations("NoDataDialog");

    // Show different message based on whether we have stale data or no data at all
    const isStaleData = dataAgeMinutes !== undefined && dataAgeMinutes > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent style={{ zIndex: Z_LAYERS.DIALOGS + 1 }}>
                <DialogHeader>
                    <DialogTitle>
                        {isStaleData ? t("stale_data_title") : t("title")}
                    </DialogTitle>
                    <DialogDescription>
                        {isStaleData
                            ? t("stale_data_description", {
                                  minutes: dataAgeMinutes,
                              })
                            : t("description")}
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
}
