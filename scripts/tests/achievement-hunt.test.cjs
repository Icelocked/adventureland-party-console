// Isolated checks for Achievement Hunt target choice. Each test names the
// failure mode from docs/achievement-hunt.md that it guards against.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAchievementHunt } = require('../../runtime/coordinator/hunt/achievement-hunt.ts');
const { achievementMonsters, chooseAchievementTarget } = require('../../runtime/hunt/achievement-policy.ts');
const { createAchievementHuntRoute } = require('../../runtime/coordinator/http/achievement-hunt.ts');

const ladder = (...counts) => counts.map((count) => [count, 'stat', 'hp', 10]);
const catalog = [
  { id: 'goo', name: 'Goo', xp: 100, threat: 1, hp: 50, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'bee', name: 'Bee', xp: 400, threat: 5, hp: 100, definition: { achievements: ladder(10, 100, 1000) } },
  { id: 'wolf', name: 'White Wolf', xp: 48800, threat: 50, hp: 48000, definition: { achievements: ladder(1, 100, 1000) } },
  { id: 'dragold', name: 'Dragold', xp: 24000000, threat: 800, hp: 25600000, definition: { achievements: ladder(1, 10, 20), special: true, cooperative: true } },
  { id: 'hen', name: 'Chicken', threat: 0, hp: 10, definition: {} },
];
const choices = ['goo', 'bee', 'wolf', 'hen'].map((id) => ({ id, locations: [{ map: 'main', x: 0, y: 0 }] }));

function fixture(kills, extra = {}) {
  let now = 1_000_000;
  const selected = [];
  const state = {
    leader: 'L', farmingPolicy: 'achievements', monsterFocus: [], bestiaryCatalog: catalog, monsterChoices: choices,
    statuses: { L: { seenAt: now, monsterAchievementKills: { ...kills } }, F: { seenAt: now, monsterAchievementKills: {} } },
    achievementHunt: { monsters: ['goo', 'bee', 'wolf'], blacklistDeaths: true, deathThreshold: 2 },
    achievementBlacklist: {}, achievementTarget: null, achievementMessage: '',
    ...extra,
  };
  const ports = {
    now: () => now, members: () => ['L', 'F'], busy: () => null, persist() {}, radius: () => 400,
    destination: (id) => (id === 'nowhere' ? null : { map: 'main', x: 1, y: 2 }),
    select: (id) => { selected.push(id); state.monsterFocus = [id]; return ['L', 'F']; },
  };
  const hunt = createAchievementHunt(state, ports);
  return {
    state, ports, hunt, selected,
    advance: (ms) => { now += ms; for (const status of Object.values(state.statuses)) status.seenAt = now; },
    kills: (id, count) => { state.statuses.L.monsterAchievementKills[id] = count; },
  };
}

test('the list runs weakest to strongest; special and achievement-less monsters are marked or left out', () => {
  const order = achievementMonsters(catalog, choices);
  assert.deepEqual(order.map((m) => m.id), ['goo', 'bee', 'wolf', 'dragold']);
  // XP, not attack × speed: a Vampire Rat hits harder than a Fire Spirit but is far weaker.
  const rank = achievementMonsters([
    { id: 'fireroamer', name: 'Fire Spirit', xp: 64200, threat: 384, hp: 84000, definition: { achievements: ladder(10) } },
    { id: 'prat', name: 'Vampire Rat', xp: 7600, threat: 512, hp: 9200, definition: { achievements: ladder(1) } },
  ], [{ id: 'fireroamer', locations: [{}] }, { id: 'prat', locations: [{}] }]);
  assert.deepEqual(rank.map((m) => m.id), ['prat', 'fireroamer']);
  // Training dummies and Cave of Many Dreams monsters are unlisted by the game: special, not regular.
  const dummy = achievementMonsters([{ id: 'target_ar900', name: 'Target Automatron', xp: 1000, definition: { achievements: ladder(100), unlist: true } }], [{ id: 'target_ar900', locations: [{}] }]);
  assert.equal(dummy[0].special, true);
  // Failure mode 13: Dracul's spawn is a random respawn, though its definition has no special flag.
  const dracul = achievementMonsters([{ id: 'mvampire', name: 'Dracul', xp: 1, definition: { achievements: ladder(1) } }], [{ id: 'mvampire', locations: [{}] }]);
  assert.equal(dracul[0].special, true);
  assert.equal(order.find((m) => m.id === 'dragold').special, true);
  assert.equal(order.find((m) => m.id === 'wolf').special, false);
});

