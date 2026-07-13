import Foundation

actor KelpieAPIClient {
    private let baseURL: URL
    private let credentials: any CredentialStore
    private let session: URLSession

    init(baseURL: URL, credentials: any CredentialStore, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.credentials = credentials
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.timeoutIntervalForResource = 60
            configuration.waitsForConnectivity = true
            self.session = URLSession(configuration: configuration)
        }
    }

    static func signIn(baseURL: URL, email: String, password: String) async throws -> MobileSignInResponse {
        let client = KelpieAPIClient(baseURL: baseURL, credentials: EmptyCredentialStore())
        return try await client.request(
            path: "api/mobile/auth/sign-in",
            method: "POST",
            body: SignInRequest(email: email, password: password),
            authenticated: false
        )
    }

    func me() async throws -> MobileMeResponse {
        try await request(path: "api/mobile/auth/me")
    }

    func signOut() async throws {
        let _: OKResponse = try await request(
            path: "api/mobile/auth/sign-out",
            method: "POST",
            body: EmptyRequest()
        )
    }

    func cases() async throws -> [CaseRecord] {
        let response: CasesResponse = try await request(
            path: "api/v1/cases",
            query: [URLQueryItem(name: "status", value: "active"), URLQueryItem(name: "limit", value: "100")]
        )
        return response.cases
    }

    func caseDetail(id: String) async throws -> CaseRecord {
        try await request(path: "api/v1/cases/\(id)")
    }

    func comments(caseID: String) async throws -> [CommentRecord] {
        let response: CommentsResponse = try await request(path: "api/v1/cases/\(caseID)/comments")
        return response.comments
    }

    func postComment(caseID: String, body: String) async throws -> CommentRecord {
        try await request(
            path: "api/v1/cases/\(caseID)/comments",
            method: "POST",
            body: CommentRequest(body: body)
        )
    }

    func tasks(mine: Bool = true) async throws -> [TaskRecord] {
        let response: TasksResponse = try await request(
            path: "api/v1/tasks",
            query: [
                URLQueryItem(name: "status", value: "open"),
                URLQueryItem(name: "mine", value: mine ? "true" : "false"),
            ]
        )
        return response.tasks
    }

    func completeTask(id: String) async throws -> TaskRecord {
        try await request(
            path: "api/v1/tasks/\(id)",
            method: "PATCH",
            body: TaskPatchRequest(status: .done)
        )
    }

    func alerts() async throws -> [AlertRecord] {
        let response: AlertsResponse = try await request(
            path: "api/v1/alerts",
            query: [URLQueryItem(name: "status", value: "open"), URLQueryItem(name: "limit", value: "100")]
        )
        return response.alerts
    }

    func alert(id: String) async throws -> AlertRecord {
        try await request(path: "api/v1/alerts/\(id)")
    }

    func triageAlert(id: String, action: AlertAction) async throws -> AlertMutationResponse {
        try await request(
            path: "api/v1/alerts/\(id)",
            method: "PATCH",
            body: AlertActionRequest(action: action)
        )
    }

    func registerDevice(token: String, environment: String) async throws {
        let _: DeviceResponse = try await request(
            path: "api/mobile/devices",
            method: "POST",
            body: DeviceRequest(token: token, environment: environment)
        )
    }

    func unregisterDevice(token: String) async throws {
        let _: OKResponse = try await request(
            path: "api/mobile/devices",
            method: "DELETE",
            body: DeviceDeleteRequest(token: token)
        )
    }

    private func request<Response: Decodable>(
        path: String,
        query: [URLQueryItem] = [],
        method: String = "GET",
        authenticated: Bool = true
    ) async throws -> Response {
        try await request(
            path: path,
            query: query,
            method: method,
            bodyData: nil,
            authenticated: authenticated
        )
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        query: [URLQueryItem] = [],
        method: String,
        body: Body,
        authenticated: Bool = true
    ) async throws -> Response {
        try await request(
            path: path,
            query: query,
            method: method,
            bodyData: try JSONEncoder().encode(body),
            authenticated: authenticated
        )
    }

    private func request<Response: Decodable>(
        path: String,
        query: [URLQueryItem],
        method: String,
        bodyData: Data?,
        authenticated: Bool
    ) async throws -> Response {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = query.isEmpty ? nil : query
        guard let url = components?.url else { throw APIError.invalidServerURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authenticated {
            guard let token = try await credentials.readToken() else {
                throw APIError.unauthenticated
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            let message = payload?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            switch http.statusCode {
            case 401:
                if authenticated { throw APIError.unauthenticated }
                throw APIError.server(status: 401, message: Self.friendlyMessage(for: message))
            case 403:
                if message == "forbidden" { throw APIError.forbidden }
                throw APIError.server(status: 403, message: Self.friendlyMessage(for: message))
            case 404: throw APIError.notFound
            case 409: throw APIError.conflict(message)
            default: throw APIError.server(status: http.statusCode, message: message)
            }
        }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    private static func friendlyMessage(for code: String) -> String {
        switch code {
        case "invalid_credentials": "Email or password is incorrect."
        case "mfa_required": "This account requires two-factor authentication. Use the web console to sign in."
        case "password_reset_required": "Reset your password in the web console before using the mobile app."
        case "onboarding_required": "Finish organisation setup in the web console first."
        case "sso_required": "This organisation requires single sign-on through the web console."
        case "account_locked": "This account is locked. Contact your Kelpie administrator."
        default: code.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let standard = ISO8601DateFormatter()
            if let date = standard.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Invalid ISO-8601 date"
            )
        }
        return decoder
    }
}

enum AlertAction: String, Codable, Sendable { case acknowledge, dismiss, promote }

struct AlertMutationResponse: Decodable, Sendable {
    let id: String
    let status: AlertStatus
    let caseId: String?
}

struct MobileSignInResponse: Decodable, Sendable {
    let token: String
    let expiresAt: Date
    let scopes: [String]
    let user: APIUser
}

struct MobileMeResponse: Decodable, Sendable {
    struct Token: Decodable, Sendable { let id: String; let scopes: [String] }
    let token: Token
    let user: APIUser?
}

private struct SignInRequest: Encodable { let email: String; let password: String }
private struct EmptyRequest: Encodable {}
private struct CommentRequest: Encodable { let body: String }
private struct TaskPatchRequest: Encodable { let status: TaskStatus }
private struct AlertActionRequest: Encodable { let action: AlertAction }
private struct DeviceRequest: Encodable { let token: String; let environment: String }
private struct DeviceDeleteRequest: Encodable { let token: String }
private struct CasesResponse: Decodable { let cases: [CaseRecord] }
private struct CommentsResponse: Decodable { let comments: [CommentRecord] }
private struct TasksResponse: Decodable { let tasks: [TaskRecord] }
private struct AlertsResponse: Decodable { let alerts: [AlertRecord] }
private struct ErrorResponse: Decodable { let error: String }
private struct OKResponse: Decodable { let ok: Bool }
private struct DeviceResponse: Decodable { let id: String }

private actor EmptyCredentialStore: CredentialStore {
    func saveToken(_ token: String) {}
    func readToken() -> String? { nil }
    func deleteAll() {}
}
