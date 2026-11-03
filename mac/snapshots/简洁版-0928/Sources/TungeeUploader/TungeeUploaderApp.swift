import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    MainActor.assumeIsolated { AppModel.shared.sidecar.stop() }
  }
}

@main
struct TungeeUploaderApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = AppModel.shared

  var body: some Scene {
    Window("探迹话术上传助手", id: "main") {
      ContentView()
        .environment(model)
        .frame(minWidth: 980, minHeight: 620)
        .task { DevScript.run(model) }
    }
    .defaultSize(width: 1180, height: 760)
  }
}

/// Development-only launch flags used to render screenshots:
/// --workbook <path> --audio <dir> --name <talk> --step checkup --sheet checkup|match --dark --shot <png>
@MainActor
enum DevScript {
  static func value(_ flag: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
    return args[index + 1]
  }

  static func run(_ model: AppModel) {
    if CommandLine.arguments.contains("--dark") { NSApplication.shared.appearance = NSAppearance(named: .darkAqua) }
    if CommandLine.arguments.contains("--light") { NSApplication.shared.appearance = NSAppearance(named: .aqua) }
    if CommandLine.arguments.contains("--no-inspector") { model.showInspector = false }
    guard value("--shot") != nil || value("--workbook") != nil else { return }
    Task {
      if let workbook = value("--workbook") { model.update { $0.workbookPath = workbook } }
      if let audio = value("--audio") { model.update { $0.audioDir = audio } }
      if let name = value("--name") { model.update { $0.talkName = name } }
      if value("--step") == "checkup" { await model.runCheck() }
      switch value("--sheet") {
      case "checkup": model.checkupOpen = true
      case "match": model.matchMode = .list
      case "review": model.matchMode = .review
      default: break
      }
      if let shot = value("--shot") {
        NSApp.activate()
        try? await Task.sleep(for: .seconds(Double(value("--delay") ?? "3") ?? 3))
        FileHandle.standardError.write("shot step=\(model.step) summary=\(model.summary != nil) wb=\(model.config.workbookPath) err=\(String(describing: model.error))\n".data(using: .utf8)!)
        snapshot(to: shot)
      }
    }
  }

  private typealias WindowImage = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?

  /// Captures this app's windows one by one (main window plus any sheet) and composites them.
  static func snapshot(to path: String) {
    guard let main = NSApp.windows.filter(\.isVisible).max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }),
          let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { exit(2) }
    let create = unsafeBitCast(symbol, to: WindowImage.self)
    let windows = [main] + (main.attachedSheet.map { [$0] } ?? [])
    // optionIncludingWindow = 8; imageOption boundsIgnoreFraming = 1 | bestResolution = 8
    let shots: [(NSRect, CGImage)] = windows.compactMap { window in
      guard let shot = create(.null, 8, UInt32(window.windowNumber), 1 | 8)?.takeRetainedValue() else { return nil }
      return (window.frame, shot)
    }
    guard let base = shots.first?.1 else { exit(3) }
    let scale = CGFloat(base.width) / main.frame.width
    guard let context = CGContext(data: nil, width: base.width, height: base.height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(3) }
    for (frame, shot) in shots {
      let origin = CGPoint(x: (frame.minX - main.frame.minX) * scale, y: (frame.minY - main.frame.minY) * scale)
      context.draw(shot, in: CGRect(origin: origin, size: CGSize(width: shot.width, height: shot.height)))
    }
    guard let image = context.makeImage() else { exit(3) }
    try? NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
    AppModel.shared.sidecar.stop()
    exit(0)
  }
}
