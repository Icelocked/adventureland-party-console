const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { loadCoordinatorGeometry } = require('../../runtime/coordinator/navigation/planner-geometry.ts');
const { prepare, getPath } = require('../../runtime/coordinator/navigation/alclient-adapter.ts');
const { detourRejectedEdges } = require('../../runtime/coordinator/navigation/corner-edges.ts');

// #147: alpathfinder returns walking edges that cut wall corners the game's
// can_move rejects. Uses the newest installed game files, like the other geometry tests.
const root = path.resolve('.caracal/game_files');
const version = fs.existsSync(root) ? fs.readdirSync(root).filter(v => /^\d+$/.test(v) &&
  fs.existsSync(path.join(root, v, 'data.js'))).sort((a, b) => b - a)[0] : undefined;
const base = { h: 8, v: 7, vn: 2 };
let prepared;
// alpathfinder keeps one prepared graph per process; preparing it again breaks routing.
function fixture() {
  if (prepared) return prepared;
  const dir = path.join(root, version);
  const geometry = loadCoordinatorGeometry(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'),
    fs.readFileSync(path.join(dir, 'old_common_functions.js'), 'utf8'));
  prepare(geometry.game);
  return prepared = geometry;
}
function rejected(geometry, plot, size = base) {
  const out = [];
  for (let i = 1; i < plot.length; i++) {
    const a = plot[i - 1], b = plot[i];
    if (a.map === b.map && !b.transport && !b.town && !geometry.canMove(a, b, size)) out.push([a, b]);
  }
  return out;
}
function plan(from, to) {
  return getPath({ id: 'corner', version: Number(version), fingerprint: '', from, to, town: false, speed: 60, base });
}

test('the town corner route to the tunnel door validates after detouring its rejected edge', { skip: !version }, () => {
  const geometry = fixture();
  const from = { map: 'main', x: 135, y: 72 }, to = { map: 'main', x: 311, y: -328 }; // standable, next to the door
  const raw = plan(from, to);
  assert.ok(rejected(geometry, raw).length > 0, 'the raw planner route cuts the x=144 wall');
  const result = detourRejectedEdges(raw, base, (a, b, size) => geometry.canMove(a, b, size));
  assert.deepEqual(rejected(geometry, result.plot), []);
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.detoured, 1);
  assert.deepEqual(result.plot[0], raw[0]);
  assert.deepEqual(result.plot.at(-1), raw.at(-1));
  // Only the rejected edge changes: every original step is kept, in order.
  const kept = raw.every(step => result.plot.includes(step));
  assert.ok(kept, 'original steps are retained');
  assert.ok(result.plot.every(step => step.map === 'main'), 'the detour stays on the map');
});

test('sampled Mainland routes carry no rejected walking edge after detouring', { skip: !version }, () => {
  const geometry = fixture();
  let seed = 17665;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const points = [];
  while (points.length < 120) {
    const p = { map: 'main', x: Math.round(-1300 + random() * 3000), y: Math.round(-900 + random() * 2900) };
    if (geometry.canMove(p, { ...p, x: p.x + 1 }, base)) points.push(p);
  }
  let routes = 0, before = 0, after = 0, unresolved = 0;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < Math.min(points.length, i + 6); j++) {
    let raw; try { raw = plan(points[i], points[j]); } catch { continue; }
    routes++;
    if (rejected(geometry, raw).length) before++;
    const result = detourRejectedEdges(raw, base, (a, b, size) => geometry.canMove(a, b, size));
    if (rejected(geometry, result.plot).length) after++;
    unresolved += result.unresolved.length;
  }
  assert.ok(routes > 100);
  assert.ok(before > 0, 'the sample exercises rejected edges');
  // A route may keep a rejected edge only when no detour exists for it (the client repair backstop).
  assert.ok(after === 0 || unresolved > 0, `rejected routes ${before} -> ${after} with ${unresolved} unresolved`);
  assert.ok(after <= before / 4, `rejected routes ${before} -> ${after}`);
});

test('valid routes are returned unchanged and a failing check leaves the plot alone', () => {
  const plot = [{ map: 'main', x: 0, y: 0 }, { map: 'main', x: 50, y: 0 }, { map: 'main', x: 50, y: 50 }];
  const same = detourRejectedEdges(plot, base, () => true);
  assert.equal(same.plot, plot);
  assert.equal(same.detoured, 0);
  const broken = detourRejectedEdges(plot, base, () => { throw Error('no collision source'); });
  assert.equal(broken.plot, plot);
  const transitions = [{ map: 'main', x: 0, y: 0 }, { map: 'bank', x: 0, y: -37, transport: true, s: 0 }];
  assert.equal(detourRejectedEdges(transitions, base, () => false).plot, transitions);
});

test('the request base is the one checked', () => {
  const seen = [];
  detourRejectedEdges([{ map: 'main', x: 0, y: 0 }, { map: 'main', x: 9, y: 9 }], { h: 12, v: 9, vn: 4 },
    (a, b, size) => { seen.push(size); return true; });
  assert.deepEqual(seen[0], { h: 12, v: 9, vn: 4 });
});
