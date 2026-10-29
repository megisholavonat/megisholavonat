"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import {
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/ui/ThemeProvider";
import { useAnalyticsConsent } from "@/hooks/useAnalyticsConsent";
import { type Settings, setSetting, useSettings } from "@/hooks/useSettings";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const GITHUB_URL = "https://github.com/megisholavonat/megisholavonat";
const CONTACT_EMAIL = "hello@megisholavonat.info";
const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

/** Sheet and sub-view motion: the design's sheet easing (320 ms). */
const SHEET_EASE = [0.32, 0.72, 0, 1] as const;

function Group({
    title,
    footer,
    children,
}: {
    title?: string;
    footer?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="flex flex-col gap-1.5">
            {title && (
                <h3 className="px-4 text-caption font-semibold tracking-wide text-ink-2 uppercase">
                    {title}
                </h3>
            )}
            <div className="flex flex-col overflow-hidden rounded-lg bg-surface [&>*+*]:border-t [&>*+*]:border-line">
                {children}
            </div>
            {footer && (
                <p className="px-4 text-caption font-normal text-ink-2">
                    {footer}
                </p>
            )}
        </section>
    );
}

const rowClass =
    "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-body text-ink";

function ToggleRow({
    label,
    setting,
}: {
    label: string;
    setting: keyof Omit<Settings, "stationNamesOpacity">;
}) {
    const settings = useSettings();
    const id = `setting-${setting}`;
    return (
        <div className={rowClass}>
            <label htmlFor={id} className="flex-1 cursor-pointer">
                {label}
            </label>
            <Switch
                id={id}
                checked={settings[setting]}
                onCheckedChange={(checked) => setSetting(setting, checked)}
            />
        </div>
    );
}

function SelectRow({
    name,
    label,
    value,
    options,
    onChange,
}: {
    /** Stable key for the element id; labels may hold spaces and accents */
    name: string;
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    const id = `select-${name}`;
    return (
        <div className={rowClass}>
            <label htmlFor={id} className="flex-1">
                {label}
            </label>
            <select
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="max-w-[55%] cursor-pointer appearance-none bg-transparent text-right text-ink-2 outline-none"
            >
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
            <ChevronRight className="-ml-2 size-4 text-ink-2" aria-hidden />
        </div>
    );
}

function LinkRow({
    label,
    value,
    href,
    external = false,
    onClick,
}: {
    label: string;
    value?: string;
    href?: string;
    external?: boolean;
    onClick?: () => void;
}) {
    const trailing = (
        <>
            {value && <span className="text-ink-2">{value}</span>}
            {external ? (
                <ArrowUpRight className="size-4 text-ink-2" aria-hidden />
            ) : (
                <ChevronRight className="size-4 text-ink-2" aria-hidden />
            )}
        </>
    );
    if (onClick) {
        return (
            <button
                type="button"
                className={cn(
                    rowClass,
                    "cursor-pointer transition-colors active:bg-surface-2",
                )}
                onClick={onClick}
            >
                <span className="flex-1">{label}</span>
                {trailing}
            </button>
        );
    }
    if (href?.startsWith("/")) {
        return (
            <Link
                href={href}
                className={cn(
                    rowClass,
                    "transition-colors active:bg-surface-2",
                )}
            >
                <span className="flex-1">{label}</span>
                {trailing}
            </Link>
        );
    }
    return (
        <a
            href={href}
            className={cn(rowClass, "transition-colors active:bg-surface-2")}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
        >
            <span className="flex-1">{label}</span>
            {trailing}
        </a>
    );
}

function ConsentRow() {
    const t = useTranslations("Settings");
    const [consent, setConsent] = useAnalyticsConsent();
    return (
        <div className={rowClass}>
            <label htmlFor="setting-consent" className="flex-1 cursor-pointer">
                {t("statistics")}
            </label>
            <Switch
                id="setting-consent"
                checked={consent === "granted"}
                disabled={consent === null}
                onCheckedChange={(checked) =>
                    setConsent(checked ? "granted" : "denied")
                }
            />
        </div>
    );
}

function StationNameOpacity() {
    const t = useTranslations("Settings");
    const { showStationNames, stationNamesOpacity } = useSettings();
    const [value, setValue] = useState(stationNamesOpacity);
    useEffect(() => setValue(stationNamesOpacity), [stationNamesOpacity]);
    if (!showStationNames) return null;
    return (
        <div className={cn(rowClass, "gap-4")}>
            <span id="opacity-label" className="text-ink-2">
                {t("station_names_opacity")}
            </span>
            <Slider
                value={[Math.round(value * 100)]}
                onValueChange={(v) => setValue(v[0] / 100)}
                onValueCommit={(v) =>
                    setSetting("stationNamesOpacity", v[0] / 100)
                }
                min={5}
                max={100}
                step={5}
                className="flex-1"
                aria-labelledby="opacity-label"
                aria-valuetext={`${Math.round(value * 100)}%`}
            />
        </div>
    );
}

function Changelog() {
    const locale = useLocale();
    const t = useTranslations("Settings");
    const [content, setContent] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        fetch(`/changelog-${locale}.md`)
            .then((r) => (r.ok ? r.text() : Promise.reject()))
            .then((text) => !cancelled && setContent(text))
            .catch(() => !cancelled && setContent(t("changelog_unavailable")));
        return () => {
            cancelled = true;
        };
    }, [locale, t]);
    return (
        <div className="prose prose-sm max-w-none rounded-lg bg-surface p-4 dark:prose-invert">
            {content === null ? (
                "…"
            ) : (
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            )}
        </div>
    );
}

