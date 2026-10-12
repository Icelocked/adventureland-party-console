# Native Cave assembly staging failure inventory

- The randomized failed floor entry has combat rooms within 420 units and no directly visible corridor with both required displacement paths. The existing 1,200-unit radial search assumes a straight path from entry; walls can hide safe staging elsewhere on the same floor.
- Select a declared starting position inside the pinned native floor geometry bounds, collision-clear for both actual hitboxes and preserving the existing 420-room/300-enemy clearance for the real 160/85-unit displacements.
- Seed that one starting position before the assembly behavior starts and retain native floor/run ownership. Do not change walls, actors, rooms, receipts or command completion. All displacements, regroup and departure thereafter must use native movement and original assertions.
The revised search regenerates the pinned native floor grid from the actual run seed and requires a collision-clear BFS path from the actual entry for both hitboxes. Bounds alone cannot prove floor connectivity; retained staging evidence includes the native cell path and seed/floor identity.
