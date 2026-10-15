# Native Cave assembly staging failure inventory

- The randomized failed floor entry has combat rooms within 420 units and no directly visible corridor with both required displacement paths. The existing 1,200-unit radial search assumes a straight path from entry; walls can hide safe staging elsewhere on the same floor.
- Select a declared starting position inside the pinned native floor geometry bounds, collision-clear for both actual hitboxes and preserving the existing 420-room/300-enemy clearance for the real 160/85-unit displacements.
- Seed that one starting position before the assembly behavior starts and retain native floor/run ownership. Do not change walls, actors, rooms, receipts or command completion. All displacements, regroup and departure thereafter must use native movement and original assertions.
The revised search regenerates the pinned native floor grid from the actual run seed and requires a collision-clear BFS path from the actual entry for both hitboxes. Bounds alone cannot prove floor connectivity; retained staging evidence includes the native cell path and seed/floor identity.

## Unfinished encounter interruption (419d502, before amendment)

- Run 38447668827 shard 3, artifact 11838568751, declares staging (336,576) and Priest offset (496,576). The actual walk stops at (469.352,576), 26.648 units short, before any assembly waypoint is issued.
- Both native observations are paused and not ready with unresolved choice `ceb92ca03d0a55ae94e229ed:2`, The Shop with One Item, native room `0:shop`. The staging and displacement filters omit encounter rooms. Native choice activation correctly pauses walking.
- Preserve every existing combat-room exclusion; initially proposed excluding unfinished native encounter rooms with the same 420-unit bound, but captured-floor replay proved this infeasible. The final setup below settles the real entry shop and uses the native-derived 300-unit encounter bound. Keep combat 420/410 clearance and 300-unit enemy clearance, both hitboxes, connected-floor proof and all deadlines unchanged.
- The existing native assembly case must still prove actual displacement, new owned regroup, completed regroup receipts and departure; a pause during initial staging must remain a failure rather than extending the setup wait.

### Revised setup, before implementation

The native rule additionally requires !room.voted, center distance below 280 and NPC distance at most 160. Advertised shop coordinates are the NPC, not room center. Resolve only the actual entry shop e31 through real native walking and two participant votes, in a bounded 30-second setup window, before selecting staging. Capture room and vote identity, both votes, room.voted and real unpaused actors. Then inspect actual room state: retain combat 420/410 and enemy 300, with separate 300-unit clearance for unvoted unfinished encounters (20-unit samples leave at least 10 units beyond the native 280-unit trigger). No arbitrary encounter settlement, geometry changes, synthesized acknowledgements or tested-operation deadline changes.
