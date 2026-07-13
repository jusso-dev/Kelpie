import Foundation

struct CommentRecord: Identifiable, Hashable, Sendable, Codable {
    let id: String
    let caseId: String
    let authorId: String?
    let body: String
    let createdAt: Date
}
