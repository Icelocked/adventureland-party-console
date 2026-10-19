# Map sprites and Steam control placement

Failure inventory before implementation:

- Map telemetry omits weapons outside Cave, drops large cosmetics through fixed doll clipping, guesses atlas cells for native animation frames, loses trim/anchor/rotation/scale or painter order, serializes stale/deleted projectiles, duplicates weapon layers, or sends unbounded renderer objects/cycles.
- Native textures missing during loading must retain existing fallback rendering. Sprite traffic must remain subscriber-only and metadata must be bounded. Renderer filters/text must not leak native object graphs. Dashboard image proxy/capture readability and existing targets/HP/terrain stay intact.
- The Steam minimize control drifts when panel width changes, overlaps native controls or PvP/duel score, overflows narrow windows, misses late native layout changes/resizes, ignores persisted minimized state, or leaves observers behind after disposal.

Browser journeys draw maintained MapCanvas from declared native renderer textures and assert actual colored body/weapon/cosmetic/projectile pixels, removal, and screenshot readability. Steam uses native DOM boundary rectangles and real minimize/restore/resize/reload actions; exact control rectangles, non-overlap, and screenshots are retained. Root owns integrated E2Es and the immutable candidate; no live console/client activation is involved.

Implementation uses native atlas rectangles and trim/anchor/local matrices, including mirrored weapon layers. No renderer texture extraction, canvas pixel readback, or generated data URLs run in production. Weak texture metadata caches avoid repeated atlas resolution; capture stops after 96 nodes, six levels and 32 layers per entity. Publication limits capture to 64 entities and 192 entity layers, plus 64 animation layers, and returns before any collection when unsubscribed. Native deleted/invisible projectiles are excluded; stale animation observations disappear after one second without another frame. Existing sanitized dolls, sprites and both weapons remain fallbacks where no native renderer texture exists. The optional tint-cell cache is limited to 64 cells and one million pixels (4 MiB of pixel storage).

Steam positions the toggle against the available gap's right edge in both expansion states. ResizeObservers follow the native controls/score (at most two retained elements); narrow windows use a row below native controls. Disposal disconnects observers and removes the viewport listener.
