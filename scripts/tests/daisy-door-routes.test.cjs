const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { createNative } = require('../../tools/game/pathfinder-benchmark/native.cjs');
const { createPlannerService } = require('../../runtime/coordinator/navigation/planner-service.ts');
const { repairDoorApproaches } = require('../../runtime/navigation/door-approach.ts');
const { validateRoute } = require('../../runtime/navigation/validation.ts');
const directory = path.resolve('.caracal/game_files/17175');
function fixture() {
  const native = createNative(directory);
  const ports = { game: native.game, walk: (a,b) => native.canWalk(a,b),
    door: (p,d) => native.context.is_door_close(p.map,d,p.x,p.y) && native.context.can_use_door(p.map,d,p.x,p.y),
    hasKey: () => false };
  return { native, ports };
}
test('Daisy to both booboo spawns validates completely after the bounded walking repair', async () => {
  const { native, ports } = fixture();
  const service = createPlannerService(path.resolve('.build/runtime/movement-planner.cjs'));
  const from = { map:'main', x:126, y:-413 };
  try {
    const prepared = service.prepare(native.game, 17175); await prepared.ready;
    assert.equal(prepared.fingerprint, '65911a4d-e2f70215-218667');
    for (const to of [{ map:'spookytown', x:415, y:-702 }, { map:'spookytown', x:-695, y:-785 }]) {
      const result = await service.plan({ id:JSON.stringify(to), version:17175, fingerprint:prepared.fingerprint,
        from, to, town:false, speed:60, base:{h:8,v:7,vn:2} });
      let plot = repairDoorApproaches(ports, from, result.plot);
      const issue = validateRoute(ports, from, to, plot, false);
      if (issue) {
        assert.equal(issue.reason, 'collisions detected');
        assert.equal(issue.from.map, 'main');
        const connector = native.query({from, to:issue.to, town:false},42,3000);
        assert.equal(connector.error, null);
        const bridge = connector.path.map(p => ({...p, transport:p.method==='transport', town:p.method==='town', s:p.spawn}));
        assert.ok(bridge.every(p => p.map==='main' && !p.transport && !p.town));
        plot = [...bridge, ...plot.slice(plot.indexOf(issue.to)+1)];
      }
      assert.equal(validateRoute(ports, from, to, plot, false), null);
      assert.equal(plot.some(p => p.town), false);
    }
  } finally { service.dispose(); }
});
test('level1 door detour walks around the wall and retains the selected transition', () => {
  const { ports } = fixture(), from = {map:'level1',x:-377,y:576};
  const transition = {map:'level2',x:1,y:-5,transport:true,s:1};
  assert.match(validateRoute(ports,from,transition,[transition],false).reason,/approach/);
  const repaired = repairDoorApproaches(ports,from,[transition]);
  assert.ok(repaired.length > 2);
  assert.equal(repaired.at(-1),transition);
  assert.equal(validateRoute(ports,from,transition,repaired,false),null);
});
test('inaccessible or locked doors remain rejected without changing the destination', () => {
  const { ports } = fixture(), from = {map:'level1',x:-377,y:576};
  const transition = {map:'level2',x:1,y:-5,transport:true,s:1};
  const blocked = {...ports,walk:()=>false};
  assert.deepEqual(repairDoorApproaches(blocked,from,[transition]),[transition]);
  const door = ports.game.maps.level1.doors.find(d=>d[4]==='level2'); door[7]='key';
  assert.deepEqual(repairDoorApproaches(ports,from,[{...transition,key:'bkey'}]),[{...transition,key:'bkey'}]);
});
test('unreachable door search stays within its fixed collision-check budget', () => {
  const { ports } = fixture(), from = {map:'level1',x:-377,y:576};
  const transition = {map:'level2',x:1,y:-5,transport:true,s:1};
  let checks = 0;
  const isolated = {...ports, walk:(a,b) => { checks++; return b.x <= from.x && ports.walk(a,b); }};
  assert.deepEqual(repairDoorApproaches(isolated,from,[transition]),[transition]);
  assert.ok(checks > 100, 'exercise the local search, not just direct rejection');
  assert.ok(checks < 17000, 'at most 2048 expansions with eight edges plus direct candidates');
});
