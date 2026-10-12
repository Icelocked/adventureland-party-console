const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {namedFunction} = require('./named-function.cjs');

// Extracted behavior fixtures run with no deployment transaction. Load the real
// maintenance gates so an incidental new dependency cannot bypass that behavior.
let functions;
exports.createSharedContext = (options) => {
  options.root ||= {};
  options.runtimeCurrent ||= () => true;
  const context = vm.createContext(options);
  if (!functions) {
    const source = fs.readFileSync(path.join(__dirname, '../../../characters/shared.js'), 'utf8');
    functions = ['consoleDraining', 'consoleDrainKey', 'consoleDrainAllows', 'consoleAtomicBoundary', 'queueMarkersUnfiltered', 'fingerprint', 'sameItemState'].map(name => [name, namedFunction(source, name)]);
  }
  for (const [name, declaration] of functions)
    if (typeof context[name] !== 'function') vm.runInContext(declaration, context);
  return context;
};
