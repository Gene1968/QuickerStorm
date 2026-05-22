/**
 * Backend entry — quickerSTORM is a Supabase-only app.
 *
 * All presence / auth / announcements traffic goes through `src/api/supabase/`.
 * This file exists solely so consumers can keep importing from
 * `@/api/backend.js` without knowing which impl sits behind it; if we ever
 * swap Supabase out, only this file changes.
 */
export { PresenceRepo }      from './supabase/PresenceRepo.js'
export { AnnouncementsRepo } from './supabase/AnnouncementsRepo.js'
export { AuthRepo }          from './supabase/AuthRepo.js'
export { DoorStateRepo }     from './supabase/DoorStateRepo.js'
export { MessagingRepo }     from './supabase/MessagingRepo.js'
export { KudosRepo }         from './supabase/KudosRepo.js'
