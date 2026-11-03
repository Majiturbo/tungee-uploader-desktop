import AppKit
import SwiftUI

/// The single thing the user should do next in their real session.
struct NextStep: Equatable {
  let id: String
  let hint: String
  var target: String?
  var title: String
  var body: String = ""
  var optional = false
  var waiting = false
  var help: CoachAction?
}

enum CoachAction: Equatable {
  case chooseWorkbook, chooseAudio, focusTalkName, focusCategory, runCheck, openReview, openCheckup, openWorkbook, schedule, retryIntent, startUpload, resumeUpload, openPhrases
  case startCompare, startModify
  case go(Step)

  var label: String {
    switch self {
    case .chooseWorkbook, .chooseAudio: "帮我选取"
    case .focusTalkName, .focusCategory: "帮我定位"
    case .runCheck: "帮我检查"
    case .openReview, .openCheckup, .openPhrases: "帮我打开"
    case .openWorkbook: "打开表格"
    case .schedule: "帮我设置"
    case .retryIntent: "重新分析"
    case .startUpload, .startCompare, .startModify: "帮我开始"
    case .go: "带我过去"
    case .resumeUpload: "帮我继续"
    }
  }
}

extension AppModel {
  var nextStep: NextStep? {
    guard saved == nil, sidecarFailed == nil, let (page, next) = rawNextStep() else { return nil }
    guard let page, page != step else { return next }
    let viaPrimary = (step == .checkup && (page == .intent || page == .compare)) || (step == .intent && page == .upload)
      || (step == .compare && page == .modify)
    return NextStep(
      id: "go-\(page.rawValue)-\(next.id)", hint: "去「\(page.title)」页，\(next.hint)",
      target: viaPrimary ? "primary" : "nav-\(page.rawValue)",
      title: "去「\(page.title)」", body: "下一步在「\(page.title)」页：\(next.hint)。", help: .go(page)
    )
  }

