import type React from "react";
import { cn } from "@/lib/utils";

export type InfoBoxVariant = "info" | "success" | "warning" | "error";

interface InfoBoxProps {
    children: React.ReactNode;
    variant?: InfoBoxVariant;
    icon?: React.ElementType;
    className?: string;
}

const variantStyles: Record<InfoBoxVariant, string> = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    success: "border-green-200 bg-green-50 text-green-800",
    warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
    error: "border-red-200 bg-red-50 text-red-800",
};

const iconStyles: Record<InfoBoxVariant, string> = {
    info: "text-blue-600",
    success: "text-green-600",
    warning: "text-yellow-600",
    error: "text-red-600",
};

export function InfoBox({
    children,
    variant = "info",
    icon: Icon,
    className,
}: InfoBoxProps) {
    return (
        <div
            className={cn(
                "rounded-lg border p-4 text-sm",
                variantStyles[variant],
                className,
            )}
        >
            <div className="flex items-center gap-3">
                {Icon && (
                    <Icon
                        className={cn("h-5 w-5 shrink-0", iconStyles[variant])}
                    />
                )}
                <div className="flex-1">{children}</div>
            </div>
        </div>
    );
}
