# Xcode Cloud → TestFlight for taste-maker iOS

**Date:** 2026-07-31
**Status:** Repo side done; App Store Connect setup outstanding
**Mirrors:** `sfl/docs/superpowers/specs/2026-07-26-xcode-cloud-testflight-design.md`
and `sleeper-chat/docs/superpowers/specs/2026-07-26-xcode-cloud-testflight-design.md`

## Goal

`git push` to `main` builds the TasteCapture app (including its Share
Extension) and delivers it to TestFlight, installable on the phone ~15 minutes
later. Plus a ~1 minute direct-to-device path for when that's too slow.

## Approach

**Xcode Cloud**, same as sfl and sleeper-chat. Included with the Apple Developer
Program; the 25 free compute hours/month are shared across the whole account, so
sfl, sleeper-chat and taste-maker all draw from the same pool (still ample).

Rejected, consistent with the sibling projects: fastlane + GitHub Actions. It
would mean managing distribution certificates as repo secrets, and private-repo
macOS runners bill at 10×.

## What differs from sfl and sleeper-chat

Those two hand-maintain their `.pbxproj` — which is why sleeper-chat needs
`xc_register.rb` to add source files to the target. **taste-maker generates its
project with xcodegen from `ios/project.yml`**, so new files are picked up
automatically and no registration script is needed.

That creates one tension: Xcode Cloud clones the repo and cannot run xcodegen,
so it needs the `.xcodeproj` and the shared scheme to exist as tracked files.
Resolution: **the generated project is committed**, and `project.yml` remains
the only thing you edit. Verified that `xcodegen generate` is byte-stable — two
consecutive runs produce an identical `project.pbxproj` — so this neither churns
diffs nor changes the target UUIDs the Xcode Cloud scheme pins.

## Status: everything mechanical is done; two account steps remain

Verified working locally, end to end:

- Both bundle IDs (`no.phareim.tastecapture`, `.share`) are **already
  registered** on the developer portal — automatic signing created them during
  the device builds.
- A **real App Store distribution build exports successfully**:
  `xcodebuild archive` → `-exportArchive` with `ExportOptions.plist` produces a
  signed 276K `.ipa`, team `7L482847WS`, extension nested under `PlugIns/`,
  embedded profile "iOS Team Store Provisioning Profile" with
  `get-task-allow = false` and no provisioned devices (i.e. genuinely App
  Store, not ad-hoc), and `ITSAppUsesNonExemptEncryption` present.

So nothing about the project, signing, or packaging is in doubt. What is left
cannot be done from a terminal:

1. **The App Store Connect app record.** Registering a bundle ID and creating
   an app record are different things; only the second is missing, and it
   exists only in the web UI (or via the ASC API — see below).
2. **Either** an Xcode Cloud workflow (Xcode GUI) **or** an App Store Connect
   API key for the local upload path (`ios/scripts/testflight.sh`).

### There is no App Store Connect API key on this machine

Worth recording, because it looks like there is one. `~/Downloads/2026/
AuthKey_P6M4K4S28H.p8` is byte-identical to `sleeper-chat/tasks/certs/AuthKey.p8`
— it is the **APNs push key**, a different kind of credential that will always
return 401 against `api.appstoreconnect.apple.com` no matter which issuer ID is
paired with it. Confirmed against five candidate issuer UUIDs found on disk.

A real one is created at App Store Connect → Users and Access → Integrations →
App Store Connect API. With it, `ios/scripts/testflight.sh` ships a build in one
command without Xcode Cloud at all.

## One-time setup (Mac + Xcode; outstanding)

1. **App Store Connect record.** The bundle IDs are already registered, so this
   is only: App Store Connect → Apps → **+** → New App, platform iOS, bundle ID
   `no.phareim.tastecapture`, and an SKU (anything — `taste-maker` is fine).
   - **Pick a name that isn't taken on the App Store** — a collision bounces
     uploads with `ITMS-90129`. This is why sleeper-chat is named `SleeperChat`
     and not `Sleep`. `taste-maker` is generic enough to be at risk; if it's
     rejected, any unique name works there, and `CFBundleDisplayName` in
     `project.yml` controls what shows under the icon on the phone
     independently.
