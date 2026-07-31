import SwiftUI
import TasteCaptureKit

struct SettingsView: View {
    @State private var key: String = ""
    @State private var status: String?
    @State private var hasSavedKey: Bool = false

    private let keychain = KeychainStore()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("TASTE_IOS_KEY", text: $key)
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Ingest key")
                } footer: {
                    Text("Generate with `openssl rand -hex 32`, set it on the Worker with `wrangler secret put TASTE_IOS_KEY`, and paste it here. Stored in the Keychain group shared with the share extension.")
                }

                Section {
                    Button("Save") { save() }
                        .disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if hasSavedKey {
                        Button("Remove saved key", role: .destructive) { remove() }
                    }
                }

                if let status {
                    Section { Text(status).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("taste-maker")
        }
        .onAppear {
            hasSavedKey = keychain.load() != nil
            if hasSavedKey { status = "A key is saved on this device." }
        }
    }

    private func save() {
        if keychain.save(key) {
            key = ""
            hasSavedKey = true
            status = "Saved. The share extension can use it now."
        } else {
            status = "Could not write to the Keychain."
        }
    }

    private func remove() {
        if keychain.delete() {
            hasSavedKey = false
            status = "Removed."
        } else {
            status = "Could not remove the key."
        }
    }
}
