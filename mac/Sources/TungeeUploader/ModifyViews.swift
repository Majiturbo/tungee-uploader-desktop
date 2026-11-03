import AppKit
import SwiftUI

private let doneNote = "上次已经改过"

private enum ChangeGroup: CaseIterable {
  case look, both, audio, text, new, online

  var title: String {
    switch self {
    case .look: "需要你看一眼"
    case .both: "文字和录音"
    case .audio: "只换录音"
    case .text: "只改文字或问法"
    case .new: "新增"
    case .online: "表里没有（不处理）"
    }
  }
}

private let kindTitles = ["flow": "主流程", "vague": "含糊话术", "knowledge": "知识库"]

extension ModifyItem {
  fileprivate var notes: [String] { warnings.filter { $0 != doneNote } }

  fileprivate var group: ChangeGroup? {
    switch status {
    case "same": return nil
    case "online-only": return .online
    case "blocked": return .look
    default: break
    }
    if !notes.isEmpty { return .look }
    if status == "new" { return .new }
    let text = textChanged || phrasesChanged
    if text, audioFile != nil { return .both }
    return audioFile != nil ? .audio : .text
  }

  var changeDetails: [String] {
    var lines: [String] = []
    if status == "new" {
      lines.append("回答：\(clip(newText, 60))")
    } else if status == "online-only" {
      lines.append("探迹里有，表里没有，不会删除")
    } else {
      if textChanged { lines.append("「\(clip(onlineText))」→「\(clip(newText))」") }
      if !addedPhrases.isEmpty { lines.append("加问法：\(addedPhrases.joined(separator: "、"))") }
      if !removedPhrases.isEmpty { lines.append("删问法：\(removedPhrases.joined(separator: "、"))") }
    }
    if let audioFile { lines.append("换成录音「\(audioFile)」") }
    if warnings.contains(doneNote) { lines.append(doneNote) }
    return lines
  }

  var changeSummary: String {
    if status == "new" { return "新增问题" }
    return [textChanged ? (kind == "knowledge" ? "改回答" : "改文字") : nil, phrasesChanged ? "改问法" : nil, audioFile != nil ? "换录音" : nil]
      .compactMap { $0 }.joined(separator: "、")
  }

  var kindTitle: String { kindTitles[kind] ?? kind }
}

private func clip(_ value: String?, _ limit: Int = 36) -> String {
  let text = value ?? ""
  return text.count > limit ? String(text.prefix(limit)) + "…" : text
}

private func readTime(_ timestamp: String) -> String {
  let parser = ISO8601DateFormatter()
  parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  guard let date = parser.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp) else { return "" }
  return date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
}

// MARK: - Compare

struct CompareView: View {
  @Environment(AppModel.self) private var model
  @State private var showOnline = false
  @State private var player = AudioPlayer()

  static func mood(_ model: AppModel) -> AmbientLight.Mood {
    if model.error != nil { return .error }
    if model.stage == .login { return .attention }
    if let plan = model.modifyPlan, !plan.unusedFiles.isEmpty || plan.items.contains(where: { $0.group == .look }) { return .attention }
    return .calm
  }

  var body: some View {
    Page {
      PageHeader(title: title, subtitle: subtitle, caption: caption).tourTarget("header")
      Banners()
      if model.stage == .login, model.comparing { LoginCard().tourTarget("login") }
      if let plan = model.modifyPlan, !model.comparing {
        ForEach(ChangeGroup.allCases, id: \.self) { group in
          section(group, plan)
        }
      }
    }
    .animation(.smooth, value: model.stage)
  }

  private var title: String {
    if model.stage == .login, model.comparing { return "请在 Chrome 里登录探迹" }
    if model.comparing { return "正在和线上对比" }
    guard let plan = model.modifyPlan else { return model.error != nil ? "对比没有完成" : "和线上对比" }
    if !plan.items.contains(where: \.selectable) { return "线上和表格一致" }
    let items = model.selectedItems
    let audio = items.filter { $0.audioFile != nil }.count
    return "改 \(items.count) 处" + (audio > 0 ? "，换 \(audio) 条录音" : "")
  }

