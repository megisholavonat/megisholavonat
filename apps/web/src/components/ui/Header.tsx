"use client";

import type { ApiResponse } from "@megisholavonat/api-client";
import { motion } from "motion/react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { LuMail } from "react-icons/lu";
import SearchComponent from "@/components/information/SearchComponent";
import SettingsComponent from "@/components/settings/SettingsComponent";
import { Z_LAYERS } from "@/util/constants";

interface HeaderProps {
    data: ApiResponse | undefined;
    onSearchResultClick: (vehicleId: string) => void;
}

export default function Header({ data, onSearchResultClick }: HeaderProps) {
    const t = useTranslations("Home");

    return (
        <motion.div
            className="absolute top-4 left-0 right-0 flex justify-center"
            style={{ zIndex: Z_LAYERS.HEADER, pointerEvents: "none" }}
        >
            <motion.div
                className="bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-2xl px-3 sm:px-6 py-2 sm:py-3 shadow-lg border border-gray-200/50 dark:border-white/50 max-w-[calc(100vw-2rem)] transition-all duration-300"
                style={{ pointerEvents: "auto" }}
            >
                <div className="flex items-center gap-2 sm:gap-4">
                    {/* Logo */}
                    <motion.div
                        className="shrink-0"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                            delay: 0.2,
                            duration: 0.5,
                            ease: "easeOut",
                        }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <Image
                            src="/icon1.png"
                            alt="Logo"
                            width={28}
                            height={28}
                            className="rounded-lg sm:w-8 sm:h-8"
                        />
                    </motion.div>

                    {/* App Title */}
                    <div className="hidden md:block">
                        <motion.h1
                            className="text-lg font-semibold text-gray-800 dark:text-white whitespace-nowrap"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                                delay: 0.4,
                                duration: 0.5,
                                ease: "easeOut",
                            }}
                        >
                            {t("app_title")}
                        </motion.h1>
                    </div>
                    <div className="flex flex-row">
                        {/* Search */}
                        <motion.div
                            className="border-x border-gray-300 dark:border-border px-2 sm:px-4 shrink-0"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                                delay: 0.6,
                                duration: 0.5,
                                ease: "easeOut",
                            }}
                        >
                            <SearchComponent
                                data={data}
                                onResultClick={onSearchResultClick}
                            />
                        </motion.div>

                        {/* Settings */}
                        <motion.div
                            className="border-r border-gray-300 dark:border-border px-2 sm:px-4 shrink-0"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                                delay: 0.6,
                                duration: 0.5,
                                ease: "easeOut",
                            }}
                        >
                            <SettingsComponent />
                        </motion.div>
                    </div>

                    {/* Contact Email */}
                    <motion.div
                        className="shrink-0 "
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                            delay: 1.0,
                            duration: 0.5,
                            ease: "easeOut",
                        }}
                    >
                        <motion.a
                            href="mailto:hello@megisholavonat.info"
                            className="text-gray-600 dark:text-white hover:text-blue-600 dark:hover:text-white rounded-lg hover:bg-blue-50 dark:hover:bg-black/95 hover:shadow-md transition-colors flex items-center gap-1 sm:gap-2 p-2"
                            whileHover={{
                                scale: 1.02,
                            }}
                            transition={{ duration: 0.2 }}
                        >
                            <LuMail className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 dark:text-white" />
                            <span className="hidden lg:inline whitespace-nowrap text-sm">
                                hello@megisholavonat.info
                            </span>
                            <span className="hidden sm:inline lg:hidden whitespace-nowrap text-sm">
                                {t("contact_us")}
                            </span>
                        </motion.a>
                    </motion.div>
                </div>
            </motion.div>
        </motion.div>
    );
}