test('every selected monster reaches step 1 before any is farmed for step 2', () => {
  const order = achievementMonsters(catalog, choices);
  const pick = (kills) => chooseAchievementTarget(order, new Set(['goo', 'bee', 'wolf']), () => false, kills)?.id;
  assert.equal(pick({}), 'goo');
  assert.equal(pick({ goo: 10 }), 'bee'); // goo moves to step 2; bee still needs step 1
  assert.equal(pick({ goo: 10, bee: 10 }), 'wolf'); // wolf's step 1 is a single kill
  assert.equal(pick({ goo: 10, bee: 10, wolf: 1 }), 'goo'); // all at step 2: weakest first again
  assert.equal(pick({ goo: 1000, bee: 1000, wolf: 1000 }), undefined);
});

test('a blacklisted monster is passed over and the next one on the list is the target', () => {
  const f = fixture({});
  f.state.achievementBlacklist.goo = { monsterId: 'goo', at: 0, reason: 'Manually blacklisted' };
  f.hunt.tick();
  assert.deepEqual(f.selected, ['bee']);
});

test('no thrashing: the target is kept until its own milestone is met', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(5_000); f.kills('goo', 9); f.hunt.tick();
  assert.deepEqual(f.selected, ['goo']);
  f.advance(5_000); f.kills('goo', 10); f.hunt.tick();
  assert.deepEqual(f.selected, ['goo', 'bee']);
  assert.match(f.state.achievementMessage, /Farming Bee: 0 \/ 10 kills \(step 1\)/);
});

test('a monster that comes back at a lower step takes over from a higher-step target', () => {
  const f = fixture({ goo: 10, bee: 10 }, { achievementHunt: { monsters: ['bee', 'wolf'], blacklistDeaths: true, deathThreshold: 2 } });
  f.hunt.tick(); // wolf's step 1
  f.advance(5_000); f.kills('wolf', 1); f.hunt.tick(); // all at step 2: bee
  assert.deepEqual(f.selected, ['wolf', 'bee']);
  f.state.achievementHunt.monsters = ['bee', 'wolf', 'goo']; // goo is re-selected, still at step 2: bee is kept
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'bee']);
  f.kills('goo', 0); f.state.statuses.F.monsterAchievementKills = {}; // a fresh step-1 monster appears
  f.advance(5_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['wolf', 'bee', 'goo']);
});

test('deaths count once each, only after the target started, then blacklist it and move on', () => {
  const f = fixture({});
  f.state.statuses.L.lastDeath = { at: 1 }; // before the target started
  f.hunt.tick();
  f.advance(1_000); f.state.statuses.L.lastDeath = { at: 1_000_500 }; f.hunt.tick();
  f.advance(1_000); f.hunt.tick(); // the same death reported again
  assert.equal(f.state.achievementTarget.deaths, 1);
  f.advance(1_000); f.state.statuses.F.lastDeath = { at: 1_002_800 }; f.hunt.tick();
  assert.equal(f.state.achievementBlacklist.goo.deaths, 2);
  assert.deepEqual(f.selected, ['goo', 'bee']);
});

test('a monster focus changed by hand switches to Auto instead of fighting the player', () => {
  const f = fixture({});
  f.hunt.tick();
  f.advance(20_000); f.state.monsterFocus = ['crab']; f.hunt.tick();
  assert.equal(f.state.farmingPolicy, 'auto');
  assert.match(f.state.achievementMessage, /changed by hand/);
  assert.deepEqual(f.selected, ['goo']);
});

test('another owner of travel, an offline leader or another farming mode stop it from starting a convoy', () => {
  const busy = fixture({});
  busy.ports.busy = () => 'a daily dungeon is running';
  busy.hunt.tick();
  assert.deepEqual(busy.selected, []);
  assert.match(busy.state.achievementMessage, /daily dungeon/);
  const offline = fixture({});
  offline.state.statuses.L.seenAt = 0;
  offline.hunt.tick();
  assert.deepEqual(offline.selected, []);
  const other = fixture({}, { farmingPolicy: 'hunt' });
  other.hunt.tick();
  assert.deepEqual(other.selected, []);
  // Leaving the mode forgets the target; the new mode owns travel.
  const left = fixture({});
  left.hunt.tick();
  left.state.farmingPolicy = 'scatter';
  left.advance(1_000); left.hunt.tick();
  assert.equal(left.state.achievementTarget, null);
  assert.deepEqual(left.selected, ['goo']);
});

