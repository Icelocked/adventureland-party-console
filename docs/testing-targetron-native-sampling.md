# Native Targetron combat observation failure inventory

- CDP polling in the cfb8d02 native run returned every 1.9–3.4 seconds. The mage moved around terrain and delivered a real hit, but every sampled frame missed the short moving phase at cruise speed; the collision/ownership assertion correctly had no proof.
- Sample actual native character and production positioning state passively every 100 milliseconds inside the CODE frame, with a bounded ledger. Drain observations through the existing poll and retain map, collision-clear, combat-owner, displacement and real damage assertions.
- Stop and remove the observer in finally. Never alter movement, targeting, native methods, receipts or deadlines. Existing native terrain scenario supplies the behavior test.
