import Foundation

enum Severity: Hashable, Sendable, Codable {
    case low, medium, high, critical, unknown(String)

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "low": .low
        case "medium": .medium
        case "high": .high
        case "critical": .critical
        default: .unknown(value)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    var rawValue: String {
        switch self {
        case .low: "low"
        case .medium: "medium"
        case .high: "high"
        case .critical: "critical"
        case .unknown(let value): value
        }
    }
}