  private var subtitle: String {
    if model.stage == .login, model.comparing { return "在 Chrome 中登录探迹后，返回 App 确认登录。" }
    if model.comparing { return model.logs.last?.message ?? "马上开始。" }
    guard let plan = model.modifyPlan else {
      if let error = model.error { return error.message }
      if model.summary?.canUpload != true { return "先在「体检」里检查数据。" }
      return "打开探迹里的「\(model.config.talkName)」，只读不改，找出和表格不一样的地方。"
    }
    if !plan.items.contains(where: \.selectable) { return "没有要改的地方。" }
    return "改之前的线上内容已备份。勾选要改的，再点右上角“下一步：修改”。"
  }

  private var caption: String {
    if model.comparing, let current = model.progress.current, let total = model.progress.total {
      return "\(model.stage.title) · \(current)/\(total)"
    }
    if let plan = model.modifyPlan { return "修改 · \(plan.talkName) · \(readTime(plan.readAt)) 读取" }
    return "修改 · \(model.config.talkName.isEmpty ? "未填写话术名称" : model.config.talkName)"
  }

  @ViewBuilder private func section(_ group: ChangeGroup, _ plan: ModifyPlan) -> some View {
    let items = plan.items.filter { $0.group == group }
    let unused = group == .look && !plan.unusedFiles.isEmpty
    if !items.isEmpty || unused {
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(group.title).font(.title3.weight(.semibold))
          Text("\(items.count + (unused ? 1 : 0))").font(.title3).foregroundStyle(.secondary)
          Spacer()
          if group == .online {
            Button(showOnline ? "收起" : "展开") { withAnimation { showOnline.toggle() } }.buttonStyle(.link)
          }
        }
        if group != .online || showOnline {
          VStack(spacing: 0) {
            if unused {
              AttentionRow(symbol: "exclamationmark.triangle.fill", tint: .orange, title: "\(plan.unusedFiles.count) 个录音没配上",
                           detail: "\(plan.unusedFiles.joined(separator: "、"))：不会上传。")
              if !items.isEmpty { Divider().padding(.leading, 40) }
            }
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
              ChangeRow(item: item, player: player)
              if index < items.count - 1 { Divider().padding(.leading, 40) }
            }
          }
          .disabled(model.busy)
        }
      }
      .tourTarget("changes-\(group)")
    }
  }
}

private struct ChangeRow: View {
  @Environment(AppModel.self) private var model
  let item: ModifyItem
  let player: AudioPlayer

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      Group {
        if item.selectable {
          Toggle(item.label, isOn: Binding(get: { model.modifySelected.contains(item.id) }, set: { model.toggleModifyItem(item.id, $0) }))
            .toggleStyle(.checkbox)
            .labelsHidden()
        } else if item.status == "blocked" {
          Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 17)).foregroundStyle(.orange)
        }
      }
      .frame(width: 26)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(item.label).fontWeight(.medium).foregroundStyle(item.selectable ? .primary : .secondary)
          Text(item.kindTitle).font(.caption).foregroundStyle(.tertiary)
        }
        ForEach(item.changeDetails, id: \.self) { line in
          Text(line).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        ForEach(item.notes, id: \.self) { line in
          Text(line).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
        }
      }
      Spacer(minLength: 12)
      if let file = item.audioFile {
        let playing = player.playing == file
        Button { playing ? player.stop() : player.play(file, in: model.config.audioDir) } label: {
          Image(systemName: playing ? "stop.fill" : "play.fill").contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.borderless)
        .help(playing ? "停止" : "试听")
      }
    }
    .padding(.vertical, 11)
  }
}

// MARK: - Modify

struct ModifyView: View {
  @Environment(AppModel.self) private var model

  static func mood(_ model: AppModel) -> AmbientLight.Mood {
    if model.stage == .completed, model.modifyMessage != nil { return .done }
    if model.stage == .error { return .error }
    if model.stage == .login { return .attention }
    return .calm
  }

