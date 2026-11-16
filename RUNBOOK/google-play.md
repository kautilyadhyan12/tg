# Google Play: KWAZO (`com.kwazo.app`)

ROADMAP Stage 5 21c-ii. How the app reaches Google Play, what each of Google's forms holds, and what must change with the app.
The answers as first typed in, and why: `rulings/2026-11-15-21c-ii.md`, `handoff/2026-11-15-21c-ii.md`. Secrets are named by
where they live, never by value: the reviewers' pair is `~/.kwazo/review.txt` on Kd's laptop, the upload key
`~/.kwazo/kwazo-upload.jks` with `upload.properties` (a copy in Kd's Google Drive).

| What | Value |
|---|---|
| Account | Kd's personal Play Console account, developer name **KWAZO**, declared a **trader** |
| App | KWAZO · `com.kwazo.app` (can never change) · free · English (United States) |
| Test track | Closed testing, **Alpha**: all 178 countries; testers = the Google Group `kwazo-testers@googlegroups.com` (anyone joins; members seen by managers only); feedback `support@getkwazo.com` |
| Signing | Play App Signing: Google signs what people install; we sign each upload with the upload key |
| Store files | `apps/mobile/store/`: `listing.md` (the words), `play-icon-512.png`, `play-feature-1024x500.png`, `screenshots/` |
| Data safety | `apps/mobile/scripts/playDataSafety.mjs`, exactly what Play Console holds |

## Sending an update

1. Build it on the laptop: `corepack pnpm --filter mobile store-version` (about 40 minutes; refuses uncommitted changes; the
   files land in `apps/mobile/store-builds/<build number>/`). Its check (`scripts/storeCheck.mjs`) stops a build with the wrong
   id, below Android 16, built-in settings other than the online server, plain http, debugging, another key, a library not on
   16 KB pages, or **a permission the Data safety answers do not cover**.
2. Play Console → **Test and release** → **Testing** → **Closed testing** → **Alpha** → **Create new release** → upload the
   `.aab` → release notes `<en-US>` … `</en-US>` → **Next** → **Save**. The "no deobfuscation file" warning is expected.
3. **Publishing overview** → **Submit N changes for review**. Managed publishing is off: an approved change reaches testers by
   itself. Google: *"Review usually takes seven days or less"*.

Verify: the release reads "Available to testers" on the Alpha track, and a tester's Play Store offers the new version.

## When the app changes, what changes with it

| The app gains… | Change too, in the same pull request or the same day |
|---|---|
| a permission | `storeCheck` stops the build: answer it in `playDataSafety.mjs` (its test says what is missing), then Play Console → **App content** → **Data safety** to match |
| a kind of data, an outside company, a longer keep | the privacy policy (`packages/shared/src/legal.ts`, CLAUDE.md §4), `playDataSafety.mjs`, then Data safety in Play Console |
| a new foreground service type | **App content** → **Foreground service permissions**: the task and a video of the steps (the map and any personal notification blurred) |
| workouts, the camera's form check, any feature named nowhere yet | `listing.md` and new pictures; Play Console's store listing; real screens are not AI-labelled, AI-made art is |
| purchases through Google Play (21e) | the content rating's "purchase digital goods" answer becomes Yes; Data safety's Purchase history stays |
| a new Google signing key (Play Console → **App integrity** → **Play app signing** → **Copy all certificate fingerprints**) | an Android OAuth client for each new SHA-1 in Google Cloud, project "AI Home Gym" → Credentials, package `com.kwazo.app`; without it, Continue with Google fails on the copy from Google Play |

## Google's reviewers

- Play Console → **App content** → **Sign in details** → "Demo account": the pair from `~/.kwazo/review.txt` (Kd types it; it is
  never in git, a message or a picture) and one line saying it signs in by a code that never changes and is a member of
  **KWAZO Demo Gym**. "Full access" is ticked only while that is true. Google's own test devices are NOT allowed to use it: their
  robots on many phones would sign the human reviewer out (one phone at a time per account).
- **KWAZO Demo Gym** (the live console, owner Kd): Austin, US, Morning Yoga Mon/Wed/Fri 07:00, member "Alex Demo" = the
  reviewers' address. A business's members get its features only while it is on a plan: its free trial ends 2026-11-26, so it
  needs a plan before any later review.
- Never sign in as the reviewers' account on your own phone while a review is on; sign out of it after any use.
- If the pair is ever seen outside the laptop file, make a new one (`test-server.md`, "Google's reviewers' sign-in"), change
  the server's settings and Sign in details together.

## Testers and production access

- After approval, send testers two links: the group (https://groups.google.com/g/kwazo-testers, press **Join group**) and the
  test's **Join on the web** link (Alpha → **Testers**). They become testers, then install from Google Play.
- Google: *"a minimum of 12 testers who have been opted in continuously for at least 14 days"*; no country rule. Production
  access is applied for the day after the 14 days, with at least 12 still in (aim for 15 to 20).
- A copy built on the laptop has another signature: uninstall it before installing from Google Play.

## Before the public launch

- A business address in Kd's Google payments profile: for a trader on a personal account Google writes *"your address will also
  be publicly displayed"*, to users everywhere from 2027-03-01.
- Data safety's "delete some data without deleting the account" is answered No until `/delete-account` has a section with the
  steps (the web folder's); then Yes, with its link.
- **Production** countries chosen there (the closed test's countries do not carry over).
