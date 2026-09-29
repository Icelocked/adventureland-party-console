import type { LiveGame } from '../live-fixtures';

/** Set initial encounter difficulty; native spawning, attacks and deaths remain real. */
export async function seedSmallGoobrawl(live: Pick<LiveGame, 'admin'>) {
  return live.admin(`output=(()=>{
    if(events.goobrawl || E.goobrawl) throw new Error('Seed Goobrawl before activating it');
    if(Object.values(players).some(p=>p.map==='goobrawl')) throw new Error('Seed before arena entry');
    if(Object.keys(instances.goobrawl?.monsters || {}).length) throw new Error('Arena baseline is not empty');
    if(globalThis.__e2eGoobrawlDefinitions) throw new Error('Goobrawl already seeded this scenario');
    globalThis.__e2eGoobrawlDefinitions={bgoo:G.monsters.bgoo.hp,rgoo:G.monsters.rgoo.hp};
    const observableCombatSeconds=5;
    const partyDps=['E2EWarrior','E2EPriest'].reduce((sum,name)=>{
      const p=get_player(name);return sum+p.attack*p.frequency;
    },0);
    const encounterHp=Math.ceil(partyDps*observableCombatSeconds);
    G.monsters.bgoo.hp=Math.max(2000,encounterHp);
    G.monsters.rgoo.hp=Math.max(3000,encounterHp);
    return {scenario:'small-goobrawl',originalHp:globalThis.__e2eGoobrawlDefinitions,
      requestedHp:{bgoo:2000,rgoo:3000},partyDps,observableCombatSeconds,
      initialHp:{bgoo:G.monsters.bgoo.hp,rgoo:G.monsters.rgoo.hp},
      spawning:'unmodified upstream event loop; up to six simultaneous monsters',
      completion:'native combat must kill survivors after the event timer ends'};
  })()`);
}
