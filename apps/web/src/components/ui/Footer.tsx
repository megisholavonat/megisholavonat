"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { FaGithub } from "react-icons/fa";
import { LuMail, LuScale } from "react-icons/lu";

export default function Footer() {
    const tHome = useTranslations("Home");

    return (
        <footer className="bg-black/5 dark:bg-white/5 rounded-xl mt-8 py-8">
            <div className="flex flex-col items-center gap-4">
                {/* Logo and App Name */}
                <div className="flex items-center gap-3">
                    <Image src="/icon1.png" alt="Logo" width={32} height={32} />
                    <span className="text-lg font-semibold text-foreground">
                        {tHome("app_title")}
                    </span>
                </div>

                {/* Links */}
                <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm">
                    {/* GitHub */}
                    <a
                        href="https://github.com/megisholavonat/megisholavonat"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <FaGithub className="w-4 h-4" />
                        <span>GitHub</span>
                    </a>

                    {/* Email */}
                    <a
                        href="mailto:hello@megisholavonat.info"
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <LuMail className="w-4 h-4" />
                        <span>hello@megisholavonat.info</span>
                    </a>

                    {/* License */}
                    <a
                        href="https://github.com/megisholavonat/megisholavonat?tab=License-1-ov-file#readme"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <LuScale className="w-4 h-4" />
                        <span>License</span>
                    </a>
                </div>
            </div>
        </footer>
    );
}
