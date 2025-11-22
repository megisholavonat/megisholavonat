import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Z_LAYERS } from "@/util/constants";

interface TooltipPopoverProps {
    children: React.ReactNode;
    content: string;
}

export default function TooltipPopover({
    children,
    content,
}: TooltipPopoverProps) {
    const isMobile = useIsMobile();
    if (isMobile) {
        return (
            <Popover>
                <PopoverTrigger asChild>{children}</PopoverTrigger>
                <PopoverContent
                    className="w-auto max-w-[280px] p-2"
                    style={{ zIndex: Z_LAYERS.TOOLTIPS }}
                >
                    <p className="text-sm break-words">{content}</p>
                </PopoverContent>
            </Popover>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent style={{ zIndex: Z_LAYERS.TOOLTIPS }}>
                <p>{content}</p>
            </TooltipContent>
        </Tooltip>
    );
}
