import Foundation
import Observation

@Observable
@MainActor
final class CaseDetailModel {
    private(set) var item: CaseRecord?
    private(set) var comments: [CommentRecord] = []
    private(set) var isLoading = false
    var errorMessage: String?

    func load(id: String, using client: KelpieAPIClient?) async {
        guard let client else { return }
        isLoading = item == nil
        defer { isLoading = false }
        do {
            async let detail = client.caseDetail(id: id)
            async let loadedComments = client.comments(caseID: id)
            item = try await detail
            comments = try await loadedComments
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    func postComment(_ body: String, caseID: String, using client: KelpieAPIClient?) async -> Bool {
        guard let client else { return false }
        do {
            comments.append(try await client.postComment(caseID: caseID, body: body))
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func complete(_ task: TaskRecord, using client: KelpieAPIClient?) async {
        guard let client, let item, var tasks = item.tasks else { return }
        do {
            let updated = try await client.completeTask(id: task.id)
            if let index = tasks.firstIndex(where: { $0.id == task.id }) { tasks[index] = updated }
            self.item = CaseRecord(
                id: item.id, caseNumber: item.caseNumber, title: item.title, summary: item.summary,
                status: item.status, severity: item.severity, classification: item.classification,
                tlp: item.tlp, pap: item.pap, assigneeId: item.assigneeId,
                openedAt: item.openedAt, updatedAt: item.updatedAt, tasks: tasks,
                observables: item.observables
            )
        } catch { errorMessage = error.localizedDescription }
    }
}
