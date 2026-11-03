import SwiftUI
import UniformTypeIdentifiers

struct VoiceImportView: View {
  @Environment(AppModel.self) private var model

  static func mood(_ model: AppModel) -> AmbientLight.Mood {
    model.error != nil ? .error : .calm
  }

  var body: some View {
    Page {
      PageHeader(title: title, subtitle: subtitle)
      Banners()
      HStack(alignment: .top, spacing: 14) {
        FileDrop(
          path: model.voiceConfig.packPath, type: .zip, title: "交付包",
          hint: "skill 产出的文件夹或 zip",
          detail: "确认卡、知识库、热词、意图、后台 JSON",
          choose: model.choosePack
        ) {
          Button("下载示例包") { Task { await model.saveVoiceSample() } }
        } trailing: { EmptyView() }
        Panel(title: "包内应有") {
          ForEach(Array(Self.required.enumerated()), id: \.offset) { index, item in
            PanelRow(divider: index < Self.required.count - 1) {
              Text(item.file)
            } trailing: {
              Text(item.note).foregroundStyle(.secondary)
            }
          }
        }
      }
      .fixedSize(horizontal: false, vertical: true)
      .disabled(model.busy)
    }
  }

  private static let required: [(file: String, note: String)] = [
    ("确认卡.md", "风格和钩子"),
    ("00-智能体配置.md", "名称、角色、场景"),
    ("01-知识库/", "事实材料"),
    ("02-热词.txt", "一行一个"),
    ("03-意图.json", "必改五项"),
    ("04-后台提示词.json", "上传后粘贴"),
  ]

  private var title: String {
    model.voiceConfig.packPath.isEmpty ? "导入语音 Agent 交付包" : "交付包已选好"
  }

  private var subtitle: String {
    if model.voiceConfig.packPath.isEmpty {
      return "外部模型按 skill 生成材料。这里只导入、核对、上传，不跑本地大模型，也不切换企业。"
    }
    return "点右上角“核对交付包”，缺文件会停下来告诉你。"
  }
}

struct VoicePreviewView: View {
  @Environment(AppModel.self) private var model

  static func mood(_ preview: VoiceAgentPreview) -> AmbientLight.Mood {
    preview.canUpload ? .calm : .error
  }

  var body: some View {
    if let preview = model.voicePreview {
      Page {
        PageHeader(
          title: preview.canUpload ? "交付包可以上传" : "还有 \(preview.errorCount) 处要先改",
          subtitle: preview.canUpload
            ? "名称、角色、场景可以改。知识库和意图口径仍需你自己扫一眼。"
            : "缺什么列在下面。改 skill 交付包后再核对。",
          caption: model.subtitle
        )
        Banners()
        if let pack = preview.pack { summary(pack) }
        if !preview.issues.isEmpty { issues(preview) }
      }
    } else {
      Page {
        PageHeader(title: model.checking ? "正在核对…" : "还没有核对",
                   subtitle: model.checking ? "在检查文件是否齐、热词字数和意图字段。" : "导入交付包后点右上角“核对交付包”。")
        Banners()
      }
    }
  }

  private func summary(_ pack: VoiceAgentPack) -> some View {
    VStack(alignment: .leading, spacing: 28) {
      Panel(title: "智能体") {
        field("智能体名称", \.name, limit: 20)
        field("对外名称", \.companyName, limit: 30)
        field("自称", \.selfName, limit: 20, prompt: "可选")
        choices("角色", \.role, ["业务顾问", "语音助手", "客户顾问", "其他"])
        if pack.agent.role == "其他" || pack.agent.role.contains("其他") {
          field("自定义角色", \.customRole, limit: 20)
        }
        choices("场景", \.scene, ["新客开发", "线索回访"])
        choices("目标", \.goal, ["上门演示", "线上演示", "添加微信"], divider: false)
      }
      .disabled(model.busy)
      Panel(title: "交付内容") {
        row("知识库", "\(pack.knowledgeFiles.count) 份")
        row("热词", "\(pack.hotwordCount) 个")
        row("必改意图", pack.intentUpdates.joined(separator: "、"), divider: pack.intentCreates.isEmpty)
        if !pack.intentCreates.isEmpty {
          row("新建意图", pack.intentCreates.joined(separator: "、"), divider: false)
        }
      }
    }
  }

  private func field(_ title: String, _ key: WritableKeyPath<VoiceAgentFields, String>, limit: Int, prompt: String = "必填", divider: Bool = true) -> some View {
    let value = model.voicePreview?.pack?.agent[keyPath: key] ?? ""
    return PanelRow(divider: divider) {
      Text(title).frame(width: 90, alignment: .leading).foregroundStyle(.secondary)
      TextField(title, text: binding(key, limit: limit), prompt: Text(prompt))
        .textFieldStyle(.plain)
        .labelsHidden()
    } trailing: {
      Text("\(value.count)/\(limit)")
        .font(.callout.monospacedDigit())
        .foregroundStyle(value.count >= limit ? AnyShapeStyle(.orange) : AnyShapeStyle(.tertiary))
    }
  }

  private func choices(_ title: String, _ key: WritableKeyPath<VoiceAgentFields, String>, _ options: [String], divider: Bool = true) -> some View {
    let selected = model.voicePreview?.pack?.agent[keyPath: key] ?? ""
    return PanelRow(divider: divider) {
      Text(title).frame(width: 90, alignment: .leading).foregroundStyle(.secondary)
      Flow(spacing: 8) {
        ForEach(options, id: \.self) { option in
          Pill(title: option, selected: selected == option) {
            model.updateVoiceAgent { $0[keyPath: key] = option }
          }
        }
      }
    }
  }

