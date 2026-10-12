# Retained fixture dependency repair failure inventory

- Extracted production functions can reference newly added maintenance gates absent from their VM fixture. Load the real gates, with an explicitly idle maintenance context, rather than changing production behavior.
- The queue wrapper now delegates to an unfiltered implementation; extracting only the wrapper loses that dependency.
- Item transfer checkpoints require the real atomic-boundary and item-state helpers.
- Coordinator snapshot fixtures require their current maintenance service contract.
- Isolated React renders need the new hook and ignored-item state contracts.
- Attack-controller fixtures need the target authorization contract; passing-encounter assertions must remain unchanged.
- Dedicated deployment tests retain real hold behavior. No production fallback or weakened assertions is introduced.

## Additional retained contracts

- Installed launchers now import built-in path/module/URL helpers and pass a resolving wrapper; fixtures must provide built-ins and verify actual delegated module resolution.
- Native installer fixture requires ConfigUtil and runner sources for current preparation contracts; isolate these copies and preserve live files.
- Heartbeat schema now includes console maintenance and bank staging, which must be explicitly asserted.
- Status application invokes console-maintenance reception; a fixture must provide idle maintenance through the real receiver.
- Loader polls the stable control endpoint as well as immutable CODE; the fixture must distinguish and validate both.
- Merchant attack-controller fixture must declare current target authorization methods.
