import Foundation
import Observation

@Observable
@MainActor
final class CaseListModel {
    private(set) var cases: [CaseRecord] = []
    private(set) var isLoading = false
    var errorMessage: String?

    func load(using client: KelpieAPIClient?) async {
        guard let client else { return }
        isLoading = cases.isEmpty
        defer { isLoading = false }
        do {
            cases = try await client.cases().sorted { lhs, rhs in
                let rank: [String: Int] = ["critical": 0, "high": 1, "medium": 2, "low": 3]
                let left = rank[lhs.severity.rawValue] ?? 4
                let right = rank[rhs.severity.rawValue] ?? 4
                return left == right ? lhs.updatedAt > rhs.updatedAt : left < right
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
