import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Page {
      PageHeader(title: "导入", subtitle: "拖入话术表格和录音文件夹，也可以点选。")
      Banners()
      HStack(alignment: .top, spacing: 16) {
        FileDrop(
          path: model.config.workbookPath, type: .spreadsheet, title: "话术表格",
          hint: "探迹标准模板 .xlsx", detail: "Excel 表格",
          choose: model.chooseWorkbook
        ) {
          Button("下载模板") { Task { await model.saveTemplate() } }.buttonStyle(.link)
        }
        FileDrop(
          path: model.config.audioDir, type: .folder, title: "录音文件夹",
          hint: "WAV、MP3、M4A", detail: audioCount.map { "\($0) 个录音" } ?? "文件夹",
          choose: model.chooseAudioDir
        ) { EmptyView() }
      }
      .disabled(model.busy)

      Panel(title: "话术") {
        FieldRow(title: "话术名称", text: binding(\.talkName, limit: 19), limit: 19)
        FieldRow(title: "知识库分类", text: binding(\.categoryName, limit: 9), limit: 9, divider: false)
      }
      .disabled(model.busy)
    }
  }

  private var audioCount: Int? {
    let dir = model.config.audioDir
    guard !dir.isEmpty, let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return nil }
    let audio: Set<String> = ["wav", "mp3", "m4a", "aac", "flac", "ogg"]
    return names.filter { audio.contains(URL(fileURLWithPath: $0).pathExtension.lowercased()) }.count
  }

  private func binding(_ key: WritableKeyPath<UploadConfig, String>, limit: Int) -> Binding<String> {
    Binding(get: { model.config[keyPath: key] }, set: { value in model.update { $0[keyPath: key] = String(value.prefix(limit)) } })
  }
}

/// Large file well: shows the real Finder icon once chosen, a dashed outline before.
struct FileDrop<Extra: View>: View {
  let path: String
  let type: UTType
  let title: String
  let hint: String
  let detail: String
  let choose: () -> Void
  @ViewBuilder var extra: Extra
  @State private var hovering = false

  private var chosen: Bool { !path.isEmpty }
  private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 18, style: .continuous) }

  var body: some View {
    VStack(spacing: 0) {
      ZStack(alignment: .bottomTrailing) {
        Image(nsImage: finderIcon(path, fallback: type))
          .resizable()
          .interpolation(.high)
          .frame(width: 96, height: 96)
          .opacity(chosen ? 1 : 0.5)
          .saturation(chosen ? 1 : 0)
        if chosen {
          Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 20))
            .symbolRenderingMode(.palette)
            .foregroundStyle(.white, .green)
            .background(Circle().fill(.background).padding(2))
            .offset(x: 4, y: 2)
            .transition(.scale.combined(with: .opacity))
        }
      }
      .padding(.bottom, 12)
      Text(chosen ? fileName(path) ?? title : title)
        .font(.title3.weight(.semibold))
        .lineLimit(1)
        .truncationMode(.middle)
      Text(chosen ? detail : hint)
        .font(.callout)
        .foregroundStyle(.secondary)
        .padding(.top, 2)
      HStack(spacing: 14) {
        Button(chosen ? "更换…" : "选取…", action: choose)
        extra
      }
      .padding(.top, 14)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 22)
    .frame(maxWidth: .infinity)
    .background { shape.fill(Color.primary.opacity(hovering ? 0.045 : 0)) }
    .contentShape(shape)
    .onTapGesture(perform: choose)
    .onHover { hovering = $0 }
    .animation(.easeOut(duration: 0.2), value: chosen)
    .animation(.easeOut(duration: 0.15), value: hovering)
  }
}

struct FieldRow: View {
  let title: String
  @Binding var text: String
  let limit: Int
  var divider = true

  var body: some View {
    PanelRow(divider: divider) {
      Text(title).frame(width: 90, alignment: .leading)
      TextField(title, text: $text, prompt: Text("必填"))
        .textFieldStyle(.plain)
        .labelsHidden()
    } trailing: {
      Text("\(text.count)/\(limit)")
        .font(.callout.monospacedDigit())
        .foregroundStyle(text.count >= limit ? AnyShapeStyle(.orange) : AnyShapeStyle(.tertiary))
    }
  }
}

func fileName(_ path: String) -> String? {
  path.isEmpty ? nil : URL(fileURLWithPath: path).lastPathComponent
}

