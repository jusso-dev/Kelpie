import SwiftUI

struct OperationalBadge: View {
    let text: String
    let colour: Color

    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .foregroundStyle(colour)
            .background(colour.opacity(0.14), in: .capsule)
            .accessibilityLabel(text)
    }
}

extension Severity {
    var colour: Color {
        switch self {
        case .critical: .red
        case .high: .orange
        case .medium: .yellow
        case .low: .green
        case .unknown: .secondary
        }
    }
}
