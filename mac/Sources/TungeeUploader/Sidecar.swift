import AppKit
import Foundation
import UniformTypeIdentifiers

/// Runtime locations. A packaged app carries everything under Contents/Resources;
/// a development build points at the repository through TUNGEE_DEV_ROOT and TUNGEE_NODE.
struct RuntimePaths {
  let node: URL
  let sidecar: URL
  let template: URL
  let asr: URL
  let llm: URL
  let userData: URL
  let logs: URL

  static let appFolder = "tungee-uploader-desktop"
  static let llmFile = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"

  static func resolve() -> RuntimePaths {
    let fm = FileManager.default
    let env = ProcessInfo.processInfo.environment
    let resources = Bundle.main.resourceURL!
    let bundled = resources.appending(path: "app/out/main/sidecar.js")
    let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: appFolder)
    let logs = fm.urls(for: .libraryDirectory, in: .userDomainMask)[0].appending(path: "Logs/\(appFolder)")
    if fm.fileExists(atPath: bundled.path) {
      return RuntimePaths(
        node: resources.appending(path: "node/bin/node"),
        sidecar: bundled,
        template: resources.appending(path: "探迹话术标准模板_v1.0.xlsx"),
        asr: resources.appending(path: "models/asr"),
        llm: resources.appending(path: "models/llm/\(llmFile)"),
        userData: support,
        logs: logs
      )
    }
    let info = Bundle.main.infoDictionary ?? [:]
    let root = URL(fileURLWithPath: env["TUNGEE_DEV_ROOT"] ?? info["TungeeDevRoot"] as? String ?? fm.currentDirectoryPath)
    return RuntimePaths(
      node: URL(fileURLWithPath: env["TUNGEE_NODE"] ?? info["TungeeDevNode"] as? String ?? "/usr/local/bin/node"),
      sidecar: root.appending(path: "out/main/sidecar.js"),
      template: root.appending(path: "resources/探迹话术标准模板_v1.0.xlsx"),
      asr: root.appending(path: ".models/asr"),
      llm: root.appending(path: ".models/llm/\(llmFile)"),
      userData: support,
      logs: logs
    )
  }
}

private struct AnyEncodable: Encodable {
  let value: Encodable
  init(_ value: Encodable) { self.value = value }
  func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

private struct SaveOptions: Decodable {
  struct Filter: Decodable { var name: String; var extensions: [String] }
  var title: String
  var defaultPath: String
  var filters: [Filter]
}

enum SidecarError: Error, CustomStringConvertible {
  case notRunning
  case remote(String)

  var description: String {
    switch self {
    case .notRunning: "后台服务没有运行"
    case .remote(let message): message
    }
  }
}

@MainActor
final class Sidecar {
  let paths = RuntimePaths.resolve()
  var onProgress: ((ProgressEvent) -> Void)?
  var onAiProgress: ((AiProgress) -> Void)?
  var onExit: ((Int32) -> Void)?

  private var process: Process?
  private var input: FileHandle?
  private var buffer = Data()
  private var nextId = 1
  private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
  private var readyWaiters: [CheckedContinuation<Void, Never>] = []
  private var ready = false
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()

  func start() throws {
    guard process == nil else { return }
    try FileManager.default.createDirectory(at: paths.userData, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: paths.logs, withIntermediateDirectories: true)
    let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let child = Process()
    child.executableURL = paths.node
    child.arguments = [
      paths.sidecar.path,
      "--user-data", paths.userData.path,
      "--log-dir", paths.logs.path,
      "--downloads", downloads.path,
      "--template", paths.template.path,
      "--asr", paths.asr.path,
      "--llm", paths.llm.path,
    ]
    let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
    child.standardInput = stdin
    child.standardOutput = stdout
    child.standardError = stderr
    stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let chunk = handle.availableData
      Task { @MainActor in self?.receive(chunk) }
    }
    let logURL = paths.logs.appending(path: "sidecar-stderr.log")
    FileManager.default.createFile(atPath: logURL.path, contents: nil)
    let log = try? FileHandle(forWritingTo: logURL)
    stderr.fileHandleForReading.readabilityHandler = { handle in
      let chunk = handle.availableData
      if !chunk.isEmpty { log?.write(chunk) }
    }
    child.terminationHandler = { [weak self] finished in
      let status = finished.terminationStatus
      Task { @MainActor in self?.exited(status) }
    }
    try child.run()
    process = child
    input = stdin.fileHandleForWriting
  }