  /// The next step and the page it happens on; a nil page means it can be shown anywhere.
  private func rawNextStep() -> (Step?, NextStep)? {
    if isVoiceAgent { return voiceRawNextStep() }
    switch stage {
    case .converting, .launching:
      return (nil, NextStep(id: "launching", hint: "正在打开 Chrome，稍等", title: "正在打开 Chrome", waiting: true))
    case .rename:
      return (.upload, NextStep(id: "rename", hint: "探迹里已有同名话术：改它、接着传或换个名字", target: "rename", title: "同名话术",
                                body: "想改探迹里那套就点“改这套话术”；是上次没传完的就点“接着传到…”；是别的话术，就改个名字点“用新名字继续”。"))
    case .login:
      let page: Step = switch modifyTask { case .compare: .compare; case .modify: .modify; case nil: .upload }
      return (page, NextStep(id: "login", hint: "在 Chrome 里登录探迹，再回来确认", target: "login", title: "登录探迹",
                             body: "在 Chrome 中登录探迹后，返回 App 确认登录。"))
    case .comparing:
      return (nil, NextStep(id: "comparing", hint: "正在读取探迹里的话术，只读不改", title: "正在读取",
                            body: "读完会列出要改的地方，改之前的内容先备份。", waiting: true))
    case .flow, .vague, .knowledge, .intent, .review:
      if modifyTask == .modify {
        return (nil, NextStep(id: "modifying", hint: "正在修改，不用操作，改完会告诉你", title: "交给我就行",
                              body: "只改勾选的地方。想停随时点右上角“停止”，下次接着改。", waiting: true))
      }
      return (nil, NextStep(id: "uploading", hint: "正在上传，不用操作，传完会告诉你", title: "交给我就行",
                            body: "可以去忙别的，传完这里会显示结果。想停随时点右上角“停止”。", waiting: true))
    default: break
    }
    if isModify { return modifyNextStep() }
    if let checkpoint, stage == .error || stage == .cancelled || error == nil, summary?.canUpload == true, canRun {
      let done = checkpoint.doneAudioNumbers.count
      return (.upload, NextStep(id: "resume", hint: "上次传到一半，点“接着传”", target: "resume", title: "接着上次传",
                                body: [error.map { "\($0.message)\($0.suggestion)" }, "已完成的 \(done) 条会自动跳过；想从头来就点“重新开始”。"]
                                  .compactMap { $0 }.joined(separator: "\n"),
                                help: .resumeUpload))
    }
    if let error {
      return (nil, NextStep(id: "error-\(error.code)", hint: error.suggestion, target: "error", title: "先处理这个问题",
                            body: "\(error.message)\(error.suggestion)"))
    }
    if checking {
      return (nil, NextStep(id: "checking", hint: "正在检查，稍等几秒", title: "正在检查", waiting: true))
    }
    if stage == .completed {
      return (.upload, NextStep(id: "done", hint: config.submitReview ? "去探迹看看审核结果" : "去探迹检查一遍，没问题再提交审核",
                                title: "传完了", body: config.submitReview ? "已经提交审核，结果在探迹里查看。" : "在探迹里打开这套话术检查一遍，确认无误后再提交审核。"))
    }
    if config.workbookPath.isEmpty {
      return (.importFiles, NextStep(id: "workbook", hint: "把话术表格拖进来", target: "well-workbook", title: "导入话术表格",
                                     body: "把 Excel 话术表拖到这里，或者点“帮我选取”。还没有表格，就先点“下载模板”；不会填就点旁边的“怎么填？”。", help: .chooseWorkbook))
    }
    if config.audioDir.isEmpty {
      return (.importFiles, NextStep(id: "audio", hint: "把录音文件夹拖进来", target: "well-audio", title: "导入录音文件夹",
                                     body: "录音会听内容自动对应表格，文件名怎么起都行。", help: .chooseAudio))
    }
    if config.talkName.isEmpty {
      return (.importFiles, NextStep(id: "talkName", hint: "起个话术名称", target: "field-talkName", title: "起个话术名称",
                                     body: "就是探迹里显示的名字，最多 19 个字。", help: .focusTalkName))
    }
    if config.categoryName.isEmpty {
      return (.importFiles, NextStep(id: "category", hint: "填一个知识库分类", target: "field-category", title: "填知识库分类",
                                     body: "所有问答都放进这个分类，最多 9 个字。", help: .focusCategory))
    }
    guard let summary else {
      return (step == .checkup ? .checkup : .importFiles,
              NextStep(id: "check", hint: "点右上角“检查数据”", target: "primary", title: "检查数据",
                       body: "我会检查表格格式，再给录音配对，大概几秒钟。", help: .runCheck))
    }
    if !summary.canUpload {
      let first = summary.issues.first { $0.severity == "error" }
      return (.checkup, NextStep(id: "errors", hint: "改好 Excel 里的 \(summary.errorCount) 处错误，再重新检查", target: "row-issue-0",
                                 title: "先改这处错误",
                                 body: [first?.message, first?.suggestion, "改好保存后，点右上角“重新检查”。"].compactMap { $0 }.joined(),
                                 help: .openWorkbook))
    }
    if pendingMatches > 0 {
      return (.checkup, NextStep(id: "review", hint: "确认 \(pendingMatches) 条没把握的录音", target: "primary", title: "确认录音",
                                 body: "这几条是按语音内容猜的，逐条听一下，选对的那个。", help: .openReview))
    }
    let fixable = checkupCounts.fixable
    if fixable > 0, !coachSkipped.contains("fix"), !passed(.checkup) {
      return (.checkup, NextStep(id: "fix", hint: "有 \(fixable) 处可以一键修好", target: "row-fix", title: "一键修正",
                                 body: "修好的表格另存一份，原文件不动。不修也能上传。", optional: true, help: .openCheckup))
    }
    let phrases = phraseCounts.few
    if phrases > 0, !coachSkipped.contains("phrases"), !passed(.checkup) {
      return (.checkup, NextStep(id: "phrases", hint: "\(phrases) 个问题问法太少，让 AI 帮你补", target: "row-phrases", title: "补问法",
                                 body: "问法太少，客户换个说法机器人就可能识别不到。AI 会按你的业务写几条，勾选后另存一份。不补也能上传。",
                                 optional: true, help: .openPhrases))
    }
    if summary.knowledgeCount > 0 {
      if intentLoading {
        return (nil, NextStep(id: "intent-loading", hint: "正在分析意向，稍等", title: "正在分析意向", waiting: true))
      }
      if intentError != nil, !passed(.intent) {
        return (.intent, NextStep(id: "intent-error", hint: "意向建议没生成，重新分析一次", title: "重新分析意向", help: .retryIntent))
      }
      if intentResult == nil, !passed(.intent) {
        return (.intent, NextStep(id: "intent-open", hint: "看看意向建议", title: "看看意向建议",
                                  body: "按知识库里的问题建议新增哪些意向。不需要也可以直接上传。", optional: true, help: .go(.intent)))
      }
      if let intentResult, !intentResult.setups.isEmpty, scheduledIntents == nil, !coachSkipped.contains("schedule"), !passed(.intent) {
        return (.intent, NextStep(id: "schedule", hint: "决定要不要上传时自动设置意向", target: "schedule", title: "上传时自动设置",
                                  body: "确认后，传完会顺手新建这 \(intentResult.setups.count) 条意向，默认的 5 条不动。也可以复制建议自己配。",
                                  optional: true, help: .schedule))
      }
    }
    return (.upload, NextStep(id: "upload", hint: "点右上角“开始上传”", target: "primary", title: "开始上传",
                              body: "会打开 Chrome，登录后就全自动了。", help: .startUpload))
  }

