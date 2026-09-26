const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('catalog mounts 120 rows, expands, and resets its batch on filtering and reopening', async () => {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('dashboard/features/party/equipment-catalog-dialog.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require(id) {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return require('../../dashboard/node_modules/react/jsx-runtime');
    if (id === './equipment-types') return { EQUIPMENT_TYPES: ['weapon'] };
    return new Proxy({}, { get: (_, name) => name });
  }});
  const catalog = Array.from({ length: 250 }, (_, i) => ({
    id: `item${i}`, name: `Item ${i}`, sprite: { image: '/item.png' }, meta: { definition: { type: 'weapon', tier: 1, g: i } },
  }));
  let tree, open = true;
  const render = () => React.createElement(exports.EquipmentCatalogDialog, { open, catalog, onOpenChange() {}, onInspect() {} });
  const rows = () => tree.root.findAllByType('ItemSprite').length;
  const more = () => tree.root.findAllByType('Button').find(button => String(button.props.children).startsWith('Show '));
  try {
    await act(async () => { tree = create(render()); });
    assert.equal(rows(), 120);
    await act(async () => more().props.onClick());
    assert.equal(rows(), 240);
    await act(async () => more().props.onClick());
    assert.equal(rows(), 250);
    assert.equal(more(), undefined);
    const input = tree.root.findByType('Input');
    await act(async () => input.props.onChange({ target: { value: 'Item 249' } }));
    assert.equal(rows(), 1);
    await act(async () => input.props.onChange({ target: { value: '' } }));
    assert.equal(rows(), 120);
    await act(async () => more().props.onClick());
    open = false;
    await act(async () => tree.update(render()));
    open = true;
    await act(async () => tree.update(render()));
    assert.equal(rows(), 120);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
