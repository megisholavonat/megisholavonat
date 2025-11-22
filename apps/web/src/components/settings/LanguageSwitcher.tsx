"use client";

import { motion } from "motion/react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const languages = [
    {
        code: "hu",
        name: "Magyar",
        flag: "HU",
    },
    {
        code: "en",
        name: "English",
        flag: "GB",
    },
];

interface LanguageSwitcherProps {
    currentLocale: string;
}

export function LanguageSwitcher({ currentLocale }: LanguageSwitcherProps) {
    const pathname = usePathname();
    const t = useTranslations("LanguageSwitcher");

    // Find the other language (not current)
    const otherLanguage = languages.find((lang) => lang.code !== currentLocale);

    if (!otherLanguage) {
        return null;
    }

    return (
        <Link href={pathname} locale={otherLanguage.code} className="block">
            <motion.div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-lg bg-white/80 hover:text-blue-600 hover:bg-blue-50 border border-gray-200 hover:border-gray-300 hover:shadow-md transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                aria-label={t("switch_to", { language: otherLanguage.name })}
                title={otherLanguage.name}
            >
                {/* {otherLanguage.flag} */}
                <Image
                    src={`https://purecatamphetamine.github.io/country-flag-icons/3x2/${otherLanguage.flag}.svg`}
                    alt={otherLanguage.name}
                    width={20}
                    height={20}
                />
            </motion.div>
        </Link>
    );
}
