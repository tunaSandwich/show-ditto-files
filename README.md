Ditto Code Samples
Select code samples from Ditto, an app to connect with new people based on common interest

Note: This code was written entirely before AI coding assistants. These files represent a small subset of the full codebase, chosen to demonstrate architecture patterns and implementation approach.

## Structure

### `app/` — Mobile App (React Native + TypeScript)

**components/MediaGrid/**
- `index.tsx` — Grid component using ViewModel pattern for rendering media
- `helpers.tsx` — Row generation logic with placeholder handling
- `MediaGridItem.tsx` — Individual media cell with upload states and retry logic
- `styles.ts` — StyleSheet definitions
- `viewModels/createAlbumViewModel.tsx` — Business logic for album creation flow
- `viewModels/editAlbumViewModel.tsx` — Business logic for album editing flow

**store/** (Redux Toolkit)
- `slices/searchSlice.ts` — Slice managing search state for multiple search contexts
- `selectors/search.ts` — Memoized selectors using reselect
- `dispatches/search.ts` — Async thunks for search API calls
- `types/search.ts` — TypeScript type definitions

### `api/` — Backend Services (Node.js/Express)

**routes/hangs/** — Event coordination system
- `joins.js` — Join/leave logic with age, college, and visibility access control
- `joins/add.js` — Author-initiated user additions with invitation tracking
- `messages.js` — Chat system with threaded replies, attachments, and embeds
- `messages/reactions.js` — Emoji reactions with emojilib validation
- `confirmed.js` — RSVP confirmations with push notifications to organizers
- `attended.js` — Post-event attendance tracking for analytics
- `drafts.js` — Geo-proximity suggestions for event invitations using spatial queries
- `mutes.js` — Per-event notification muting
- `expire.js` — Manual event expiration by authors
- `share/locations.js` — Friend sorting for share sheets

**models/**
- `Hang.js` — Sequelize model with spatial indexing, composable scopes, lifecycle hooks, and instance methods for real-time notifications

**test/**
- `hangs.js` — Integration tests for share link validation

---

## Tech Stack

**Mobile**
- React Native + TypeScript
- Redux Toolkit + Reselect
- FastImage for performant media loading

**Backend**
- Node.js / Express
- Sequelize ORM with MySQL (spatial indexes)
- Joi for request/response validation
- MQTT for real-time updates
- Segment Analytics

**Testing**
- Mocha + Chai
