# Deferred event persistence contract

Validation38465953846 failed four existing composition cases after the persisted awaiting-event-admission phase was introduced. Owned cancellation persists separately; phase transition adds exactly one save even when unrelated/protected walk is retained.

Update existing dependency expectations to capture phase and actual convoy state: exact cancellation counts unchanged, one additional phase save, original checkpoint retained, no participation manufactured, repeated eligibility performs no additional saves. This does not relax ownership guards or remove assertions.