  var body: some View {
    let items = model.selectedItems
    Page {
      PageHeader(title: title(items.count), subtitle: subtitle(items.count), caption: caption).tourTarget("header")
      Banners()
      if model.stage == .login, model.modifying { LoginCard().tourTarget("login") }
      if !items.isEmpty { list(items) }
      if model.modifyPlan != nil { settings }
      if !model.logs.isEmpty, !model.showInspector { PageLog().tourTarget("log") }
    }
    .animation(.smooth, value: model.stage)
  }

  private func title(_ total: Int) -> String {
    guard model.modifyPlan != nil else { return "还没有对比" }
    if model.stage == .login, model.modifying { return "请在 Chrome 里登录探迹" }
    if model.modifying { return model.stage == .review ? "正在提交审核" : "正在修改 \(model.modifyDone.count)/\(total)" }
    if model.stage == .completed, model.modifyMessage != nil { return "改完了" }
    if model.stage == .error { return "修改没有完成" }
    if model.stage == .cancelled { return "已经停下" }
    return total > 0 ? "准备修改 \(total) 处" : "没有勾选要改的"
  }

  private func subtitle(_ total: Int) -> String {
    guard model.modifyPlan != nil else { return "先在「对比」页和线上对比。" }
    if model.stage == .login, model.modifying { return "在 Chrome 中登录探迹后，返回 App 确认登录。" }
    if model.modifying { return model.logs.last?.message ?? "马上开始。" }
    if model.stage == .completed, let message = model.modifyMessage { return "\(message)。" }
    if model.stage == .error { return model.error?.message ?? "中途出了点问题。" }
    if model.stage == .cancelled { return "改好的留在探迹里，再点“开始修改”会跳过它们。" }
    if total == 0 { return "回到「对比」页勾选要改的地方。" }
    return "只改勾选的这些，其他内容不动。" + (model.config.submitReview ? "改完提交审核。" : "改完话术保持编辑中。")
  }

  private var caption: String {
    if model.modifying, let current = model.progress.current, let total = model.progress.total {
      return "\(model.stage.title) · \(current)/\(total)"
    }
    return "修改 · \(model.config.talkName)"
  }

  private func state(_ item: ModifyItem) -> RecordingDot.State {
    model.modifyDone.contains(item.id) ? .done : model.modifyActive == item.id ? .active : .pending
  }

  private func list(_ items: [ModifyItem]) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("要改的地方").font(.title3.weight(.semibold))
        Text("\(items.count)").font(.title3).foregroundStyle(.secondary)
      }
      VStack(spacing: 0) {
        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
          HStack(spacing: 14) {
            RecordingDot(state: state(item)).id(state(item) == .active).frame(width: 26)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(item.label).fontWeight(.medium)
              Text(item.kindTitle).font(.caption).foregroundStyle(.tertiary)
            }
            Spacer(minLength: 12)
            Text(item.changeSummary).font(.callout).foregroundStyle(.secondary)
          }
          .padding(.vertical, 9)
          if index < items.count - 1 { Divider().padding(.leading, 40) }
        }
      }
    }
    .tourTarget("modifyList")
  }

  private var settings: some View {
    Panel(title: "修改设置") {
      PanelRow {
        Text("话术名称")
      } trailing: {
        Text(model.config.talkName).foregroundStyle(.secondary)
      }
      if let backup = model.modifyPlan?.backupPath {
        PanelRow {
          RowLabel(title: "改之前的备份", detail: fileName(backup))
        } trailing: {
          Button("打开", systemImage: "folder") {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: backup)])
          }
        }
      }
      PanelRow(divider: false) {
        RowLabel(title: "完成后提交审核", detail: "建议先在探迹里检查一遍，再手动提交。")
      } trailing: {
        Toggle("完成后提交审核", isOn: Binding(get: { model.config.submitReview }, set: { value in model.update { $0.submitReview = value } }))
          .toggleStyle(.switch)
          .labelsHidden()
          .disabled(model.modifying)
      }
    }
    .tourTarget("modifySettings")
  }
}
