import Foundation

enum CaseStatus: Hashable, Sendable, Codable {
    case open, inProgress, contained, eradicated, recovered, closed, unknown(String)

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "open": .open
        case "in_progress": .inProgress
        case "contained": .contained
        case "eradicated": .eradicated
        case "recovered": .recovered
        case "closed": .closed
        default: .unknown(value)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    var rawValue: String {
        switch self {
        case .open: "open"
        case .inProgress: "in progress"
        case .contained: "contained"
        case .eradicated: "eradicated"
        case .recovered: "recovered"
        case .closed: "closed"
        case .unknown(let value): value
        }
    }
}
