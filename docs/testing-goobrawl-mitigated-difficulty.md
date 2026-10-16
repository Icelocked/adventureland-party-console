# Goobrawl initial difficulty

Before editing, run 38304682974 shard 10 artifact 11775421593 shows Hunt
cancellation retained actual event attendance and combat. Several monsters died
natively about 28 seconds apart, but six monsters did not finish in 120 seconds.
The helper declared five seconds of combat using raw party DPS 34044.6559 and
170224 HP per monster, ignoring target defense. Actual attacks dealt roughly
5500–7800 damage after mitigation.

Pinned upstream server attack resolution applies `damage_multiplier` to target
armor/resistance minus the attacker's corresponding piercing, and additionally
to target fortitude times five. Native constructor copies monster defenses from
its definition. Use those actual defenses, player damage types, piercing and
frequency when declaring initial encounter HP, and record all inputs. Failure
modes: raw DPS overstates effective damage; physical/magical defenses mixed;
global difficulty leaks; post-spawn HP/death forged. Only initial definitions
change; existing cleanup restores them, real spawn/hit/death checks and the
120-second combat-completion bound remain unchanged.
