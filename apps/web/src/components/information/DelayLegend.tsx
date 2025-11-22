import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
    FaChevronUp,
    FaCircleExclamation,
    FaCircleInfo,
} from "react-icons/fa6";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";

const delayRanges = [
    { label: "on_time", color: "#4AD94A" },
    { label: "small_delay", color: "#E4DE3A" },
    { label: "medium_delay", color: "#DF9227" },
    { label: "large_delay", color: "#D9564A" },
    { label: "no_data", color: "#9CA3AF" },
];

interface DelayLegendProps {
    dataAgeMinutes?: number;
    hasTrains?: boolean;
}

export function DelayLegend({ dataAgeMinutes, hasTrains }: DelayLegendProps) {
    const t = useTranslations("DelayLegend");
    const tNoData = useTranslations("NoDataDialog");
    const [isOpen, setIsOpen] = useState(false);

    // Check if data is outdated (has age but not too old)
    const isOutdated = dataAgeMinutes !== undefined && dataAgeMinutes > 1;
    const isVeryOld = isOutdated && dataAgeMinutes >= 15;

    // Show warning text above legend when data is >= 15 minutes and trains are displaying
    const showWarningAbove = isVeryOld && hasTrains;

    return (
        <div className="relative">
            {/* Warning text above legend when data is >= 15 minutes old and trains are displaying */}
            <AnimatePresence>
                {showWarningAbove && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute bottom-full right-0 mb-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 rounded-lg px-3 py-2 shadow-md max-w-xs z-10"
                    >
                        <div className="flex items-start gap-2">
                            <FaCircleExclamation className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                            <div className="text-sm text-red-800 dark:text-red-200">
                                <div className="font-semibold mb-1">
                                    {tNoData("stale_data_title")}
                                </div>
                                <div className="text-xs">
                                    {tNoData("stale_data_description", {
                                        minutes: dataAgeMinutes,
                                    })}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                <CollapsibleTrigger asChild>
                    <motion.button
                        className={`w-12 h-12 bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-full shadow-lg border border-gray-200/50 dark:border-border flex items-center justify-center transition-colors group hover:bg-white dark:hover:bg-black/95 ${
                            isOutdated
                                ? "text-red-600 dark:text-red-400 border-red-300 dark:border-red-700"
                                : isOpen
                                  ? "text-blue-600 dark:text-blue-400"
                                  : "text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
                        }`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        aria-label={t("aria_label")}
                    >
                        <motion.div
                            animate={{ rotate: isOpen ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            {isOpen ? (
                                <FaChevronUp className="w-4 h-4 scale-110" />
                            ) : isOutdated ? (
                                <FaCircleExclamation className="w-4 h-4" />
                            ) : (
                                <FaCircleInfo className="w-4 h-4" />
                            )}
                        </motion.div>
                    </motion.button>
                </CollapsibleTrigger>

                <AnimatePresence>
                    {isOpen && (
                        <div className="absolute bottom-full right-0 mb-2">
                            <CollapsibleContent forceMount asChild>
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    transition={{
                                        duration: 0.2,
                                        ease: "easeOut",
                                    }}
                                    className="bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-xl p-4 shadow-lg border border-gray-200/50 dark:border-border w-64 max-w-[calc(100vw-2rem)]"
                                >
                                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                                        <FaCircleInfo className="w-4 h-4 text-blue-600 dark:text-blue-400" />

                                        {t("title")}
                                    </h3>

                                    {/* Warning message when data is outdated but < 15 minutes */}
                                    {isOutdated && !isVeryOld && (
                                        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 rounded-lg">
                                            <div className="flex items-start gap-2">
                                                <FaCircleExclamation className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                                                <div className="text-xs text-red-800 dark:text-red-200">
                                                    <div className="font-semibold mb-1">
                                                        {tNoData(
                                                            "stale_data_title",
                                                        )}
                                                    </div>
                                                    <div>
                                                        {tNoData(
                                                            "stale_data_description",
                                                            {
                                                                minutes:
                                                                    dataAgeMinutes,
                                                            },
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        {delayRanges.map((item, index) => (
                                            <motion.div
                                                key={item.label}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{
                                                    delay: index * 0.05,
                                                    duration: 0.3,
                                                }}
                                                className="flex items-center gap-3"
                                            >
                                                <div
                                                    className="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 shadow-sm shrink-0"
                                                    style={{
                                                        backgroundColor:
                                                            item.color,
                                                    }}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                                        {t(
                                                            `labels.${item.label}`,
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-gray-600 dark:text-gray-400">
                                                        {t(
                                                            `ranges.${item.label}`,
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {t("note")}
                                        </p>
                                    </div>
                                </motion.div>
                            </CollapsibleContent>
                        </div>
                    )}
                </AnimatePresence>
            </Collapsible>
        </div>
    );
}
