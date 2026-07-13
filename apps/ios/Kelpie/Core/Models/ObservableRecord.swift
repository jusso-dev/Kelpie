import Foundation

struct ObservableRecord: Identifiable, Hashable, Sendable, Codable {
    let id: String
    let type: String
    let value: String
    let tlp: String
    let isIoc: Bool
    let description: String?
}