  private func modifyNextStep() -> (Step?, NextStep)? {
    if let error {
      return (nil, NextStep(id: "error-\(error.code)", hint: error.suggestion, target: "error", title: "先处理这个问题",
                            body: "\(error.message)\(error.suggestion)"))
    }
    if checking {
      return (nil, NextStep(id: "checking", hint: "正在检查，稍等几秒", title: "正在检查", waiting: true))
    }
    if stage == .completed, modifyMessage != nil {
      return (.modify, NextStep(id: "modify-done", hint: config.submitReview ? "去探迹看看审核结果" : "去探迹检查一遍，没问题再提交审核",
                                title: "改好了", body: "想确认改没改对，点右上角“再对比一次”。"))
    }
    if config.workbookPath.isEmpty {
      return (.importFiles, NextStep(id: "workbook", hint: "把改好的话术表格拖进来", target: "well-workbook", title: "导入改好的表格",
                                     body: "就是上传时用的那份表格，改好内容再拖进来。", help: .chooseWorkbook))
    }
    if config.audioDir.isEmpty {
      return (.importFiles, NextStep(id: "audio", hint: "把要换的录音拖进来", target: "well-audio", title: "导入要换的录音",
                                     body: "只放改过的录音，名字随意，我会听内容配对。", help: .chooseAudio))
    }
    if config.talkName.isEmpty {
      return (.importFiles, NextStep(id: "talkName", hint: "填上要修改的话术名称", target: "field-talkName", title: "要修改的话术",
                                     body: "和探迹里的名字一模一样。", help: .focusTalkName))
    }
    guard let summary else {
      return (step == .checkup ? .checkup : .importFiles,
              NextStep(id: "check", hint: "点右上角“检查数据”", target: "primary", title: "检查数据",
                       body: "先检查表格，再听一遍新录音，大概几秒钟。", help: .runCheck))
    }
    if !summary.canUpload {
      let first = summary.issues.first { $0.severity == "error" }
      return (.checkup, NextStep(id: "errors", hint: "改好 Excel 里的 \(summary.errorCount) 处错误，再重新检查", target: "row-issue-0",
                                 title: "先改这处错误",
                                 body: [first?.message, first?.suggestion, "改好保存后，点右上角“重新检查”。"].compactMap { $0 }.joined(),
                                 help: .openWorkbook))
    }
    if pendingMatches > 0 {
      return (.checkup, NextStep(id: "review", hint: "确认 \(pendingMatches) 条没把握的录音", target: "primary", title: "确认录音",
                                 body: "这几条是按语音内容猜的，逐条听一下，选对的那个。", help: .openReview))
    }
    guard let modifyPlan else {
      return (.compare, NextStep(id: "compare", hint: "点右上角“开始对比”", target: "primary", title: "开始对比",
                                 body: "会打开 Chrome 读取探迹里的这套话术，只读不改。", help: .startCompare))
    }
    if selectedItems.isEmpty {
      let selectable = modifyPlan.items.contains(where: \.selectable)
      return (.compare, NextStep(id: selectable ? "tick" : "same", hint: selectable ? "勾选要改的地方" : "线上和表格一致，不用改",
                                 title: selectable ? "勾选要改的地方" : "不用改",
                                 body: selectable ? "只会改勾选的地方，没勾的保持原样。" : "表格里的内容和探迹里一样。"))
    }
    return (.modify, NextStep(id: "modify", hint: "点右上角“开始修改”", target: "primary", title: "开始修改",
                              body: "只改勾选的地方，改之前的内容已经备份。", help: .startModify))
  }

