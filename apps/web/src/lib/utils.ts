import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system's type scale (globals.css): `text-title` is a size, not a
// colour, so it must not knock out `text-delay-*` colours when merged
const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            text: ["delay-xl", "title", "headline", "body", "caption"],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
