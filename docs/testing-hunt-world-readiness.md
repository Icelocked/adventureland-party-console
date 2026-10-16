# Hunt native world observation readiness

Failure inventory before changing the read boundary. Latest CI Anniversary restart loses a native player briefly during realm/client replacement; the test world observer dereferences its map and throws before checking any actual recovery behavior.

Return a not-ready sample when any named native account character is absent, and wait at most30 seconds for an authoritative complete world sample. Never seed player state or swallow upstream errors other than representing actual absence. Keep all native quest, gift, combat and physical arrival assertions unchanged. Permanent absence must fail the bounded readiness check explicitly.
