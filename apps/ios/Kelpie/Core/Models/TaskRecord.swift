import Foundation

struct TaskRecord: Identifiable, Hashable, Sendable, Codable {
    let id: String
    let caseId: String
    let title: String
    let description: String?
    let status: TaskStatus
    let assigneeId: String?
    let dueAt: Date?
    let completedAt: Date?
    let caseNumber: String?
    let caseTitle: String?
    let caseSeverity: Severity?
}
