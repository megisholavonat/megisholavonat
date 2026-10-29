// The app's buttons, sized by the BUTTON tokens (core tokens): pills one
// touch target tall, round icon buttons, and the design's smaller back
// button with a full-size hit area. Every one sinks a little while pressed
// (`pressable`, none with reduced motion).

import { Slot } from "@radix-ui/react-slot";
import { ChevronLeft } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "icon" | "back";

const BASE =
    "pressable inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors disabled:cursor-default disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
    // 44 px pills: the page's or the panel's main action, and the others
    primary:
        "h-(--mhav-button-height) gap-2 rounded-full bg-action px-(--mhav-button-padding-x) text-subhead font-semibold text-on-action",
    secondary:
        "h-(--mhav-button-height) gap-2 rounded-full bg-surface-2 px-(--mhav-button-padding-x) text-subhead font-semibold text-ink hover:bg-line",
    // 44 px round, icon only (close, share, follow, planner)
    icon: "size-(--mhav-button-icon) rounded-full bg-surface-2 text-ink hover:bg-line",
    // 36 px rounded square; the hit area around it is 44 px
    back: "relative size-(--mhav-button-back) rounded-md bg-surface-2 text-ink before:absolute before:-inset-1 hover:bg-line",
};

/** The classes of a button variant, for elements that cannot be a Button. */
export function buttonClass(variant: ButtonVariant, className?: string) {
    return cn(BASE, VARIANTS[variant], className);
}

type ButtonProps = ComponentProps<"button"> & {
    variant: ButtonVariant;
    /** Renders the child (a link) with the button's look */
    asChild?: boolean;
};

export function Button({
    variant,
    asChild = false,
    className,
    type = "button",
    ...props
}: ButtonProps) {
    if (asChild) {
        return <Slot className={buttonClass(variant, className)} {...props} />;
    }
    return (
        <button
            type={type}
            className={buttonClass(variant, className)}
            {...props}
        />
    );
}

/** Back to the previous view, in panel and sheet headers. */
export function BackButton({
    label,
    className,
    ...props
}: Omit<ComponentProps<"button">, "children"> & { label: string }) {
    return (
        <Button
            variant="back"
            aria-label={label}
            title={label}
            className={className}
            {...props}
        >
            <ChevronLeft className="size-5" aria-hidden />
        </Button>
    );
}