test('a monster without a route is skipped for a while, and the rest of the list continues', () => {
  const f = fixture({});
  f.ports.destination = (id) => (id === 'goo' ? null : { map: 'main', x: 1, y: 2 });
  f.hunt.tick();
  assert.deepEqual(f.selected, []);
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['bee']);
});

test('with everything finished it reports so and keeps the party where it is', () => {
  const f = fixture({ goo: 1000, bee: 1000, wolf: 1000 });
  f.hunt.tick();
  assert.deepEqual(f.selected, []);
  assert.match(f.state.achievementMessage, /Nothing left to farm/);
});

test('the settings route validates monsters and thresholds, and edits the blacklist', () => {
  const f = fixture({}, { achievementHunt: { monsters: [], blacklistDeaths: true, deathThreshold: 3 } });
  const route = createAchievementHuntRoute(f.state, { now: () => 1, known: () => new Set(['goo', 'bee']), reset() {}, persist() {} });
  const call = (body) => { let out; route({ body }, { status: (code) => ({ json: (value) => { out = { code, value }; } }), json: (value) => { out = { code: 200, value }; } }); return out; };
  assert.equal(call({ settings: { monsters: ['goo', 'kraken'] } }).code, 400);
  assert.equal(call({ settings: { deathThreshold: 0 } }).code, 400);
  assert.equal(call({ settings: { monsters: ['goo', 'goo', 'bee'] } }).code, 200);
  assert.deepEqual(f.state.achievementHunt.monsters, ['goo', 'bee']);
  assert.equal(call({ blacklist: { action: 'add', monsterId: 'bee' } }).code, 200);
  assert.ok(f.state.achievementBlacklist.bee);
  assert.equal(call({ blacklist: { action: 'clear' } }).code, 200);
  assert.deepEqual(f.state.achievementBlacklist, {});
});

test('an Achievement Hunt switch stays in the mode; picking a monster by hand still resets it to Auto', () => {
  const { createMonsterSelection } = require('../../runtime/coordinator/navigation/monster-selection.ts');
  const party = () => ({ leader: 'L', followers: { F: true }, statuses: {}, farmAreaState: null, farmingPolicy: 'achievements', monsterFocus: ['bee'],
    monsterFocusByCharacter: {}, scatterMonsterTypes: ['bee'], scatterEpoch: 1, partyFarmingMode: 'scatter', partyFarmingMonsterType: 'bee',
    scatterBreakTarget: null, eventReturn: null, deferredEventReturns: {}, eventSessions: {}, commands: {}, passiveRareHunts: {} });
  const ports = { now: () => 1, release() {}, clearHunt() {}, members: () => ['L', 'F'], authorize() {}, start: () => true, startPhoenix() {}, stopPhoenix() {}, persist() {} };
  const kept = party();
  createMonsterSelection(kept, ports).select('goo', { map: 'main', x: 1, y: 2 }, undefined, true);
  assert.equal(kept.farmingPolicy, 'achievements');
  assert.deepEqual(kept.monsterFocus, ['goo']);
  assert.deepEqual(kept.scatterMonsterTypes, []); // learned scatter state for the old monster resets
  const manual = party();
  createMonsterSelection(manual, ports).select('goo', { map: 'main', x: 1, y: 2 }, undefined);
  assert.equal(manual.farmingPolicy, 'auto');
});

