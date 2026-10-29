// Core is type-checked against plain ES2022 (no DOM, no Node types) so that it
// stays portable between web and React Native. `console` is not part of the ES
// lib but exists in every runtime we target, so declare the subset core uses.
declare const console: {
    warn(...data: unknown[]): void;
};

// Timers too (the analytics debounce).
declare function setTimeout(handler: () => void, ms?: number): unknown;
declare function clearTimeout(handle: unknown): void;
