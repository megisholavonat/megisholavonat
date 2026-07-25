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
import { useEffect, useState } from "react";

interface TooltipPopoverProps {
    children: React.ReactNode;
    content: string;
}

export default function TooltipPopover({
    children,
    content,
}: TooltipPopoverProps) {
    const isMobile = useIsMobile();
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (!isMobile || !isOpen) {
            return;
        }

        const closePopover = () => {
            setIsOpen(false);
        };

        document.addEventListener("scroll", closePopover, true);
        window.addEventListener("touchmove", closePopover, {
            passive: true,
        });

        return () => {
            document.removeEventListener("scroll", closePopover, true);
            window.removeEventListener("touchmove", closePopover);
        };
    }, [isMobile, isOpen]);

    if (isMobile) {
        return (
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>{children}</PopoverTrigger>
                <PopoverContent
                    className="w-auto max-w-70 p-2"
                    style={{ zIndex: Z_LAYERS.TOOLTIPS }}
                >
                    <p className="text-sm wrap-break-word">{content}</p>
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
