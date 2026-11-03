# S5.2: imported lead writes

No schema change for leads or lead events. Import writes use the existing
`leads_live_phone_idx` partial unique index as the conflict target, and the
existing `imported` / `duplicate_import` event types.
