"use strict";
// Bundled with the pinned ChronAL VirtualClock, without replacing browser I/O.
const { VirtualClock } = require("chronal-clock");
const config = globalThis.__e2eClockConfiguration;
if (config && config.rate > 1) {
  const nativeTimeout = setTimeout,
    nativePerformance = performance,
    nativeRandom = Math.random,
    NativeWebSocket = WebSocket;
  const nativeFrame = requestAnimationFrame,
    nativeCancelFrame = cancelAnimationFrame;
  const id = "browser-" + nativeRandom().toString(36).slice(2) + "-" + nativePerformance.now();
  const url = (route) => {
    const u = new URL(route, config.broker);
    u.searchParams.set("id", id);
    u.searchParams.set("token", config.token);
    u.searchParams.set("scope", config.scope);
    u.searchParams.set("label", location.href);
    u.searchParams.set("now", String(clock.now));
    return u;
  };
  const errors = [];
  const clock = new VirtualClock({
    start: config.epoch,
    seed: 1,
    onError(error) {
      errors.push(String(error.stack || error));
      console.error("[ChronAL browser clock]", error);
    },
  });
  clock.installInto(globalThis, { profile: "browser", vmContext: globalThis });
  Math.random = nativeRandom;
  // Keep actual browser rendering and Playwright observation on their native
  // cadence. Game and CODE Date/timers share the accelerated gameplay epoch.
  Object.defineProperty(globalThis, "performance", {
    value: new Proxy(nativePerformance, {
      get(target, key) {
        if (key === "now") return () => clock.now - config.epoch;
        if (key === "timeOrigin") return config.epoch;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    configurable: true,
  });
  globalThis.requestAnimationFrame = callback => {
    if(typeof callback!=='function')throw new TypeError('Animation callback must be a function');
    return nativeFrame.call(globalThis,()=>callback.call(globalThis,clock.now-config.epoch));
  };
  globalThis.cancelAnimationFrame = nativeCancelFrame;
  let first = true;
  const state = { phase: "initial", ticks: 0 };
  async function connect() {
    try {
      if (typeof globalThis.__e2eChronalFrame === "function")
        await globalThis.__e2eChronalFrame(id);
      const endpoint = url("/clock");
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const socket = new NativeWebSocket(endpoint);
      let queue = Promise.resolve();
      socket.onmessage = (event) => {
        queue = queue
          .then(async () => {
            const next = JSON.parse(event.data);
            state.phase = "advance";
            if (first) {
              clock.now = next.now;
              first = false;
            } else await clock.run({ until: next.now });
            state.ticks++;
            state.phase = "idle";
            if (socket.readyState === 1) socket.send(JSON.stringify({ now: clock.now }));
          })
          .catch((error) => {
            errors.push(String(error.stack || error));
            console.error("[ChronAL clock]", error);
          });
      };
      socket.onerror = () => {
        errors.push("ChronAL clock connection failed");
      };
      socket.onclose = () => {
        state.phase = "closed";
      };
    } catch (error) {
      errors.push(String(error.stack || error));
      console.error("[ChronAL clock broker]", error);
    }
  }
  nativeTimeout(connect, 0);
  globalThis.__e2eChronalClock = {
    backend: "chronal-network",
    ...config,
    errors,
    state,
    now: () => Math.floor(clock.now),
    cpuNow: () => nativePerformance.now(),
    nativeTimeOrigin: nativePerformance.timeOrigin,
  };
}
