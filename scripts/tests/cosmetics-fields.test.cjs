// Ways the Cosmetics panel (dashboard/features/party/cosmetics-panel.tsx) can
// lose its data under PARTY_STATE_FIELDS=enforce, written before the change:
// 1. The core section's characterDetails leaves cosmetics out, so the
//    connected character card, which merges that diagnostics entry into the
//    character, renders the panel empty.
// 2. The fast section leaves it out, so the diagnostics cache that fast fills
//    before core's first answer (query-cache.tsx) has no cosmetics.
// 3. The registry catalog has no cosmetics entry, so the registry test fails
//    and the field has no recorded reader.
const test = require('node:test');
const assert = require('node:assert/strict');
const { characterFields } = require('../../runtime/coordinator/telemetry/character-fields.ts');
const { publicStateRuntime } = require('./helpers/coordinator-public-state.cjs');

const cosmetics = { jars: 2, owned: ['hat'], worn: { hat: 'hat' }, emotes: ['wave'], targets: [] };
function readSection(query) {
  const r = publicStateRuntime();
  r.party.statuses.P.cosmetics = cosmetics;
  let result;
  r.route({ query }, { json: value => { result = value; } });
  return JSON.parse(JSON.stringify(result));
}
function enforced(callback) {
  const before = process.env.PARTY_STATE_FIELDS;
  process.env.PARTY_STATE_FIELDS = 'enforce';
  try { return callback(); } finally {
    if (before === undefined) delete process.env.PARTY_STATE_FIELDS; else process.env.PARTY_STATE_FIELDS = before;
  }
}

test('the core section sends cosmetics in the character details the card merges', () => enforced(() => {
  assert.deepEqual(readSection({ section: 'core', dashboard: '1' }).characterDetails.P.cosmetics, cosmetics);
}));

test('the fast section sends cosmetics for the diagnostics cache', () => enforced(() => {
  assert.deepEqual(readSection({ section: 'fast', dashboard: '1' }).characters.P.cosmetics, cosmetics);
}));

test('the field catalog lists cosmetics as a lean field the dashboard reads', () => {
  assert.equal(characterFields.cosmetics?.tier, 'lean');
  assert.deepEqual(characterFields.cosmetics.readers, ['dashboard']);
});
