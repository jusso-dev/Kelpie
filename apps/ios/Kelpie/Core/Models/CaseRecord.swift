import Foundation

struct CaseRecord: Identifiable, Hashable, Sendable, Codable {
    let id: String
    let caseNumber: String
    let title: String
    let summary: String?
    let status: CaseStatus
    let severity: Severity
    let classification: String
    let tlp: String
    let pap: String
    let assigneeId: String?
    let openedAt: Date
    let updatedAt: Date
    let tasks: [TaskRecord]?
    let observables: [ObservableRecord]?
}
