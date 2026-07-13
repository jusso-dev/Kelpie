import Foundation

protocol CredentialStore: Sendable {
    func saveToken(_ token: String) async throws
    func readToken() async throws -> String?
    func deleteAll() async throws
}
