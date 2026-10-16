# Native delayed departure fault delivery

Pre-code failure inventory: run 38330572924 shard11, artifact11784291527,
scenario2a2b89fcda5fd665e7c4-b28c03326f41fc36f277 received a genuine scheduled
signal3.535s before departure. Its route handler then sent a CDP expression to
install the native blocking timer. That operation completed5.359s later; the
timer began2.121s after departure and lasted1ms. Zero of the required three real
cross-deadline stalls occurred. A later outstanding route was already handled
at cleanup. This demonstrates a fault-injection race, not failed walking recovery.

Install one public jQuery ajaxComplete handler in the original native CODE
document before travel. Match genuine POST status requests for the actual warrior,
read their parsed response's scheduled signal, retain epoch/clock offset/request
identity, and schedule the same native event-loop block locally. Cap at three
unique epochs and reject signals whose deadline already passed. Never replay
HTTP or signals, or change movement/ACKs. A replacement CODE document cannot
inherit successful fault receipts. Cleanup disables this namespace alone.

The isolated browser proof must exercise real HTTP XHR JSON completion, unrelated
requests, duplicate/stale signals, and exactly three native event-loop stalls.
The native test retains120s fault admission,90s actual destination arrival,
zero physical route retries, and each real start<=deadline/end>=deadline+1500ms.
