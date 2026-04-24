---
name: sync-session-jwt-guard
description: All Supabase sync batches must assert access_token is a real JWT (not the offline placeholder) before transmitting; ad-hoc Supabase clients are lint-banned
type: constraint
---

`assertRealSessionForSync` in src/lib/atomic-sync-manager.ts gates every sync entry point (inspections, trainings, daily_assessments) by calling `isUnsafeToTransmit` + `looksLikeJwt` from src/lib/synthetic-session-guard.ts. If the offline placeholder token (`offline_placeholder_token`) leaks into a batch, the guard aborts and surfaces a "Session expired" toast.

H4 enforcement: eslint.config.js bans `import { createClient } from '@supabase/supabase-js'` everywhere except `src/integrations/supabase/client.ts` (the canonical singleton) and tests. Constructing a new client bypasses the pre-flight guard. **Why:** edge-function logs would otherwise expose the placeholder string and every request would 401, dead-lettering otherwise-healthy records.
