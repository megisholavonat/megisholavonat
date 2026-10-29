/**
 * A loader that keeps its result once it succeeds; a failed load is dropped,
 * so the next call tries again instead of failing until a restart.
 */
export function cachedLoad<T>(load: () => Promise<T>): () => Promise<T> {
    let pending: Promise<T> | null = null;
    return () => {
        if (!pending) {
            const attempt = load();
            pending = attempt;
            attempt.catch(() => {
                if (pending === attempt) pending = null;
            });
        }
        return pending;
    };
}
