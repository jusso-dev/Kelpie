import Foundation
import Testing
@testable import Kelpie

struct ModelDecodingTests {
    @Test("Unknown severities remain readable")
    func unknownSeverity() throws {
        let severity = try JSONDecoder().decode(Severity.self, from: Data(#""informational""#.utf8))
        #expect(severity == .unknown("informational"))
    }

    @Test("Notification destinations are hashable")
    func destinations() {
        let values: Set<AppDestination> = [.alertDetail("alert_1"), .caseDetail("case_1")]
        #expect(values.count == 2)
    }
}
