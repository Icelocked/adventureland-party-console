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
    const mitigation={};
    for(const type of ['bgoo','rgoo']){
      const definition=G.monsters[type];
      const contributions=['E2EWarrior','E2EPriest'].map(name=>{
        const p=get_player(name),physical=p.damage_type==='physical',defense=physical?'armor':'resistance',pierce=physical?'apiercing':'rpiercing';
        const multiplier=damage_multiplier((definition[defense]||0)-(p[pierce]||0))*damage_multiplier((definition.for||0)*5);
        return {name,damageType:p.damage_type,attack:p.attack,frequency:p.frequency,defense:definition[defense]||0,piercing:p[pierce]||0,fortitude:definition.for||0,multiplier,dps:p.attack*p.frequency*multiplier};
      });
      const effectiveDps=contributions.reduce((sum,entry)=>sum+entry.dps,0);
      if(!Number.isFinite(effectiveDps)||effectiveDps<=0)throw Error('Invalid native Goobrawl effective DPS');
      mitigation[type]={contributions,effectiveDps};
      definition.hp=Math.max(type==='bgoo'?2000:3000,Math.ceil(effectiveDps*observableCombatSeconds));
    }
    return {scenario:'small-goobrawl',originalHp:globalThis.__e2eGoobrawlDefinitions,
      requestedHp:{bgoo:2000,rgoo:3000},partyDps,observableCombatSeconds,mitigation,
      initialHp:{bgoo:G.monsters.bgoo.hp,rgoo:G.monsters.rgoo.hp},
      spawning:'unmodified upstream event loop; up to six simultaneous monsters',
      completion:'native combat must kill survivors after the event timer ends'};
  })()`);
}