function SettingsList({
    isDesktop,
    onShowChangelog,
    onNavigate,
}: {
    isDesktop: boolean;
    onShowChangelog: () => void;
    onNavigate: () => void;
}) {
    const t = useTranslations("Settings");
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const { theme, setTheme } = useTheme();
    return (
        <div className="flex flex-col gap-6">
            <Group>
                <SelectRow
                    name="language"
                    label={t("language")}
                    value={locale}
                    options={[
                        { value: "hu", label: "Magyar" },
                        { value: "en", label: "English" },
                    ]}
                    onChange={(value) => {
                        onNavigate();
                        router.replace(`${pathname}${window.location.search}`, {
                            locale: value,
                        });
                    }}
                />
                <SelectRow
                    name="theme"
                    label={t("theme")}
                    value={theme ?? "system"}
                    options={[
                        { value: "system", label: t("theme_system") },
                        { value: "light", label: t("theme_light") },
                        { value: "dark", label: t("theme_dark") },
                    ]}
                    onChange={setTheme}
                />
            </Group>
            <Group title={t("map")}>
                <ToggleRow
                    label={t("railway_lines")}
                    setting="showRailwayOverlay"
                />
                <ToggleRow
                    label={t("station_names")}
                    setting="showStationNames"
                />
                <StationNameOpacity />
                <ToggleRow label={t("animation")} setting="animateVehicles" />
                {isDesktop && (
                    <ToggleRow label={t("hover_info")} setting="showTooltip" />
                )}
            </Group>
            <Group title={t("vehicles")}>
                <ToggleRow label={t("trains")} setting="showTrains" />
                <ToggleRow label={t("hev")} setting="showHev" />
                <ToggleRow label={t("tramtrain")} setting="showTramTrains" />
            </Group>
            <Group>
                <LinkRow label={t("punctuality")} href="/stats" />
            </Group>
            <Group>
                <ConsentRow />
                <LinkRow label={t("privacy")} href="/privacy" />
            </Group>
            <Group>
                <LinkRow
                    label={t("map_data")}
                    value="© OpenStreetMap"
                    href={OSM_COPYRIGHT_URL}
                    external
                />
                <LinkRow label={t("changelog")} onClick={onShowChangelog} />
                <LinkRow
                    label={t("contact")}
                    value={CONTACT_EMAIL}
                    href={`mailto:${CONTACT_EMAIL}`}
                    external
                />
            </Group>
            <Group footer={t("open_source")}>
                <LinkRow label="GitHub" href={GITHUB_URL} external />
                <LinkRow
                    label={t("license")}
                    value="AGPL-3.0"
                    href={LICENSE_URL}
                    external
                />
            </Group>
            <About />
        </div>
    );
}

/** App mark and name at the end of the list. */
function About() {
    const t = useTranslations("Home");
    return (
        <div className="flex flex-col items-center gap-2 pt-2 pb-4 text-ink-2">
            <Image
                src="/icon1.png"
                alt=""
                width={40}
                height={40}
                className="rounded-[10px]"
            />
            <p className="text-caption">{t("app_title")}</p>
        </div>
    );
}

/**
 * The scrolling body of a view, with a hairline under the header once
 * scrolled and a fade at the bottom while there is more below.
 */
function ScrollArea({
    children,
    onScrolledChange,
}: {
    children: ReactNode;
    onScrolledChange: (scrolled: boolean) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [more, setMore] = useState(false);
    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        onScrolledChange(el.scrollTop > 0);
        setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    }, [onScrolledChange]);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        for (const child of el.children) observer.observe(child);
        return () => observer.disconnect();
    }, [measure]);
    return (
        <div className="relative h-full">
            <div
                ref={ref}
                onScroll={measure}
                className="h-full overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),24px)]"
            >
                {children}
            </div>
            <div
                aria-hidden
                className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-canvas to-transparent transition-opacity duration-200",
                    more ? "opacity-100" : "opacity-0",
                )}
            />
        </div>
    );
}

