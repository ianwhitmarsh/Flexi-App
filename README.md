# ShiftMatch — Tinder for local shift work

Swipe-based marketplace that matches local workers with open shifts. Workers
build a profile and résumé and swipe through nearby shifts; businesses post
shifts and swipe through interested workers. When **both sides like**, it's a
match and a chat opens.

Built with **Expo (React Native)** + **Supabase**. It runs out of the box in a
**local demo mode** (no setup, seeded data), and flips to a real cloud backend
the moment you add Supabase credentials.

---

## Quick start

> Node ≥ 22.13 is required (this repo was set up with Node 22.20).

```bash
npm install
npx expo start
```

Then run it one of these ways:

- **On your phone (recommended):** install **Expo Go** (App Store / Play Store)
  and scan the QR code printed in the terminal. This is the real native app.
- **In a browser:** press `w`, or run `npm run web`.
- **iOS Simulator / Android Emulator:** press `i` / `a` (requires Xcode /
  Android Studio).

The app starts in **demo mode** — sign up with any email and password (the data
lives locally on the device), pick a role, and start swiping. The demo seeds a
handful of Oakland-area businesses, shifts, and workers so both roles have
something to swipe immediately.

---

## Going live with Supabase (real backend)

Demo mode keeps everything on-device. To use a real shared backend with auth,
Postgres, résumé storage, and realtime chat:

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is
   fine).
2. **Create the schema.** Open the project's **SQL Editor**, paste the entire
   contents of [`db/schema.sql`](db/schema.sql), and run it. This creates all
   tables, row-level-security policies, the résumé storage bucket, and the
   match-making trigger.
3. **Add your credentials.** Copy `.env.example` to `.env` and fill in the two
   values from **Settings → API**:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```

4. **Restart** the dev server (`npx expo start -c`). The Profile tab footer will
   now read "Connected to Supabase" instead of "Demo mode".

In live mode a match is only created once **both** sides have actually swiped
right — the `on_swipe` trigger in `db/schema.sql` enforces this server-side.
(In demo mode, a worker's right-swipe matches immediately so the flow is easy to
explore solo.)

> Email confirmation: Supabase projects confirm emails by default. For quick
> testing, turn it off under **Authentication → Providers → Email** so new
> sign-ups can log in right away.

---

## How matching works

- **Workers** swipe through open shifts (Discover tab). Right-swipe = "I want
  this shift."
- **Businesses** swipe through the workers who liked their shifts (Applicants
  tab). Right-swipe = "I want this worker."
- A **match** is created when both have right-swiped the same (shift, worker)
  pair, and a 1:1 **chat** opens for them to sort out the details.

## Project structure

```
src/
  app/                      # expo-router routes
    _layout.tsx             # providers + auth gate (auth → onboarding → app)
    (auth)/                 # welcome, sign-in, sign-up
    onboarding/             # role picker + worker/business profile setup
    (tabs)/                 # index (deck), shifts, matches, profile
    match/[id].tsx          # realtime chat
    shift/new.tsx           # post a shift (business)
  components/               # UI primitives, SwipeDeck, cards, MatchModal
  features/                 # WorkerProfileForm, BusinessProfileForm
  lib/
    backend.ts              # Backend interface the whole app talks to
    mockBackend.ts          # in-memory demo backend (AsyncStorage)
    supabaseBackend.ts      # live Supabase backend
    getBackend.ts           # picks live vs demo based on env
    session.tsx             # session/account React context
    types.ts, seed.ts, ...
db/schema.sql               # Supabase schema + RLS + match trigger
```

The app only ever talks to the `Backend` interface, so the demo and live
implementations are fully interchangeable.

## Tech stack

- Expo SDK 56, React Native 0.85, expo-router (typed routes)
- Reanimated + Gesture Handler (the swipe deck)
- Supabase (Postgres, Auth, Storage, Realtime)
- TypeScript throughout

## Notes & next steps

- Résumé upload uses `expo-document-picker`; in live mode files go to the
  `resumes` Storage bucket.
- Geo/distance filtering is currently city-string based — a real launch would
  add lat/long + radius search.
- Push notifications for new matches/messages are a natural next addition
  (`expo-notifications`).
