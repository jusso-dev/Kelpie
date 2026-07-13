import Foundation
import Observation

@Observable
@MainActor
final class TaskListModel {
    private(set) var tasks: [TaskRecord] = []
    private(set) var isLoading = false
    var errorMessage: String?

    func load(mine: Bool, using client: KelpieAPIClient?) async {
        guard let client else { return }
        isLoading = tasks.isEmpty
        defer { isLoading = false }
        do {
            tasks = try await client.tasks(mine: mine)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    func complete(_ task: TaskRecord, using client: KelpieAPIClient?) async {
        guard let client else { return }
        do {
            _ = try await client.completeTask(id: task.id)
            tasks.removeAll { $0.id == task.id }
        } catch { errorMessage = error.localizedDescription }
    }
}