struct CheckupView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let summary = model.summary {
      Page {
        PageHeader(title: headline(summary), subtitle: subline(summary)) {
          Image(systemName: summary.canUpload ? "checkmark.seal.fill" : "xmark.octagon.fill")
            .font(.system(size: 44))
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(summary.canUpload ? .green : .red)
            .symbolEffect(.bounce, value: summary)
        }
        Banners()

        Panel(title: "录音分布") {
          VStack(alignment: .leading, spacing: 14) {
            CompositionBar(parts: [
              .init(title: "主流程", value: summary.flowAudioCount, detail: "\(summary.flowCount) 条", tint: .accentColor),
              .init(title: "含糊话术", value: summary.vagueAudioCount, detail: "\(summary.vagueCount) 条", tint: .accentColor.opacity(0.55)),
              .init(title: "知识库", value: summary.knowledgeAudioCount, detail: "\(summary.knowledgeCount) 条", tint: .accentColor.opacity(0.25)),
            ])
            Text("无效 QA \(summary.invalidQaCount) · 特殊 QA \(summary.specialQaCount) · 两者都有 \(summary.bothQaCount)")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
          .padding(.top, 10)
        }

        Panel(title: "检查项") {
          let rows = checkRows(summary)
          ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
            PanelRow(divider: index < rows.count - 1) {
              RowLabel(title: row.title, detail: row.detail)
            } trailing: {
              if let action = row.action { Button(action.label, action: action.run) }
            }
          }
        }
        .disabled(model.busy)

        if !summary.issues.isEmpty {
          let issues = Array(sortedIssues(summary).prefix(8))
          Panel(title: "需要处理", trailing: "\(summary.issues.count)") {
            ForEach(Array(issues.enumerated()), id: \.offset) { index, issue in
              PanelRow(divider: index < issues.count - 1) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                  Image(systemName: issueSymbol(issue.severity))
                    .foregroundStyle(issueTint(issue.severity))
                    .frame(width: 26)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(issue.message)
                    Text(issueDetail(issue)).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                  }
                }
              }
            }
          }
          if summary.issues.count > 8 {
            Text("另有 \(summary.issues.count - 8) 条，导出报告查看全部。").font(.callout).foregroundStyle(.secondary).padding(.leading, 4)
          }
        }
      }
    } else {
      ContentUnavailableView("还没有检查", systemImage: Step.checkup.symbol, description: Text("导入文件后点“检查数据”。"))
    }
  }

  private struct CheckRow {
    let title: String
    let detail: String
    var action: (label: String, run: () -> Void)?
  }

  private func checkRows(_ summary: PreviewSummary) -> [CheckRow] {
    var rows: [CheckRow] = []
    let match = summary.audioMatch
    if match.smart {
      rows.append(CheckRow(
        title: "录音匹配",
        detail: "已自动匹配 \(match.autoCount)/\(match.items.count)" + (match.reviewCount > 0 ? " · \(match.reviewCount) 条待确认" : ""),
        action: (match.reviewCount > 0 ? "确认…" : "查看…", { model.matchMode = match.reviewCount > 0 ? .review : .list })
      ))
    }
    rows.append(CheckRow(
      title: "话术体检", detail: checkupDetail,
      action: model.checkupCounts.total > 0 ? ("查看…", { model.checkupOpen = true }) : nil
    ))
    if !summary.convertAudioNumbers.isEmpty {
      rows.append(CheckRow(title: "录音格式",
                           detail: "\(summary.convertAudioNumbers.count) 个录音会在上传前转成 8k 单声道 WAV，原文件不变"))
    }
    if let reason = summary.audioMatch.speechUnavailable {
      rows.append(CheckRow(title: "语音识别不可用", detail: "只按文件名匹配：\(reason)"))
    }
    return rows
  }

  private func headline(_ summary: PreviewSummary) -> String {
    summary.canUpload ? "\(summary.plannedUploadCount) 个录音可以上传" : "\(summary.errorCount) 个错误，暂不能上传"
  }

  private func subline(_ summary: PreviewSummary) -> String {
    var parts = [model.subtitle, summary.detectedSheetName]
    if summary.warningCount > 0 { parts.append("\(summary.warningCount) 条提醒") }
    return parts.joined(separator: " · ")
  }

  private var checkupDetail: String {
    let counts = model.checkupCounts
    guard counts.total > 0 else { return "未发现问题" }
    return [counts.fixable > 0 ? "\(counts.fixable) 项可修正" : nil, counts.hints > 0 ? "\(counts.hints) 项提醒" : nil]
      .compactMap { $0 }.joined(separator: " · ")
  }

  private func sortedIssues(_ summary: PreviewSummary) -> [ValidationIssue] {
    let weight = ["error": 0, "warning": 1, "info": 2]
    return summary.issues.sorted { weight[$0.severity, default: 3] < weight[$1.severity, default: 3] }
  }

  private func issueDetail(_ issue: ValidationIssue) -> String {
    let row = issue.rowNumber.map { " · 第 \($0) 行" } ?? ""
    return "\(issue.sheetName ?? "Excel")\(row) · \(issue.suggestion)"
  }

  private func issueSymbol(_ severity: String) -> String {
    switch severity {
    case "error": "xmark.octagon.fill"
    case "warning": "exclamationmark.triangle.fill"
    default: "info.circle.fill"
    }
  }

  private func issueTint(_ severity: String) -> Color {
    switch severity {
    case "error": .red
    case "warning": .orange
    default: .blue
    }
  }
}

struct SettingsSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section {
          LabeledContent {
            Button("打开") { NSWorkspace.shared.open(model.sidecar.paths.logs) }
          } label: {
            RowLabel(title: "运行日志", detail: "出问题时发给维护人员")
          }
          LabeledContent {
            Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "开发版")
          } label: {
            Text("版本")
          }
        }
      }
      .formStyle(.grouped)
      HStack {
        Spacer()
        Button("完成") { dismiss() }.keyboardShortcut(.defaultAction)
      }
      .padding(20)
    }
    .frame(width: 440, height: 270)
  }
}
