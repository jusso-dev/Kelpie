import Foundation

enum AlertStatus: Hashable, Sendable, Codable {
    case new, triaged, dismissed, promoted, unknown(String)

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "new": .new
        case "triaged": .triaged
        case "dismissed": .dismissed
        case "promoted": .promoted
        default: .unknown(value)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    var rawValue: String {
        switch self {
        case .new: "new"
        case .triaged: "triaged"
        case .dismissed: "dismissed"
        case .promoted: "promoted"
        case .unknown(let value): value
        }
    }
}
