"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
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
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

function Group({ title, children }: { title?: string; children: ReactNode }) {
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
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    const id = `select-${label}`;
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
                className={cn(rowClass, "cursor-pointer")}
                onClick={onClick}
            >
                <span className="flex-1">{label}</span>
                {trailing}
            </button>
        );
    }
    if (href?.startsWith("/")) {
        return (
            <Link href={href} className={rowClass}>
                <span className="flex-1">{label}</span>
                {trailing}
            </Link>
        );
    }
    return (
        <a
            href={href}
            className={rowClass}
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
                <LinkRow label="GitHub" href={GITHUB_URL} external />
                <LinkRow
                    label={t("contact")}
                    value={CONTACT_EMAIL}
                    href={`mailto:${CONTACT_EMAIL}`}
                    external
                />
            </Group>
        </div>
    );
}

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
    const [view, setView] = useState<"main" | "changelog">("main");
    useEffect(() => {
        if (!open) setView("main");
    }, [open]);
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    className={cn(
                        "fixed z-50 flex flex-col overflow-hidden bg-canvas outline-none",
                        isDesktop
                            ? "top-1/2 left-1/2 max-h-[85vh] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-sheet shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                            : "inset-x-0 top-[max(env(safe-area-inset-top),12px)] bottom-0 rounded-t-sheet data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
                    )}
                >
                    <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                        {view === "changelog" && (
                            <button
                                type="button"
                                onClick={() => setView("main")}
                                aria-label={t("back")}
                                className="-ml-2 flex size-10 cursor-pointer items-center justify-center rounded-full"
                            >
                                <ChevronLeft className="size-6" aria-hidden />
                            </button>
                        )}
                        <DialogPrimitive.Title className="flex-1 text-title">
                            {view === "changelog" ? t("changelog") : t("title")}
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Close
                            aria-label={t("close")}
                            className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-surface text-ink"
                        >
                            <X className="size-5" aria-hidden />
                        </DialogPrimitive.Close>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)]">
                        {view === "changelog" ? (
                            <Changelog />
                        ) : (
                            <SettingsList
                                isDesktop={isDesktop}
                                onShowChangelog={() => setView("changelog")}
                                onNavigate={() => onOpenChange(false)}
                            />
                        )}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
