import SwiftUI

struct IntentView: View {
  @Environment(AppModel.self) private var model

  static func mood(_ model: AppModel) -> AmbientLight.Mood {
    if model.intentError != nil { return .error }
    if model.scheduledIntents != nil { return .done }
    return model.intentResult?.flagged.isEmpty == false ? .attention : .calm
  }

  private var ready: Bool { model.summary?.canUpload == true }
  private var noKnowledge: Bool { (model.summary?.knowledgeCount ?? 0) == 0 }

  var body: some View {
    Page {
      PageHeader(title: title, subtitle: subtitle, caption: caption)
      Banners()
      if model.intentLoading { progress }
      if let error = model.intentError {
        Callout(symbol: "xmark.octagon.fill", tint: .red, title: error.message, detail: error.suggestion)
        Button("重新分析") { Task { await model.analyzeIntents() } }
      }
      if let result = model.intentResult, !model.intentLoading {
        if !result.setups.isEmpty { schedule(result).tourTarget("schedule") }
        VStack(spacing: 14) {
          ForEach(result.plan.cards) { card in
            IntentCardView(card: card, flagged: Set(result.flagged))
          }
        }
        .tourTarget("intentCards")
        if !result.plan.skipped.isEmpty { skipped(result.plan.skipped, flagged: Set(result.flagged)) }
        footer
      }
    }
    .onAppear(perform: analyzeIfNeeded)
    .onChange(of: model.summary) { analyzeIfNeeded() }
    .alert("上传时自动设置 \(model.intentResult?.setups.count ?? 0) 条意向？", isPresented: Binding(get: { model.intentConfirming }, set: { model.intentConfirming = $0 })) {
      Button("自动设置") { model.scheduledIntents = model.intentResult?.setups }
      Button("取消", role: .cancel) {}
    } message: {
      Text(((model.intentResult?.setups ?? []).map(\.title) + ["", "只新建这些意向，默认的 5 条不改不删；探迹里已有的会跳过。有任何一步失败，就不会自动提交审核。"]).joined(separator: "\n"))
    }
  }

  private func analyzeIfNeeded() {
    guard ready, !noKnowledge, model.saved == nil, model.intentAnalysis == nil, !model.intentLoading, model.intentError == nil else { return }
    Task { await model.analyzeIntents() }
  }

  // MARK: Header

  private var title: String {
    guard ready else { return "先完成体检" }
    if noKnowledge { return "这套话术不用设置意向" }
    if model.intentLoading { return "正在读懂客户会问什么" }
    if model.intentError != nil { return "意向建议没生成" }
    guard let result = model.intentResult else { return "意向建议" }
    return result.plan.cards.isEmpty ? "默认意向已经够用" : "建议新增 \(result.plan.cards.count) 条意向"
  }

  private var subtitle: String {
    guard ready else { return "体检通过后，我会按知识库里的问题给出意向建议。" }
    if noKnowledge { return "没有知识库问题，默认的 5 条意向就够了。" }
    if model.intentLoading {
      if let progress = model.intentProgress, progress.total > 0 { return "本地 AI 在归类第 \(progress.current)/\(progress.total) 个问题。" }
      return "读取知识库…"
    }
    guard let result = model.intentResult else { return "" }
    if result.plan.cards.isEmpty { return "知识库里没有能区分客户意向的问题。" }
    return "默认的 5 条意向保持不动。觉得哪个问题放错了，点一下换过去。"
  }

  private var caption: String? {
    guard let analysis = model.intentAnalysis, !model.intentLoading else { return nil }
    if let reason = analysis.modelUnavailable { return "本地 AI 没启动，这次按关键词归类：\(reason)" }
    return "\(analysis.knowledgeCount) 个知识库问题 · 本地 AI 归类，不联网"
  }

  private var progress: some View {
    Group {
      if let progress = model.intentProgress, progress.total > 0 {
        ProgressView(value: Double(progress.current), total: Double(progress.total))
      } else {
        ProgressView().progressViewStyle(.linear)
      }
    }
    .frame(maxWidth: 360)
  }

  // MARK: Schedule