test('each farming scope keeps its own Achievement Hunt; a saved leader profile keeps the party-wide selection', () => {
  const { createFarmingScopes } = require('../../runtime/coordinator/hunt/scopes.ts');
  const legacy = { monsters: ['goo', 'bee'], blacklistDeaths: true, deathThreshold: 4 };
  const root = {
    leader: 'L', followers: { F: true }, merchantCharacter: 'M', farmingProfiles: { L: { farmingPolicy: 'auto' } },
    achievementHunt: legacy, achievementBlacklist: {}, achievementTarget: null, achievementMessage: '',
    monsterFocusByCharacter: {}, bestiaryCatalog: catalog, monsterChoices: choices, statuses: {},
  };
  const scopes = createFarmingScopes(root, () => 1_000_000);
  assert.deepEqual(root.achievementHunt, legacy); // the leader's profile inherited the existing selection
  const solo = scopes.view('S');
  assert.deepEqual(solo.achievementHunt.monsters, []);
  assert.equal(scopes.effective('F').achievementHunt, root.achievementHunt); // followers use the leader's
  // A solo character farms its own target and leaves the party's mode alone.
  root.statuses = { L: { seenAt: 1_000_000, monsterAchievementKills: { goo: 10 } }, S: { seenAt: 1_000_000, monsterAchievementKills: { goo: 10 } } };
  solo.achievementHunt = { monsters: ['goo', 'wolf'], blacklistDeaths: true, deathThreshold: 3 };
  solo.farmingPolicy = 'achievements';
  const selected = [];
  createAchievementHunt(solo, {
    now: () => 1_000_000, members: () => ['S'], busy: () => null, persist() {}, radius: () => 400,
    destination: () => ({ map: 'main', x: 1, y: 2 }),
    select: (id) => { selected.push(id); solo.monsterFocus = [id]; return ['S']; },
  }).tick();
  assert.deepEqual(selected, ['wolf']); // goo already has step 1; wolf has not
  assert.equal(scopes.profile('S').achievementTarget.id, 'wolf');
  assert.equal(root.achievementTarget, null);
  assert.equal(root.farmingPolicy, 'auto');
});

// Filling respawn waits: failure modes 14-19 in docs/achievement-hunt.md.
const { nearbyFillers } = require('../../runtime/hunt/achievement-policy.ts');
const snakes = [
  { id: 'snake', name: 'Snake', xp: 960, threat: 3, hp: 720, definition: { achievements: ladder(100, 1000) } },
  { id: 'osnake', name: 'Snake', xp: 1600, threat: 3, hp: 720, definition: { achievements: ladder(100, 1000) } },
  { id: 'greenjr', name: 'Green Jr.', xp: 9000, threat: 9, hp: 9000, definition: { achievements: ladder(1) } },
  { id: 'ghost', name: 'Ghost', xp: 400, threat: 2, hp: 400, definition: { achievements: ladder(100) } },
];
const halloween = (x, y) => ({ map: 'halloween', x, y, boundary: [x - 60, y - 50, x + 60, y + 50] });
const spawn = (place, count) => ({ ...place, sourceMap: place.map, count, restrictions: [] });
const snakeChoices = [
  { id: 'osnake', locations: [halloween(-590, -335)], spawnRecords: [spawn(halloween(-590, -335), 2)] },
  { id: 'snake', locations: [halloween(-590, -160)], spawnRecords: [spawn(halloween(-590, -160), 9)] },
  { id: 'greenjr', locations: [halloween(-590, -160)] },
  { id: 'ghost', locations: [halloween(900, -750)] },
];

test('two monsters with one game name show their ids', () => {
  const order = achievementMonsters(snakes, snakeChoices);
  assert.equal(order.find((m) => m.id === 'osnake').name, 'Snake (osnake)');
  assert.equal(order.find((m) => m.id === 'snake').name, 'Snake (snake)');
  assert.equal(order.find((m) => m.id === 'ghost').name, 'Ghost');
});

test('fillers are nearby, no stronger than the target, regular and not excluded', () => {
  const order = achievementMonsters(snakes, snakeChoices);
  const at = { map: 'halloween', x: -590, y: -335 };
  // Green Jr. shares the snake spawn but is stronger; the ghost spawn is far away.
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', at, 400, () => false), ['snake']);
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', at, 400, (id) => id === 'snake'), []);
  assert.deepEqual(nearbyFillers(order, snakeChoices, 'osnake', at, 100, () => false), []);
});

function snakeFixture(extra = {}) {
  let now = 1_000_000;
  const selected = [];
  const state = {
    leader: 'L', farmingPolicy: 'achievements', monsterFocus: [], bestiaryCatalog: snakes, monsterChoices: snakeChoices,
    statuses: { L: { seenAt: now, monsterAchievementKills: { snake: 100 } }, F: { seenAt: now, monsterAchievementKills: {} } },
    achievementHunt: { monsters: ['osnake'], blacklistDeaths: true, deathThreshold: 3, fillIdle: true },
    achievementBlacklist: {}, achievementTarget: null, achievementMessage: '',
    monsterPrioritiesByCharacter: { L: { snake: 70, bat: 20 } }, location: null, activeConvoy: null,
    ...extra,
  };
  const ports = {
    now: () => now, members: () => ['L', 'F'], busy: () => null, persist() {}, radius: () => 400,
    destination: (id) => ({ ...snakeChoices.find((c) => c.id === id).locations[0] }),
    select: (id, location) => { selected.push(id); state.monsterFocus = [id]; state.location = location; return ['L', 'F']; },
  };
  return { state, ports, selected, hunt: createAchievementHunt(state, ports), advance: (ms) => { now += ms; for (const s of Object.values(state.statuses)) s.seenAt = now; } };
}

