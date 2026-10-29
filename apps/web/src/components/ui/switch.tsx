"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Switch({
    className,
    ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(
                "peer relative inline-flex h-7 w-12 shrink-0 before:absolute before:-inset-x-1 before:-inset-y-2.5 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-action data-[state=unchecked]:bg-line",
                className,
            )}
            {...props}
        >
            <SwitchPrimitive.Thumb
                data-slot="switch-thumb"
                className={cn(
                    "pointer-events-none block size-6 rounded-full bg-surface shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-on-action data-[state=unchecked]:translate-x-0",
                )}
            />
        </SwitchPrimitive.Root>
    );
}

export { Switch };