2. **Create the workflow.** Xcode → Product → Xcode Cloud → Create Workflow for
   the `TasteCapture` scheme. Approve the App Store Connect GitHub App for
   `phareim/taste-maker` (it's already installed on the account for the sibling
   repos — just grant access to this one).
3. **Workflow configuration:**
   - **Trigger:** push to `main`, with a Files-and-Folders start condition
     limited to `ios/**`, so the many pushes that only touch the Nuxt app or
     `server/` don't burn build hours.
   - **Action:** Archive, App Store distribution. Cloud-managed signing covers
     the app target and the Share Extension.
   - **Post-action:** distribute to a TestFlight **internal** testing group.
     Internal builds skip beta review.
   - Build numbers: Xcode Cloud auto-increments. No version-bump scripting.
4. **Phone side.** Accept the internal-tester invite. TestFlight is already
   installed from the sibling apps.

## Repo side (done)

Everything Xcode Cloud needs is in `ios/project.yml` and the generated project:

- `DEVELOPMENT_TEAM: 7L482847WS`, `CODE_SIGN_STYLE: Automatic` on both targets.
- A **shared** scheme at
  `TasteCapture.xcodeproj/xcshareddata/xcschemes/TasteCapture.xcscheme`,
  generated by the target's `scheme:` block. Xcode Cloud only builds shared
  schemes. `ArchiveAction` is `Release`, `buildForArchiving` is YES.
- `SKIP_INSTALL: YES` on the extension. Without it the `.appex` archives as a
  top-level product and the upload is rejected. **xcodegen does not set this.**
- `ITSAppUsesNonExemptEncryption: false` in the app's `info.properties`.
  Without it App Store Connect gates every build behind a manual
  export-compliance prompt.

### The `INFOPLIST_KEY_*` trap

`INFOPLIST_KEY_ITSAppUsesNonExemptEncryption`-style build settings **only apply
when `GENERATE_INFOPLIST_FILE = YES`**. sleeper-chat uses that, so they work
there. taste-maker's targets have an explicit `info.path`, so those settings are
**silently ignored** — the keys must go in `info.properties` instead. This was
caught by inspecting a real archive's `Info.plist`, not by reading the config;
the build gives no warning.

## Daily flow

Edit anywhere → push to `main` → TestFlight notification → tap update.

**Expect to press Start Build manually.** sleeper-chat's push auto-trigger has
never worked — Xcode Cloud is simply never notified of pushes (its repo "Last
accessed" doesn't update); the GitHub App, its permissions and the path rule
have all been ruled out. Assume the same here until proven otherwise, and use
**Start Build** in App Store Connect, or **Rebuild** on an existing build's page
to re-run the same commit.

## Fast path: direct to device

`ios/scripts/deploy-to-phone.sh` — regenerates the project, builds Debug for the
first paired iPhone, installs via `xcrun devicectl`. ~1 minute. The Share
Extension is embedded in the app, so this installs it too.

This is a paid account, so dev builds last until the signing certificate
expires, not 7 days. TestFlight builds expire after **90 days**.

## Error handling

- Build failures surface in App Store Connect and by email; logs are readable
  from a phone.
- **`exportArchive` exit code 70** with everything else green is a transient
  fault in Apple's managed-signing service — just rebuild.
- If cloud signing fails for the extension, let Xcode Cloud manage certificates
  (the default) rather than mixing in manually-managed profiles.

## Out of scope (YAGNI)

No fastlane, no certificates in the repo, no external-tester groups, no App
Store release automation, no `ci_scripts/ci_post_clone.sh` (the committed
project makes it unnecessary).

## Verification

1. Push a change under `ios/` → build starts (or press Start Build).
2. Push a change touching only `server/` → no build starts.
3. Build completes → TestFlight shows it → installs on the phone.
4. Locally, already verified: `xcodebuild ... archive` succeeds, the `.appex` is
   nested under `TasteCapture.app/PlugIns/`, `SharePreprocessor.js` ships at the
   `.appex` top level, and the archive is signed with team `7L482847WS`.