test('the target is the top priority tier and nearby fillers the bottom one, for every member', () => {
  const f = snakeFixture();
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  assert.deepEqual(f.state.monsterFocus, ['osnake', 'snake']);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 10, bat: 20, osnake: 90 }, F: { osnake: 90, snake: 10 } });
  // The filler list is the hunt's own focus, not a change by hand.
  f.advance(20_000); f.hunt.tick();
  assert.equal(f.state.farmingPolicy, 'achievements');
});

test("leaving the mode restores each member's previous priorities", () => {
  const f = snakeFixture();
  f.hunt.tick();
  f.state.farmingPolicy = 'default';
  f.advance(1_000); f.hunt.tick();
  assert.equal(f.state.achievementTarget, null);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 70, bat: 20 }, F: {} });
});

test('a relocation to a spawn without the target sends the party back to the target', () => {
  const f = snakeFixture();
  f.hunt.tick();
  f.advance(20_000);
  f.state.location = { map: 'halloween', x: -590, y: 200 }; // a competition move to a snake-only spawn
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake', 'osnake']);
  assert.deepEqual(f.state.location, { ...snakeChoices[0].locations[0] });
});

test('with Fill respawn waits off the focus is the target alone', () => {
  const f = snakeFixture();
  f.state.achievementHunt.fillIdle = false;
  f.hunt.tick();
  assert.deepEqual(f.state.monsterFocus, ['osnake']);
  assert.deepEqual(f.state.monsterPrioritiesByCharacter, { L: { snake: 70, bat: 20 } });
});

test('a rare variant at the same step is farmed first, with the common monster as its filler', () => {
  const f = snakeFixture();
  f.state.achievementHunt.monsters = ['snake', 'osnake'];
  f.state.statuses.L.monsterAchievementKills = {}; // both at step 1: the sweep alone would pick plain snakes
  f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  assert.deepEqual(f.state.monsterFocus, ['osnake', 'snake']);
  // Off, the sweep's own choice stands.
  const off = snakeFixture();
  off.state.achievementHunt = { ...off.state.achievementHunt, monsters: ['snake', 'osnake'], fillIdle: false };
  off.state.statuses.L.monsterAchievementKills = {};
  off.hunt.tick();
  assert.deepEqual(off.selected, ['snake']);
  // A stronger monster that is not rarer keeps the sweep's order.
  const common = snakeFixture();
  common.state.achievementHunt.monsters = ['snake', 'osnake'];
  common.state.monsterChoices = snakeChoices.map((choice) => choice.id === 'osnake' ? { ...choice, spawnRecords: [spawn(choice.locations[0], 12)] } : choice);
  common.state.statuses.L.monsterAchievementKills = {};
  common.hunt.tick();
  assert.deepEqual(common.selected, ['snake']);
  // A variant a step behind the common monster does not take over a lower step.
  const behind = snakeFixture();
  behind.state.achievementHunt.monsters = ['snake', 'osnake'];
  behind.state.statuses.L.monsterAchievementKills = { osnake: 100 };
  behind.hunt.tick();
  assert.deepEqual(behind.selected, ['snake']);
});

test('a target kept across a restart or a settings change gets its fillers without moving', () => {
  const f = snakeFixture();
  f.state.achievementHunt.fillIdle = false;
  f.hunt.tick();
  assert.deepEqual(f.state.monsterFocus, ['osnake']);
  f.state.achievementHunt.fillIdle = true;
  f.hunt.reset(); // the settings route calls this after every change
  f.advance(1_000); f.hunt.tick();
  assert.deepEqual(f.selected, ['osnake']);
  assert.deepEqual(f.state.monsterFocus, ['osnake', 'snake']);
  // A restarted coordinator resumes a saved target that has no focus list yet.
  const restarted = snakeFixture({ achievementTarget: { id: 'osnake', step: 0, milestone: 100, startedAt: 1_000_000, deaths: 0, counted: {} },
    monsterFocus: ['osnake'], location: { ...snakeChoices[0].locations[0] } });
  restarted.hunt.tick();
  assert.deepEqual(restarted.selected, []);
  assert.deepEqual(restarted.state.monsterFocus, ['osnake', 'snake']);
});
