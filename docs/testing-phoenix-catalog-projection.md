# Phoenix authorization projection failure inventory

- LiveGame.state() deliberately requests catalog=0 to reduce normal polling payload. monsterChoices is omitted even after the native catalog arrives; waiting on that projection cannot authorize Phoenix.
- The catalog-readiness check must explicitly request state(true), exactly as other native catalog checks do. Keep the original 30-second limit and required real Phoenix entry; never synthesize catalog data.
