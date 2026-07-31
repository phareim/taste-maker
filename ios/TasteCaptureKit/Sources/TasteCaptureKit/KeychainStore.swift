import Foundation
import Security

/// Reads and writes the ingest key in the Keychain shared between the host app
/// (which writes it) and the Share Extension (which reads it).
///
/// `kSecAttrAccessGroup` is deliberately never passed: when a process is
/// entitled with exactly one keychain-access-group, Keychain Services uses it
/// automatically. Naming it in Swift would mean hardcoding the team's
/// `$(AppIdentifierPrefix)`, which only expands inside entitlements plists.
public struct KeychainStore: Sendable {
    private let service: String
    private let account: String

    public init(service: String = "no.phareim.tastecapture", account: String = "ingest-key") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty
        else { return nil }
        return value
    }

    @discardableResult
    public func save(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return delete() }
        guard let data = trimmed.data(using: .utf8) else { return false }

        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // The extension may be launched from the Share Sheet before the
            // device has been unlocked since boot, so first-unlock is the
            // right accessibility floor.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return true }
        if status == errSecItemNotFound {
            var insert = baseQuery
            insert.merge(attributes) { _, new in new }
            return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
        }
        return false
    }

    @discardableResult
    public func delete() -> Bool {
        let status = SecItemDelete(baseQuery as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
