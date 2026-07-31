import SwiftUI

/// The host app exists for exactly one reason: to put the ingest key in the
/// shared Keychain group, which a Share Extension cannot do for itself
/// (extensions can't present their own settings UI). Mirrors the Chrome
/// extension's options page.
@main
struct TasteCaptureApp: App {
    var body: some Scene {
        WindowGroup {
            SettingsView()
                // The extension deep-links here via tastecapture://settings.
                // There is only one screen, so the path is ignored.
                .onOpenURL { _ in }
        }
    }
}
