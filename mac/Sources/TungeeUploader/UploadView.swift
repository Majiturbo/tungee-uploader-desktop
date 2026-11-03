import SwiftUI

/// Waiting for the user to log in to Tungee in Chrome; shared by upload, compare and modify.
struct LoginCard: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Soft(padding: 18) {
      HStack(spacing: 14) {
        Image(systemName: "person.crop.circle.badge.checkmark").font(.system(size: 22)).foregroundStyle(Color.accentColor)
        VStack(alignment: .leading, spacing: 3) {
          Text("在 Chrome 里登录探迹").fontWeight(.medium)
          Text("在 Chrome 中登录探迹后，回到这里点确认。").font(.callout).foregroundStyle(.secondary)
        }
        Spacer(minLength: 12)
        Button("已登录，继续", action: model.confirmLogin).prominentGlass()
      }
    }
  }
}

/// The run log on the page itself, for when the progress column is hidden.
struct PageLog: View {
  @Environment(AppModel.self) private var model
  @State private var showAll = false

  var body: some View {
    let limit = 6
    let logs = showAll ? model.logs : Array(model.logs.suffix(limit))
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text("运行记录").font(.title3.weight(.semibold))
        Spacer()
        if model.logs.count > limit {
          Button(showAll ? "只看最近" : "全部 \(model.logs.count) 条") { showAll.toggle() }.buttonStyle(.link)
        }
      }
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(logs.enumerated()), id: \.offset) { index, event in
          HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(RunLog.time(event.timestamp)).font(.callout.monospacedDigit()).foregroundStyle(.tertiary)
            Text(event.message)
              .foregroundStyle(event.stage == "error" ? AnyShapeStyle(.red) : index == logs.count - 1 ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(.vertical, 7)
        }
      }
    }
  }
}

struct UploadView: View {
  @Environment(AppModel.self) private var model

  static func mood(_ model: AppModel) -> AmbientLight.Mood {
    switch model.stage {
    case .completed: .done
    case .error: .error
    case .login, .rename: .attention
    default: .calm
    }
  }

  private var live: Bool { model.uploading || model.stage == .completed || model.checkpoint != nil }

  var body: some View {
    Page {
      PageHeader(title: title, subtitle: subtitle, caption: caption)
      Banners()
      if model.stage == .login { LoginCard().tourTarget("login") }
      if model.stage == .rename { rename.tourTarget("rename") }
      if let checkpoint = model.checkpoint, !model.uploading { resume(checkpoint).tourTarget("resume") }
      if let summary = model.summary, summary.canUpload {
        RecordingMap(summary: summary, state: { dotState($0, summary) }, legend: legend)
      }
      settings
      if !model.logs.isEmpty, !model.showInspector { PageLog().tourTarget("log") }
    }
    .animation(.smooth, value: model.stage)
  }

  // MARK: Header

  private var total: Int { model.summary?.audioMatch.items.count ?? 0 }

  private var title: String {
    guard let summary = model.summary else { return "还不能上传" }
    switch model.stage {
    case .converting, .launching: return "正在准备"
    case .login: return "请在 Chrome 里登录探迹"
    case .rename: return "换个话术名称"
    case .flow, .vague, .knowledge: return "正在上传 \(model.uploadDone.count)/\(total)"
    case .intent: return "正在设置意向"
    case .review: return "正在提交审核"
    case .completed: return "传完了"
    case .error: return model.checkpoint == nil ? "上传没有完成" : "传到一半停下了"
    case .cancelled: return "已经停下"
    default:
      if model.checkpoint != nil { return "上次传到一半" }
      if !summary.canUpload { return "还不能上传" }
      if !model.canRun { return "还差话术名称" }
      return "准备好了"
    }
  }

  private var subtitle: String {
    guard let summary = model.summary else { return "先导入文件并完成体检。" }
    let last = model.logs.last?.message
    switch model.stage {
    case .converting, .launching, .flow, .vague, .knowledge, .intent, .review: return last ?? "马上开始。"
    case .login: return "在 Chrome 中登录探迹后，返回 App 确认登录。"
    case .rename: return "探迹里已经有「\(model.config.talkName)」了。想改它就点“改这套话术”，上次没传完就接着传，否则换个名字。"
    case .completed: return model.uploadMessage ?? last ?? "所有内容都已上传。"
    case .error: return model.error?.message ?? "中途出了点问题。"
    case .cancelled: return model.checkpoint == nil ? "已传的内容留在探迹里，随时可以再传一次。" : "已传的内容留在探迹里，点“接着传”会跳过它们。"
    default:
      if !summary.canUpload { return "体检里还有 \(summary.errorCount) 处错误要先改。" }
      if !model.canRun { return "回到导入页填一下话术名称和知识库分类。" }
      if let checkpoint = model.checkpoint {
        return "接着传只补剩下的 \(max(0, total - checkpoint.doneAudioNumbers.count)) 条，传到「\(checkpoint.talkName)」。"
      }
      var parts = ["\(summary.plannedUploadCount) 条录音会传到探迹的「\(model.config.talkName)」"]
      if let intents = model.scheduledIntents, !intents.isEmpty { parts.append("传完再新建 \(intents.count) 条意向") }
      return parts.joined(separator: "，") + "。"
    }
  }