  private func binding(_ key: WritableKeyPath<VoiceAgentFields, String>, limit: Int) -> Binding<String> {
    Binding(
      get: { model.voicePreview?.pack?.agent[keyPath: key] ?? "" },
      set: { value in model.updateVoiceAgent { $0[keyPath: key] = String(value.prefix(limit)) } }
    )
  }

  private func issues(_ preview: VoiceAgentPreview) -> some View {
    Panel(title: "不合格") {
      ForEach(Array(preview.issues.enumerated()), id: \.offset) { index, issue in
        PanelRow(divider: index < preview.issues.count - 1) {
          VStack(alignment: .leading, spacing: 4) {
            Text(issue.message)
            Text(issue.suggestion).font(.callout).foregroundStyle(.secondary)
          }
        }
      }
    }
  }

  private func row(_ title: String, _ value: String, divider: Bool = true) -> some View {
    PanelRow(divider: divider) {
      Text(title).frame(width: 90, alignment: .leading).foregroundStyle(.secondary)
      Text(value.isEmpty ? "—" : value)
        .lineLimit(3)
        .truncationMode(.tail)
    }
  }
}

struct VoiceUploadView: View {
  @Environment(AppModel.self) private var model

  static func mood(_ model: AppModel) -> AmbientLight.Mood {
    switch model.stage {
    case .completed: .done
    case .error: .error
    case .login, .entry, .paste: .attention
    default: .calm
    }
  }

  var body: some View {
    Page {
      PageHeader(title: title, subtitle: subtitle, caption: caption)
      Banners()
      if model.stage == .login { LoginCard() }
      if model.stage == .entry { entryCard }
      if model.stage == .paste { pasteCard }
      if let pack = model.voicePreview?.pack, model.voicePreview?.canUpload == true {
        Panel(title: "将要创建") {
          PanelRow {
            Text("智能体").foregroundStyle(.secondary)
            Text(pack.agent.name)
          }
          PanelRow {
            Text("企业").foregroundStyle(.secondary)
            Text(pack.agent.companyName)
          }
          PanelRow(divider: false) {
            Text("登录").foregroundStyle(.secondary)
            Text("不切换企业，停在当前账号")
          }
        }
      }
      if !model.logs.isEmpty, !model.showInspector { PageLog() }
    }
    .animation(.smooth, value: model.stage)
  }

  private var title: String {
    switch model.stage {
    case .launching, .quota, .creating: return "正在准备"
    case .login: return "请在 Chrome 里登录探迹"
    case .entry: return "找到多个探迹语音Agent"
    case .generating: return "智能体生成中"
    case .personalize: return "正在传知识库和热词"
    case .attach: return "正在挂到编辑页"
    case .intent: return "正在改意图"
    case .paste: return "复制后台提示词"
    case .completed: return "创建完成"
    case .error: return "没有完成"
    case .cancelled: return "已经停下"
    default:
      if model.voicePreview?.canUpload != true { return "还不能上传" }
      return "准备好了"
    }
  }

  private var subtitle: String {
    let last = model.logs.last?.message
    switch model.stage {
    case .login: return "登录后不要切换企业。回到这里点确认。"
    case .entry: return "选你要配置的那一个，软件不会替你挑。"
    case .generating: return last ?? "大约 1–2 分钟，请勿关闭 Chrome 页面。"
    case .paste: return "后台不在语音 Agent 页里。复制 JSON，自己去后台粘贴，再点继续。"
    case .completed: return model.voiceMessage ?? "智能体已创建。后台提示词如未粘贴，请自行补上。"
    case .error: return model.error?.message ?? "中途出了点问题。"
    case .cancelled: return "已停在当前步骤，探迹里已创建的内容不会删除。"
    default:
      if model.voiceUploading { return last ?? "正在上传。" }
      if model.voicePreview?.canUpload != true { return "先在核对页过完结构校验。" }
      return "点右上角开始后，会打开 Chrome。音色选第一项，通话时长 3 分钟，不上传录音。"
    }
  }

  private var caption: String? {
    guard model.voiceUploading else { return nil }
    return model.stage.title
  }

  private var entryCard: some View {
    Soft(padding: 18) {
      VStack(alignment: .leading, spacing: 12) {
        Text("选择要进入的探迹语音Agent").fontWeight(.medium)
        Text("出现两个时必须由你指定，软件不会默认进第一个。").font(.callout).foregroundStyle(.secondary)
        HStack {
          ForEach(model.voiceEntries) { entry in
            Button(entry.label) { model.pickVoiceEntry(entry.index) }.prominentGlass()
          }
          if model.voiceEntries.isEmpty {
            Text("正在读取入口…").foregroundStyle(.secondary)
          }
        }
      }
    }
  }

  private var pasteCard: some View {
    Soft(padding: 18) {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Image(systemName: "doc.on.clipboard").font(.system(size: 22)).foregroundStyle(Color.accentColor)
          VStack(alignment: .leading, spacing: 3) {
            Text("复制 04-后台提示词.json").fontWeight(.medium)
            Text("第一版不自动打开后台页。").font(.callout).foregroundStyle(.secondary)
          }
          Spacer()
          Button("复制") { model.copyVoicePrompt() }
          Button("粘贴好了，继续") { Task { await model.confirmVoicePaste() } }.prominentGlass()
        }
        if let json = model.voicePreview?.pack?.promptJson, !json.isEmpty {
          ScrollView {
            Text(json)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .frame(maxHeight: 220)
        }
      }
    }
  }
}