type View = "main" | "changelog";

/**
 * Sub-views slide like a navigation stack: the pushed view comes in from
 * the right while the list shifts a third to the left (and back on pop).
 */
const slideVariants = {
    enter: (direction: number) => ({
        x: direction > 0 ? "100%" : "-30%",
        opacity: direction > 0 ? 1 : 0.6,
    }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({
        x: direction > 0 ? "-30%" : "100%",
        opacity: direction > 0 ? 0.6 : 1,
    }),
};

/**
 * Settings: a full-height sheet on phones, a dialog on desktop. Grouped rows
 * in the platform style, no explanations.
 */
export function SettingsDialog({
    open,
    onOpenChange,
    isDesktop,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isDesktop: boolean;
}) {
    const t = useTranslations("Settings");
    const reduceMotion = useReducedMotion() ?? false;
    const [view, setView] = useState<View>("main");
    const [scrolled, setScrolled] = useState(false);
    useEffect(() => {
        if (!open) setView("main");
    }, [open]);
    // +1 pushes the changelog in from the right, -1 pops back to the list
    const direction = view === "main" ? -1 : 1;
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 duration-320 ease-sheet data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    className={cn(
                        "fixed z-50 flex flex-col overflow-hidden bg-canvas outline-none ease-sheet data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none",
                        isDesktop
                            ? "top-1/2 left-1/2 h-[min(85vh,720px)] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-sheet shadow-2xl duration-200 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                            : "inset-x-0 top-[max(env(safe-area-inset-top),12px)] bottom-0 rounded-t-sheet shadow-[0_-4px_20px_rgb(0_0_0/0.1)] duration-320 data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-240 data-[state=open]:slide-in-from-bottom",
                    )}
                >
                    {!isDesktop && (
                        <div
                            aria-hidden
                            className="flex h-5 shrink-0 items-end justify-center"
                        >
                            <span className="h-[5px] w-10 rounded-full bg-line" />
                        </div>
                    )}
                    <div
                        className={cn(
                            "flex shrink-0 items-center gap-2 border-b px-4 pb-3 transition-colors",
                            isDesktop ? "pt-4" : "pt-2",
                            scrolled ? "border-line" : "border-transparent",
                        )}
                    >
                        <AnimatePresence initial={false}>
                            {view === "changelog" && (
                                <motion.button
                                    key="back"
                                    type="button"
                                    onClick={() => setView("main")}
                                    aria-label={t("back")}
                                    className="pressable -ml-2 flex h-10 cursor-pointer items-center justify-center overflow-hidden rounded-full hover:bg-surface"
                                    initial={{ opacity: 0, width: 0 }}
                                    animate={{ opacity: 1, width: 40 }}
                                    exit={{ opacity: 0, width: 0 }}
                                    transition={{
                                        duration: reduceMotion ? 0 : 0.24,
                                        ease: SHEET_EASE,
                                    }}
                                >
                                    <ChevronLeft
                                        className="size-6 shrink-0"
                                        aria-hidden
                                    />
                                </motion.button>
                            )}
                        </AnimatePresence>
                        <DialogPrimitive.Title className="flex-1 truncate text-title">
                            {view === "changelog" ? t("changelog") : t("title")}
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Close
                            aria-label={t("close")}
                            className="pressable flex size-10 cursor-pointer items-center justify-center rounded-full bg-surface text-ink hover:bg-surface-2"
                        >
                            <X className="size-5" aria-hidden />
                        </DialogPrimitive.Close>
                    </div>
                    <div className="relative min-h-0 flex-1 overflow-hidden">
                        <AnimatePresence initial={false} custom={direction}>
                            <motion.div
                                key={view}
                                custom={direction}
                                variants={slideVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                                transition={{
                                    duration: reduceMotion ? 0 : 0.32,
                                    ease: SHEET_EASE,
                                }}
                                className="absolute inset-0 bg-canvas pt-1"
                            >
                                <ScrollArea onScrolledChange={setScrolled}>
                                    {view === "changelog" ? (
                                        <Changelog />
                                    ) : (
                                        <SettingsList
                                            isDesktop={isDesktop}
                                            onShowChangelog={() =>
                                                setView("changelog")
                                            }
                                            onNavigate={() =>
                                                onOpenChange(false)
                                            }
                                        />
                                    )}
                                </ScrollArea>
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