  private var caption: String? {
    guard model.uploading, let current = model.progress.current, let count = model.progress.total else { return nil }
    return "\(model.stage.title) · \(current)/\(count)"
  }

  // MARK: Pieces

  private var legend: [(RecordingDot.State, String)] {
    !model.uploading && model.checkpoint != nil ? [(.done, "已上传"), (.pending, "还没传")]
      : live ? [(.done, "已上传"), (.active, "正在传"), (.pending, "等待")] : [(.matched, "已配对"), (.converted, "上传前处理"), (.missing, "缺录音")]
  }

  private func dotState(_ item: AudioMatchItem, _ summary: PreviewSummary) -> RecordingDot.State {
    if live {
      if model.uploadActive == item.audioNumber { return .active }
      let done = model.uploading ? model.uploadDone : Set(model.checkpoint?.doneAudioNumbers ?? Array(model.uploadDone))
      if done.contains(item.audioNumber) { return item.fileName == nil ? .missing : .done }
      return .pending
    }
    if item.fileName == nil { return .missing }
    return summary.isProcessed(item) ? .converted : .matched
  }

  private var rename: some View {
    @Bindable var model = model
    return Soft(padding: 18) {
      HStack(spacing: 14) {
        Image(systemName: "character.cursor.ibeam").font(.system(size: 22)).foregroundStyle(.orange)
        VStack(alignment: .leading, spacing: 8) {
          Text("探迹里已有同名话术").fontWeight(.medium)
          TextField("新的话术名称", text: $model.renameDraft)
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 280)
            .onSubmit(model.submitRename)
          Text("\(model.renameDraft.trimmingCharacters(in: .whitespaces).count)/19").font(.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: 12)
        Button("改这套话术") { Task { await model.modifyExistingTalk() } }
        Button("接着传到「\(model.config.talkName)」", action: model.useExistingTalk)
        Button("用新名字继续", action: model.submitRename).prominentGlass().disabled(!model.renameValid)
      }
    }
  }

  private func resume(_ checkpoint: UploadCheckpointInfo) -> some View {
    Soft(padding: 18) {
      HStack(spacing: 14) {
        Image(systemName: "arrow.clockwise.circle").font(.system(size: 22)).foregroundStyle(Color.accentColor)
        VStack(alignment: .leading, spacing: 3) {
          Text("上次传到一半").fontWeight(.medium)
          Text("「\(checkpoint.talkName)」已完成 \(checkpoint.doneAudioNumbers.count) 条\(savedAt(checkpoint.updatedAt))，接着传会跳过它们。")
            .font(.callout).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 12)
        Button("重新开始") { Task { await model.startUpload() } }.disabled(!model.canStart || model.busy)
        Button("接着传") { Task { await model.startUpload(resume: true) } }.prominentGlass().disabled(!model.canStart || model.busy)
      }
    }
  }

  private func savedAt(_ timestamp: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: timestamp) else { return "" }
    return "（" + date.formatted(.relative(presentation: .named)) + "）"
  }

  private var settings: some View {
    Panel(title: "上传设置") {
      PanelRow {
        Text("话术名称")
      } trailing: {
        Text(model.config.talkName.isEmpty ? "未填写" : model.config.talkName).foregroundStyle(.secondary)
      }
      PanelRow {
        Text("知识库分类")
      } trailing: {
        Text(model.config.categoryName).foregroundStyle(.secondary)
      }
      PanelRow {
        RowLabel(title: "意向", detail: model.scheduledIntents.map { "传完后自动新建 \($0.count) 条" } ?? "不自动设置")
      } trailing: {
        Button("去设置") { model.step = .intent }
      }
      PanelRow(divider: false) {
        RowLabel(title: "完成后提交审核", detail: "建议先在探迹里检查一遍，再手动提交。")
      } trailing: {
        Toggle("完成后提交审核", isOn: Binding(get: { model.config.submitReview }, set: { value in model.update { $0.submitReview = value } }))
          .toggleStyle(.switch)
          .labelsHidden()
      }
    }
    .tourTarget("uploadSettings")
    .disabled(model.uploading)
  }
}
