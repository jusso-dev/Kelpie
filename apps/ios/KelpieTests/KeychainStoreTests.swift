import Foundation
import Testing
@testable import Kelpie

private actor MockCredentialStore: CredentialStore {
    var token: String?
    var error: KeychainError?

    func saveToken(_ token: String) throws {
        if let error { throw error }
        self.token = token
    }

    func readToken() throws -> String? {
        if let error { throw error }
        return token
    }

    func deleteAll() throws {
        if let error { throw error }
        token = nil
    }
}

struct KeychainStoreTests {
    @Test("Credential abstraction supports save and complete logout cleanup")
    func credentialLifecycle() async throws {
        let store = MockCredentialStore()
        try await store.saveToken("test-token")
        #expect(try await store.readToken() == "test-token")
        try await store.deleteAll()
        #expect(try await store.readToken() == nil)
    }

    @Test("Credential errors propagate")
    func errorPath() async {
        let store = MockCredentialStore()
        await store.setError(.interactionNotAllowed)
        await #expect(throws: KeychainError.self) { try await store.readToken() }
    }
}

@Suite(.serialized)
struct RealKeychainIntegrationTests {
    @Test("Real Keychain round trip uses a test-specific service and cleans up")
    func roundTrip() async throws {
        let store = KeychainStore(service: "dev.kelpie.mobile.tests.\(UUID().uuidString)")
        try await store.deleteAll()
        try await store.saveToken("integration-token")
        #expect(try await store.readToken() == "integration-token")
        try await store.deleteAll()
        #expect(try await store.readToken() == nil)
    }
}

private extension MockCredentialStore {
    func setError(_ error: KeychainError?) { self.error = error }
}
