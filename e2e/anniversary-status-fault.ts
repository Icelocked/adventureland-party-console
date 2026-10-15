// Declared historical stock observation, scoped to the native CODE jQuery reader.
export function anniversaryStatusFaultSource(character: string, merchant: string): string {
  return `(() => {
    if (!globalThis.$?.ajaxPrefilter) throw Error('Native CODE jQuery reader unavailable');
    if (globalThis.__e2eAnniversaryStatusFault) throw Error('Historical stock fault already installed');
    const fault = globalThis.__e2eAnniversaryStatusFault = {enabled:true, count:0,
      jquery:$.fn.jquery, generation:globalThis.__partyRuntimeGeneration, last:null};
    $.ajaxPrefilter('json', function(options) {
      const url = new URL(options.url, globalThis.location.href);
      if (!url.pathname.endsWith('/party-api/status') || url.searchParams.has('fast')) return;
      let body = options.data;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return; }
      }
      if (body?.combatOnly === true || body?.combatWait === true) return;
      const previous = options.dataFilter;
      options.dataFilter = function(...args) {
        const data = previous ? previous.apply(this, args) : args[0];
        if (!fault.enabled || typeof data !== 'string') return data;
        let state;
        try { state = JSON.parse(data); } catch { return data; }
        if (!state || typeof state !== 'object' || Array.isArray(state)) return data;
        state.anniversary = {...state.anniversary, merchant:${JSON.stringify(merchant)},
          handoffTargets:[{name:${JSON.stringify(character)},round:'historical-earlier-round',slice:'slice_strawberry'}]};
        fault.count++;
        fault.last = {round:'historical-earlier-round', character:${JSON.stringify(character)}, at:Date.now()};
        return JSON.stringify(state);
      };
    });
    return {jquery:fault.jquery,generation:fault.generation};
  })()`;
}
