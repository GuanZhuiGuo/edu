/** A deadline always aborts the underlying operation as well as its caller. */
export function runWithEducationDeadline(run, {
  signal, timeoutMs = 4_000, code = "education_operation_timeout", onAbort,
} = {}) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const propagate = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", propagate, { once: true });
  const timer = setTimeout(() => {
    const error = new Error("Education operation timed out.");
    error.code = code;
    error.status = 504;
    controller.abort(error);
  }, timeoutMs);
  let stop;
  const aborted = new Promise((_, reject) => {
    stop = () => {
      try { onAbort?.(); } catch { /* Cancellation must still reach caller. */ }
      reject(controller.signal.reason);
    };
    controller.signal.addEventListener("abort", stop, { once: true });
  });
  return Promise.race([Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return run(controller.signal);
  }), aborted]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", propagate);
    controller.signal.removeEventListener("abort", stop);
  });
}

/** Waiting on a shared probe may be cancelled without cancelling other callers. */
export function waitForEducationOperation(operation, signal) {
  signal?.throwIfAborted();
  if (!signal) return operation;
  let stop;
  const aborted = new Promise((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  return Promise.race([operation, aborted])
    .finally(() => signal.removeEventListener("abort", stop));
}
