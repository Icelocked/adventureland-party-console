# Empty merchant service bank return failure inventory

- A pure item delivery sends its item successfully but unconditionally performs Town and bank travel on the final service leg, even with no retained bank cargo and zero actual gold surplus. This delayed durable completion beyond the existing 30-second native expectation; evidence logged Deposited 0 collected gold.
- Compute actual retained gold surplus against the configured merchant target before planning the bank leg. Only skip the leg if both pending bank items and the actual positive deposit are absent. Preserve item storage, positive deposits, retained cargo completion, collection chaining and durable receipts.
- Strengthen the existing native delivery journey before production edit: require conserved native gold, no unnecessary Entered bank activity for this declared cargo-free service, the same durable completion deadline, restart and item conservation. No unit cases added after code.
