import Foundation

struct AlertRecord: Identifiable, Hashable, Sendable, Codable {
    let id: String
    let source: String
    let title: String
    let description: String?
    let severity: Severity
    let status: AlertStatus
    let createdAt: Date
    let promotedCaseId: String?
}
