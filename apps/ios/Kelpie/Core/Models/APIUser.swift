import Foundation

struct APIUser: Identifiable, Hashable, Sendable, Codable {
    let id: String
    let name: String
    let email: String
    let role: String
    let organisationId: String?
    let organisationName: String?
    let organisationSlug: String?
}
