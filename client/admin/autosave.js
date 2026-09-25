export const createAutosave = ({ save, delay = 1200, onState = () => {}, timers = globalThis }) => {
  let timer = null;
  let pending = null;
  let running = null;
  let state = "saved";

  const set = (next, detail) => {
    state = next;
    onState(next, detail);
  };

  const flush = async () => {
    timers.clearTimeout(timer);
    timer = null;
    if (running) {
      await running.catch(() => {});
      if (!pending) return state;
    }
    if (!pending) return state;
    const payload = pending;
    pending = null;
    set("saving");
    running = Promise.resolve().then(() => save(payload));
    try {
      const result = await running;
      running = null;
      if (pending) set("dirty");
      else set("saved", result);
      if (pending) return flush();
    } catch (error) {
      running = null;
      pending = pending ? { ...payload, ...pending } : payload;
      set("error", error);
    }
    return state;
  };

  const queue = (patch, { immediate = false } = {}) => {
    pending = { ...(pending ?? {}), ...patch };
    set("dirty");
    timers.clearTimeout(timer);
    if (immediate) return flush();
    timer = timers.setTimeout(flush, delay);
    return null;
  };

  return {
    queue,
    flush,
    hasPending: () => Boolean(pending) || Boolean(running),
    state: () => state,
    cancel: () => {
      timers.clearTimeout(timer);
      pending = null;
    },
  };
};