  @ViewBuilder private func schedule(_ result: IntentPlanResult) -> some View {
    let scheduled = model.scheduledIntents
    Soft(padding: 18) {
      HStack(alignment: .center, spacing: 14) {
        Image(systemName: scheduled == nil ? "wand.and.sparkles" : "checkmark.circle.fill")
          .font(.system(size: 22))
          .foregroundStyle(Color.accentColor)
          .contentTransition(.symbolEffect(.replace))
        VStack(alignment: .leading, spacing: 3) {
          if let scheduled {
            Text("上传完成后，自动新建这 \(scheduled.count) 条").fontWeight(.medium)
            Text(scheduled == result.setups ? "只新建，不动默认意向。" : "你刚调整过问题，自动设置还是之前的版本。")
              .font(.callout).foregroundStyle(scheduled == result.setups ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
          } else {
            Text("让我在上传时顺手设置好").fontWeight(.medium)
            Text("也可以复制下面的建议，自己去探迹里配置。").font(.callout).foregroundStyle(.secondary)
          }
        }
        Spacer(minLength: 12)
        if let scheduled {
          if scheduled != result.setups { Button("更新") { model.intentConfirming = true } }
          Button("不自动设置") { model.scheduledIntents = nil }
        } else {
          Button("上传时自动设置") { model.intentConfirming = true }.prominentGlass()
        }
      }
    }
    .animation(.smooth, value: scheduled)
  }

  // MARK: Skipped

  private func skipped(_ items: [IntentSkipped], flagged: Set<String>) -> some View {
    var reasons: [String] = []
    var names: [String: [String]] = [:]
    for item in items {
      if names[item.reason] == nil { reasons.append(item.reason) }
      names[item.reason, default: []].append(item.name)
    }
    return VStack(alignment: .leading, spacing: 6) {
      Text("不建意向").font(.title3.weight(.semibold))
      VStack(spacing: 0) {
        ForEach(Array(reasons.enumerated()), id: \.offset) { index, reason in
          VStack(alignment: .leading, spacing: 10) {
            Text(reason).font(.callout).foregroundStyle(.secondary)
            Flow(spacing: 6) {
              ForEach(names[reason] ?? [], id: \.self) { name in
                QuestionChip(name: name, flagged: flagged.contains(name))
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.vertical, 13)
          if index < reasons.count - 1 { Divider() }
        }
      }
    }
  }

  private var footer: some View {
    HStack(spacing: 18) {
      Button("复制建议", systemImage: "doc.on.doc") { model.copyIntents() }
      Button("导出…", systemImage: "square.and.arrow.up") { Task { await model.exportIntents() } }
      Spacer()
      Button("重新分析") {
        model.resetIntent()
        Task { await model.analyzeIntents() }
      }
    }
    .tourTarget("intentFooter")
  }
}

private struct IntentCardView: View {
  let card: IntentCard
  let flagged: Set<String>

  var body: some View {
    Soft(padding: 18) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Text(card.level)
            .font(.callout.weight(.semibold))
            .foregroundStyle(tint)
          Text(card.description).font(.title3.weight(.semibold))
          Spacer()
          Text(card.match == "所有" ? "问到全部才算" : "问到任意一个就算").font(.callout).foregroundStyle(.secondary)
        }
        Text(card.when).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        Flow(spacing: 6) {
          ForEach(card.questions, id: \.self) { name in
            QuestionChip(name: name, flagged: flagged.contains(name))
          }
        }
        ForEach(card.confirms, id: \.self) { note in
          Label(note, systemImage: "exclamationmark.circle")
            .font(.callout)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }

  private var tint: Color {
    switch card.level {
    case "A级": .accentColor
    case "B级": .indigo
    default: .secondary
    }
  }
}

private struct QuestionChip: View {
  @Environment(AppModel.self) private var model
  let name: String
  let flagged: Bool
  @State private var open = false

  private var question: IntentQuestion? { model.intentQuestions.first { $0.name == name } }

  var body: some View {
    Button { open = true } label: {
      if flagged {
        Label(name, systemImage: "questionmark.circle.fill").labelStyle(FlaggedLabel())
      } else {
        Text(name).lineLimit(1)
      }
    }
    .tint(question?.source == "user" ? .accentColor : nil)
    .help(flagged ? "我不太确定它属于哪一类，点一下确认" : "点一下换到别的意向")
    .popover(isPresented: $open, arrowEdge: .bottom) { mover }
    .tourTarget("chip-\(name)")
  }

  private var mover: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(name).font(.headline)
        if let phrases = question?.phrases, !phrases.isEmpty {
          Text(phrases.prefix(3).joined(separator: " / ")).font(.callout).foregroundStyle(.secondary).lineLimit(2)
        }
        if flagged { Text("我不太确定它属于哪一类。").font(.callout).foregroundStyle(.orange) }
      }
      Divider()
      Text("放到").font(.callout).foregroundStyle(.secondary)
      Picker("", selection: Binding(get: { intentMoveTargets.first { isCurrent($0.signal) }?.signal ?? "" }, set: { signal in
        model.moveQuestion(name, to: signal)
        open = false
      })) {
        ForEach(intentMoveTargets, id: \.signal) { target in Text(target.label).tag(target.signal) }
      }
      .pickerStyle(.radioGroup)
      .labelsHidden()
    }
    .padding(16)
    .frame(width: 260)
  }

  private func isCurrent(_ signal: String) -> Bool {
    guard let current = question?.signal else { return false }
    return current == signal || (signal == "other" && ["other", "reject"].contains(current))
  }
}

/// Title with an orange leading symbol, for questions that need a look.
private struct FlaggedLabel: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon.foregroundStyle(.orange)
      configuration.title.lineLimit(1)
    }
  }
}
