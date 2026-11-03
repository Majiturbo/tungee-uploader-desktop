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
    .commands {
      CommandGroup(replacing: .newItem) {
        Button("新建话术") { model.setProduct(.talk); model.setMode("create") }
          .keyboardShortcut("n")
          .disabled(model.busy || model.saved != nil)
        Button("修改已有话术…") { model.setProduct(.talk); model.setMode("modify") }
          .keyboardShortcut("n", modifiers: [.command, .shift])
          .disabled(model.busy || model.saved != nil)
        Button("配置语音 Agent") { model.setProduct(.voiceAgent) }
          .keyboardShortcut("e", modifiers: [.command, .shift])
          .disabled(model.busy)
      }
    }
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
    if let first = value("--tour").flatMap(Int.init) {
      Task {
        try? await Task.sleep(for: .seconds(1))
        Tour.shared.start(at: first)
        if let shot = value("--shot") {
          try? await Task.sleep(for: .seconds(Double(value("--delay") ?? "2") ?? 2))
          snapshot(to: shot)
        }
      }
      return
    }
    guard value("--shot") != nil || value("--workbook") != nil || value("--pack") != nil else { return }
    Task {
      if value("--product") == "voiceAgent" || value("--pack") != nil { model.setProduct(.voiceAgent) }
      if let pack = value("--pack") {
        model.setPack(pack)
        await model.previewVoice()
        if value("--step") == "upload" { model.step = .upload }
      }
      if value("--mode") == "modify" { model.setMode("modify") }
      if let workbook = value("--workbook") { model.update { $0.workbookPath = workbook } }
      if let audio = value("--audio") { model.update { $0.audioDir = audio } }
      if let name = value("--name") { model.update { $0.talkName = name } }
      if let step = value("--step"), !model.isVoiceAgent {
        await model.runCheck()
        switch step {
        case "intent":
          model.step = .intent
          await model.analyzeIntents()
          if CommandLine.arguments.contains("--schedule") { model.scheduledIntents = model.intentResult?.setups }
        case "upload":
          model.step = .upload
          if CommandLine.arguments.contains("--simulate") { simulateUpload(model) }
          if CommandLine.arguments.contains("--resume"), let summary = model.summary {
            try? await Task.sleep(for: .seconds(0.5))
            let done = summary.audioMatch.items.map(\.audioNumber).sorted().prefix(9)
            let time = ISO8601DateFormatter()
            time.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            model.checkpoint = UploadCheckpointInfo(talkName: model.config.talkName, doneAudioNumbers: Array(done),
                                                    updatedAt: time.string(from: Date().addingTimeInterval(-1500)))
          }
          if CommandLine.arguments.contains("--rename") {
            simulateUpload(model)
            model.stage = .rename
            model.renameDraft = "\(model.config.talkName)-2"
            model.logs.append(ProgressEvent(stage: "rename", message: "探迹里已经有“\(model.config.talkName)”了：是上次没传完的就接着传，否则换个名字",
                                            timestamp: ISO8601DateFormatter().string(from: Date())))
          }
        case "compare", "modify":
          model.modifyPlan = Demo.modifyPlan
          model.modifySelected = Set(Demo.modifyPlan.items.filter(\.selected).map(\.id))
          model.step = step == "compare" ? .compare : .modify
          if CommandLine.arguments.contains("--simulate") { simulateModify(model, finished: false) }
          if CommandLine.arguments.contains("--done") { simulateModify(model, finished: true) }
        case "comparing":
          model.step = .compare
          model.modifyTask = .compare
          model.stage = .comparing
          model.progress = (4, 12)
          model.logs = [ProgressEvent(stage: "comparing", message: "正在读取知识库：价格怎么算", timestamp: ISO8601DateFormatter().string(from: Date()))]
        default: break
        }
      }
      switch value("--sheet") {
      case "checkup": model.checkupOpen = true
      case "match": model.matchMode = .list
      case "review": model.matchMode = .review
      case "settings": model.settingsOpen = true
      case "guide": model.templateGuideOpen = true
      default: break
      }
      if CommandLine.arguments.contains("--guide") {
        try? await Task.sleep(for: .seconds(1))
        Tour.shared.follow = CommandLine.arguments.contains("--follow")
        if let next = model.nextStep { Tour.shared.guide(next) }
      }
      if let shot = value("--shot") {
        NSApp.activate()
        NSApp.windows.first { !$0.isVisible }?.orderFrontRegardless()
        try? await Task.sleep(for: .seconds(Double(value("--delay") ?? "3") ?? 3))
        FileHandle.standardError.write("shot step=\(model.step) summary=\(model.summary != nil) wb=\(model.config.workbookPath) err=\(String(describing: model.error))\n".data(using: .utf8)!)
        snapshot(to: shot)
      }
    }
  }

  /// Fakes a half-finished upload so the upload page can be rendered without touching any account.
  static func simulateUpload(_ model: AppModel) {
    guard let summary = model.summary else { return }
    let items = summary.audioMatch.items.sorted { $0.audioNumber < $1.audioNumber }
    let half = items.count / 2
    model.uploadDone = Set(items.prefix(half).map(\.audioNumber))
    model.uploadActive = items[half].audioNumber
    model.stage = .vague
    model.progress = (3, summary.vagueCount)
    let now = ISO8601DateFormatter().string(from: Date())
    model.logs = ["已启动 Chrome", "已登录探迹", "开场白1 已确认上传", "产品介绍2 已确认上传", "含糊话术：正在保存文本"].map {
      ProgressEvent(stage: "flow", message: $0, timestamp: now)
    }
  }

  /// Fakes a modification in progress or finished; nothing is sent to the sidecar.
  static func simulateModify(_ model: AppModel, finished: Bool) {
    let items = model.selectedItems
    let now = ISO8601DateFormatter().string(from: Date())
    if finished {
      model.modifyDone = Set(items.map(\.id))
      model.stage = .completed
      model.modifyMessage = "改好了 \(items.count) 处，话术保留为编辑中"
      model.logs = ["已登录探迹", "开场白1 已改好", "价格怎么算 已改好", model.modifyMessage!].map { ProgressEvent(stage: "flow", message: $0, timestamp: now) }
    } else {
      model.modifyTask = .modify
      model.modifyDone = Set(items.prefix(2).map(\.id))
      model.modifyActive = items[2].id
      model.stage = .flow
      model.progress = (3, items.count)
      model.logs = ["已登录探迹", "开场白1 已改好", "价格怎么算 已改好", "正在修改产品介绍2：换录音"].map { ProgressEvent(stage: "flow", message: $0, timestamp: now) }
    }
  }

  private typealias WindowImage = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?

  /// Captures this app's windows one by one (main window plus any sheet) and composites them.
  static func snapshot(to path: String) {
    guard let main = NSApp.windows.filter(\.isVisible).max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }),
          let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { exit(2) }
    let create = unsafeBitCast(symbol, to: WindowImage.self)
    let windows = [main] + (main.attachedSheet.map { [$0] } ?? []) + (main.childWindows ?? [])
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
