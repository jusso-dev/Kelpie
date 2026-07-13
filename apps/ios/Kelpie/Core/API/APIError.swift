import Foundation

enum APIError: LocalizedError, Sendable {
    case invalidServerURL
    case unauthenticated
    case forbidden
    case notFound
    case conflict(String)
    case server(status: Int, message: String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: "Enter a valid HTTPS Kelpie server URL. Local HTTP URLs are allowed for development."
        case .unauthenticated: "Your session has expired. Sign in again."
        case .forbidden: "Your account does not have permission for this action."
        case .notFound: "This item no longer exists."
        case .conflict(let message): message
        case .server(_, let message): message
        case .invalidResponse: "Kelpie returned an unreadable response."
        }
    }
}
