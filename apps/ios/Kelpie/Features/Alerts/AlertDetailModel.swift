import Foundation
import Observation

@Observable
@MainActor
final class AlertDetailModel {
    private(set) var alert: AlertRecord?
    private(set) var isLoading = false
    private(set) var isActing = false
    var errorMessage: String?

    func load(id: String, using client: KelpieAPIClient?) async {
        guard let client else { return }
        isLoading = alert == nil
        defer { isLoading = false }
        do {
            alert = try await client.alert(id: id)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    func act(_ action: AlertAction, id: String, using client: KelpieAPIClient?) async -> String? {
        guard let client else { return nil }
        isActing = true
        defer { isActing = false }
        do {
            let response = try await client.triageAlert(id: id, action: action)
            await load(id: id, using: client)
            return response.caseId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
