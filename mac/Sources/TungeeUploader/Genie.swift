import SwiftUI

/// The Genie shader from `mac/Shaders/Genie.metal`, which the bundle scripts compile into the app's resources.
/// A bare `swift run` has no metallib, and the card just fades.
enum Genie {
  static let library: ShaderLibrary? = Bundle.main.url(forResource: "Genie", withExtension: "metallib").map { ShaderLibrary(url: $0) }
}

/// Runs the Genie effect on a card laid out with `inset` of room around it, the dot sitting `reach` into that room
/// beyond the arrow. `progress` 0 is the card, 1 has it poured into the dot.
struct GenieEffect: ViewModifier {
  let progress: CGFloat
  let arrowX: CGFloat
  let below: Bool
  let inset: EdgeInsets
  /// From the arrow tip to the dot's centre.
  let reach: CGFloat

  func body(content: Content) -> some View {
    if let library = Genie.library {
      let progress = progress, arrowX = arrowX, below = below, inset = inset, reach = reach
      content.visualEffect { view, proxy in
        let size = proxy.size
        let card = CGRect(x: inset.leading, y: inset.top, width: size.width - inset.leading - inset.trailing,
                          height: size.height - inset.top - inset.bottom)
        let target = CGPoint(x: card.minX + arrowX, y: below ? card.minY - reach : card.maxY + reach)
        return view.distortionEffect(
          library.genie(.float2(size), .float4(card.minX, card.minY, card.maxX, card.maxY), .float2(target), .float(progress), .float(below ? 0 : 1)),
          maxSampleOffset: size,
          isEnabled: progress > 0.001
        )
      }
      .opacity(progress > 0.995 ? 0 : 1)
    } else {
      content.opacity(1 - progress)
    }
  }
}
