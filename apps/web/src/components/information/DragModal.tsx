"use client";
import {
    AnimatePresence,
    motion,
    useDragControls,
    useMotionValue,
} from "motion/react";
import { useTranslations } from "next-intl";
import {
    type Dispatch,
    type ReactNode,
    type SetStateAction,
    useEffect,
    useState,
} from "react";
import { LuChevronDown, LuChevronUp, LuX } from "react-icons/lu";
import { Z_LAYERS } from "@/util/constants";

interface Props {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    children?: ReactNode;
    initialState?: State;
    onStateChange?: (state: State) => void;
}

type State = "collapsed" | "normal" | "expanded";

// Heights using dynamic viewport units for mobile browser UI handling
const heights: Record<State, string> = {
    collapsed: "40vh",
    normal: "60vh",
    expanded: "100dvh", // Dynamic viewport height adapts to mobile browser UI
};

export const DragCloseDrawer = ({
    open,
    setOpen,
    children,
    initialState = "normal",
    onStateChange,
}: Props) => {
    const t = useTranslations("DragModal");
    const y = useMotionValue(0);
    const controls = useDragControls();
    const [state, setState] = useState<State>(initialState);

    // Reset state to initial when modal is opened
    useEffect(() => {
        if (open) {
            setState(initialState);
        }
    }, [open, initialState]);

    const handleStateChange = (newState: State) => {
        setState(newState);
        onStateChange?.(newState);
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                >
                    <motion.div
                        id="drawer"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ y: "100%", height: heights[state] }}
                        animate={{ y: "0%", height: heights[state] }}
                        exit={{ y: "100%" }}
                        transition={{
                            type: "spring",
                            damping: 35,
                            stiffness: 300,
                        }}
                        className="absolute bottom-0 w-full rounded-t-3xl bg-white shadow-2xl border-t border-gray-200"
                        style={{
                            y,
                            zIndex: Z_LAYERS.PANELS,
                        }}
                        drag="y"
                        dragControls={controls}
                        onDragEnd={() => {
                            if (y.get() >= 100) {
                                if (state === "expanded") {
                                    handleStateChange("normal");
                                } else if (state === "normal") {
                                    handleStateChange("collapsed");
                                } else {
                                    setOpen(false);
                                }
                            }

                            if (y.get() <= -100) {
                                if (state === "collapsed") {
                                    handleStateChange("normal");
                                } else if (state === "normal") {
                                    handleStateChange("expanded");
                                }
                            }
                        }}
                        dragListener={false}
                        dragConstraints={{
                            top: 0,
                            bottom: 0,
                        }}
                        dragElastic={{
                            top: 0.5,
                            bottom: 0.5,
                        }}
                    >
                        {/* Header with drag handle, up/down buttons, and close button */}
                        <div className="absolute left-0 right-0 top-0 z-10 flex justify-center bg-blue-700 p-4 overflow-hidden rounded-t-3xl">
                            <motion.button
                                onPointerDown={(e) => {
                                    controls.start(e);
                                }}
                                className="h-2 w-14 cursor-grab touch-none rounded-full bg-white/70 active:cursor-grabbing"
                                whileHover={{
                                    scale: 1.1,
                                }}
                                whileTap={{ scale: 0.95 }}
                                transition={{ duration: 0.2 }}
                            />

                            {/* Up/Down buttons on the right */}
                            <div className="absolute right-12 top-2 flex flex-row gap-1">
                                <motion.button
                                    onClick={() => {
                                        if (state === "expanded") {
                                            handleStateChange("normal");
                                        } else if (state === "normal") {
                                            handleStateChange("collapsed");
                                        }
                                    }}
                                    className="w-8 h-8 rounded-full text-white disabled:text-white/30 p-1 transition-colors flex items-center justify-center"
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    transition={{ duration: 0.2 }}
                                    aria-label={t("down")}
                                    disabled={state === "collapsed"}
                                >
                                    <LuChevronDown
                                        className="h-5 w-5"
                                        strokeWidth={3}
                                    />
                                </motion.button>
                                <motion.button
                                    onClick={() => {
                                        if (state === "collapsed") {
                                            handleStateChange("normal");
                                        } else if (state === "normal") {
                                            handleStateChange("expanded");
                                        }
                                    }}
                                    className="w-8 h-8 rounded-full text-white p-1 disabled:text-white/30 transition-colors flex items-center justify-center"
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    transition={{ duration: 0.2 }}
                                    aria-label={t("up")}
                                    disabled={state === "expanded"}
                                >
                                    <LuChevronUp
                                        className="h-5 w-5"
                                        strokeWidth={3}
                                    />
                                </motion.button>
                            </div>

                            <motion.button
                                onClick={() => setOpen(false)}
                                className="absolute right-4 top-4 rounded-full text-white/90 hover:text-white -mt-1 p-1 hover:bg-white/20 transition-colors"
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                transition={{ duration: 0.2 }}
                                aria-label={t("close")}
                            >
                                <LuX className="h-5 w-5" strokeWidth={3} />
                            </motion.button>
                        </div>

                        {/* Content */}
                        <div className="relative z-0 h-full overflow-hidden pt-4">
                            <div className="h-full overflow-auto rounded-t-3xl">
                                {children}
                            </div>
                        </div>

                        {/* Background extension for overscroll */}
                        <div className="bg-white h-full w-full absolute bottom-0 translate-y-full"></div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
