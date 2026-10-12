# Steam companion realm navigation failure inventory

Pinned native functions.js creates companion windows with no_html=true, is_bot=1 and code=<managed slot>. Navigating that companion to a bare character path loses native bot identity and CODE startup. A realm hop must preserve these native launch flags, while changing only the character/realm path and excluding unrelated query parameters. Primary windows without launch flags retain the ordinary path. Invalid realms still reject.

The existing native Steam merchant realm-hop E2E checks real arrival, redispatch, completion, home return and stand opening. Before changing the path helper, reproduce its lost flags with an extracted actual helper, then repeat after the change and retain the path ledger.