  private func voiceRawNextStep() -> (Step?, NextStep)? {
    switch stage {
    case .launching, .quota, .creating, .generating, .personalize, .attach, .intent:
      return (nil, NextStep(id: "voice-run", hint: stage.title, title: stage.title, waiting: true))
    case .login:
      return (.upload, NextStep(id: "login", hint: "在 Chrome 里登录探迹，不要切换企业", target: "login", title: "登录探迹",
                                body: "登录后停在当前企业，回到这里点确认。"))
    case .entry:
      return (.upload, NextStep(id: "entry", hint: "选择要进入的探迹语音Agent", title: "选择入口",
                                body: "出现两个时必须由你指定。"))
    case .paste:
      return (.upload, NextStep(id: "paste", hint: "复制后台提示词，粘贴后再继续", title: "复制提示词",
                                body: "第一版不自动打开后台页。"))
    default: break
    }
    if voiceConfig.packPath.isEmpty {
      return (.importFiles, NextStep(id: "pack", hint: "导入 skill 交付包文件夹或 zip", title: "导入交付包",
                                     body: "材料由外部模型生成，软件只核对结构并上传。"))
    }
    if voicePreview == nil {
      return (.importFiles, NextStep(id: "voice-check", hint: "点右上角“核对交付包”", target: "primary", title: "核对交付包"))
    }
    if voicePreview?.canUpload != true {
      return (.packReview, NextStep(id: "voice-fix", hint: "按列出的缺项改交付包后再核对", title: "交付包不合格"))
    }
    if passed(.upload) { return nil }
    return (.upload, NextStep(id: "voice-start", hint: "点右上角“开始上传”", target: "primary", title: "开始上传",
                              body: "不切换企业。未使用额度为 0 会停下来。"))
  }

  /// Optional steps never pull the user back to a page they have already moved past.
  private func passed(_ page: Step) -> Bool {
    (steps.firstIndex(of: step) ?? 0) > (steps.firstIndex(of: page) ?? 0)
  }

  func perform(_ action: CoachAction) {
    switch action {
    case .chooseWorkbook: chooseWorkbook()
    case .chooseAudio: chooseAudioDir()
    case .focusTalkName: focusRequest = "talkName"
    case .focusCategory: focusRequest = "category"
    case .runCheck: Task { await runCheck() }
    case .openReview: matchMode = .review
    case .openCheckup: openCheckup()
    case .openPhrases: openCheckup("few")
    case .openWorkbook: NSWorkspace.shared.open(URL(fileURLWithPath: config.workbookPath))
    case .schedule: intentConfirming = true
    case .retryIntent:
      intentError = nil
      Task { await analyzeIntents() }
    case .startUpload: Task { await startUpload() }
    case .resumeUpload: Task { await startUpload(resume: true) }
    case .startCompare: Task { await startCompare() }
    case .startModify: Task { await startModify() }
    case .go(let page): step = page
    }
  }
}

/// "下一步：…  指给我看" under the page title.
struct NextStepLine: View {
  @Environment(AppModel.self) private var model
  @State private var idle = false

  var body: some View {
    if let next = model.nextStep {
      HStack(spacing: 8) {
        if next.waiting { ProgressView().controlSize(.small) }
        Text("下一步").fontWeight(.semibold).foregroundStyle(Color.accentColor)
        Text(next.hint)
        if next.optional { Text("可以跳过").font(.caption).foregroundStyle(.secondary) }
        if !next.waiting {
          Button { Tour.shared.guide(next) } label: {
            Label("指给我看", systemImage: "scope").symbolEffect(.pulse, isActive: idle)
          }
          .controlSize(.small)
          .padding(.leading, 2)
          .tourTarget("nextStepButton")
        }
      }
      .font(.callout)
      .padding(.top, 6)
      .task(id: next.id) {
        idle = false
        try? await Task.sleep(for: .seconds(20))
        guard !Task.isCancelled else { return }
        idle = true
      }
    }
  }
}
