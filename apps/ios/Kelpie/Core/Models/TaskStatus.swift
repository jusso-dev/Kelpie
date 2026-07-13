import Foundation

enum TaskStatus: Hashable, Sendable, Codable {
    case todo, inProgress, done, blocked, unknown(String)

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "todo": .todo
        case "in_progress": .inProgress
        case "done": .done
        case "blocked": .blocked
        default: .unknown(value)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    var rawValue: String {
        switch self {
        case .todo: "todo"
        case .inProgress: "in_progress"
        case .done: "done"
        case .blocked: "blocked"
        case .unknown(let value): value
        }
    }
}