  func stop() {
    try? input?.close()
    process?.terminate()
  }

  func waitUntilReady() async {
    if ready { return }
    await withCheckedContinuation { readyWaiters.append($0) }
  }

  func call<T: Decodable>(_ method: String, _ params: Encodable..., as type: T.Type = T.self) async throws -> T {
    await waitUntilReady()
    guard let input else { throw SidecarError.notRunning }
    let id = nextId
    nextId += 1
    let encodedParams = try params.map { try encoder.encode(AnyEncodable($0)) }
    var line = Data(#"{"id":\#(id),"method":"# .utf8)
    line.append(try encoder.encode(method))
    line.append(Data(#","params":["#.utf8))
    for (index, param) in encodedParams.enumerated() {
      if index > 0 { line.append(Data(",".utf8)) }
      line.append(param)
    }
    line.append(Data("]}\n".utf8))
    let data: Data = try await withCheckedThrowingContinuation { continuation in
      pending[id] = continuation
      input.write(line)
    }
    return try decoder.decode(T.self, from: data)
  }

  private func receive(_ chunk: Data) {
    guard !chunk.isEmpty else { return }
    buffer.append(chunk)
    while let newline = buffer.firstIndex(of: 0x0A) {
      let line = buffer[buffer.startIndex..<newline]
      buffer.removeSubrange(buffer.startIndex...newline)
      if !line.isEmpty { handle(Data(line)) }
    }
  }

  private func handle(_ line: Data) {
    guard let message = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { return }
    if let id = message["id"] as? Int, let continuation = pending.removeValue(forKey: id) {
      if let error = message["error"] as? [String: Any] {
        continuation.resume(throwing: SidecarError.remote(error["message"] as? String ?? "未知错误"))
      } else {
        let result = message["result"] ?? NSNull()
        continuation.resume(returning: (try? JSONSerialization.data(withJSONObject: result, options: .fragmentsAllowed)) ?? Data("null".utf8))
      }
    } else if let event = message["event"] as? String {
      let payload = (try? JSONSerialization.data(withJSONObject: message["payload"] ?? NSNull(), options: .fragmentsAllowed)) ?? Data()
      switch event {
      case "ready":
        ready = true
        readyWaiters.forEach { $0.resume() }
        readyWaiters.removeAll()
      case "automation:progress":
        if let progress = try? decoder.decode(ProgressEvent.self, from: payload) { onProgress?(progress) }
      case "ai:progress":
        if let progress = try? decoder.decode(AiProgress.self, from: payload) { onAiProgress?(progress) }
      default:
        break
      }
    } else if let hostId = message["hostId"] as? Int, let method = message["hostMethod"] as? String {
      let params = (try? JSONSerialization.data(withJSONObject: message["params"] ?? NSNull(), options: .fragmentsAllowed)) ?? Data()
      Task { await answerHost(hostId, method, params) }
    }
  }

  private func answerHost(_ hostId: Int, _ method: String, _ params: Data) async {
    var result: String?
    if method == "pickSavePath", let options = try? decoder.decode(SaveOptions.self, from: params) {
      result = pickSavePath(options)
    }
    let reply: [String: Any] = ["hostId": hostId, "result": result ?? NSNull()]
    guard var data = try? JSONSerialization.data(withJSONObject: reply) else { return }
    data.append(0x0A)
    input?.write(data)
  }

  private func pickSavePath(_ options: SaveOptions) -> String? {
    let panel = NSSavePanel()
    panel.title = options.title
    let target = URL(fileURLWithPath: options.defaultPath)
    panel.directoryURL = target.deletingLastPathComponent()
    panel.nameFieldStringValue = target.lastPathComponent
    panel.allowedContentTypes = options.filters.flatMap(\.extensions).compactMap { UTType(filenameExtension: $0) }
    panel.canCreateDirectories = true
    return panel.runModal() == .OK ? panel.url?.path : nil
  }

  private func exited(_ status: Int32) {
    process = nil
    input = nil
    ready = false
    for continuation in pending.values { continuation.resume(throwing: SidecarError.notRunning) }
    pending.removeAll()
    onExit?(status)
  }
}
