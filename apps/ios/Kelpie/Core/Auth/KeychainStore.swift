import Foundation
import Security

actor KeychainStore: CredentialStore {
    private let service: String
    private let account = "mobile_session_v1"

    init(service: String = "dev.kelpie.mobile.auth") {
        self.service = service
    }

    func saveToken(_ token: String) throws {
        let data = Data(token.utf8)
        let lookup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let update = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(lookup as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError(status: updateStatus)
        }
        var add = lookup
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError(status: addStatus) }
    }

    func readToken() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            if status == errSecSuccess { throw KeychainError.invalidData }
            throw KeychainError(status: status)
        }
        return token
    }

    func deleteAll() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

enum KeychainError: LocalizedError, Equatable {
    case duplicateItem
    case itemNotFound
    case authenticationFailed
    case interactionNotAllowed
    case invalidData
    case unexpectedStatus(OSStatus)

    init(status: OSStatus) {
        self = switch status {
        case errSecDuplicateItem: .duplicateItem
        case errSecItemNotFound: .itemNotFound
        case errSecAuthFailed: .authenticationFailed
        case errSecInteractionNotAllowed: .interactionNotAllowed
        default: .unexpectedStatus(status)
        }
    }

    var errorDescription: String? { "Secure credential storage failed." }
}
