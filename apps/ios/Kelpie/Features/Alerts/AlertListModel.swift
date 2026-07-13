import Foundation
import Observation

@Observable
@MainActor
final class AlertListModel {
    private(set) var alerts: [AlertRecord] = []
    private(set) var isLoading = false
    var errorMessage: String?

    func load(using client: KelpieAPIClient?) async {
        guard let client else { return }
        isLoading = alerts.isEmpty
        defer { isLoading = false }
        do {
            alerts = try await client.alerts().sorted { lhs, rhs in
                if lhs.severity == .critical && rhs.severity != .critical { return true }
                if rhs.severity == .critical && lhs.severity != .critical { return false }
                return lhs.createdAt > rhs.createdAt
            }
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
}
