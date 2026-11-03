export type IntentSignal = "action" | "price" | "consult" | "objection" | "reject" | "other";
export type IntentSource = "reference" | "model" | "keyword" | "user";
export type IntentCardId = "action" | "price" | "consult" | "objection";

export const INTENT_SIGNALS: readonly IntentSignal[] = ["action", "price", "consult", "objection", "reject", "other"];

export const SIGNAL_LABELS: Record<IntentSignal, string> = {
  action: "明确行动",
  price: "主动询价",
  consult: "业务咨询",
  objection: "暂缓或异议",
  reject: "明确拒绝",
  other: "身份确认或零散信息",
};

export interface IntentQuestion {
  name: string;
  phrases: string[];
  signal: IntentSignal;
  source: IntentSource;
  alternative?: IntentSignal;
}

export interface IntentAnalysis {
  flowCount: number;
  vagueCount: number;
  knowledgeCount: number;
  questions: IntentQuestion[];
  modelUsed: boolean;
  modelUnavailable?: string;
}

export interface IntentCondition {
  type: string;
  operator?: string;
  values: string[];
}

export interface IntentCard {
  id: IntentCardId;
  level: "A级" | "B级" | "C级";
  description: string;
  when: string;
  match: "所有" | "任意";
  conditions: IntentCondition[];
  directTrigger: boolean;
  order: string;
  confirms: string[];
  questions: string[];
}

export type IntentPlacement = "before-main-affirm" | "end";

export interface IntentSetup {
  level: IntentCard["level"];
  description: string;
  match: IntentCard["match"];
  questions: string[];
  placement: IntentPlacement;
}

export const INTENT_DESCRIPTION_MAX = 19;
export const MAIN_AFFIRM_INTENT = "主流程命中肯定";

export interface IntentSkipped {
  name: string;
  reason: string;
}

export interface IntentPlan {
  cards: IntentCard[];
  skipped: IntentSkipped[];
  confirms: string[];
}

const DEFAULT_INTENTS = [
  "D级｜无意向",
  "A级｜同意邀约",
  "B级｜主流程命中肯定",
  "C级｜在忙/考虑",
  "C级｜通话时长>40秒且对话轮次>2",
];
const COVERED_BY_DEFAULT_C = /在忙|考虑|再说/;
const MIN_CONSULT_QUESTIONS = 2;

const ACTION_TAGS: Array<[string, RegExp]> = [
  ["联系方式", /微信|QQ|qq|号码|联系|电话|加我|记一下/],
  ["资料", /资料|短信|邮件|邮箱|发我|介绍发|官网发/],
  ["面谈", /面谈|见面|上门|拜访|来我公司|线下/],
  ["演示", /演示|试用|效果展示|体验/],
];
const OBJECTION_TAGS: Array<[string, RegExp]> = [
  ["价格异议", /便宜|太贵|优惠|折扣|打折|最低/],
  ["已有合作", /合作商|供应商|已经有|已经和|顾问|别人合作|其他家/],
  ["没预算", /预算|没钱|钱不多|没费用/],
];

function tagsFor(questions: IntentQuestion[], table: Array<[string, RegExp]>): string[] {
  const text = questions.map((question) => [question.name, ...question.phrases].join(" ")).join(" ");
  return table.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

const quote = (text: string) => `「${text}」`;

function questionConfirm(question: IntentQuestion): string | null {
  if (question.source === "user") return null;
  if (question.source === "keyword") return `${quote(question.name)}是按关键词粗分的${SIGNAL_LABELS[question.signal]}，请确认。`;
  if (!question.alternative) return null;
  const judged = question.source === "model" ? "本地 AI 判为" : "按";
  return `${quote(question.name)}${judged}${SIGNAL_LABELS[question.signal]}，也可能算${SIGNAL_LABELS[question.alternative]}。`;
}

export function needsConfirm(question: IntentQuestion): boolean {
  return questionConfirm(question) !== null;
}

export function buildIntentPlan(questions: IntentQuestion[]): IntentPlan {
  const bySignal = (signal: IntentSignal) => questions.filter((question) => question.signal === signal);
  const cards: IntentCard[] = [];
  const skipped: IntentSkipped[] = [];
  const confirmsOf = (items: IntentQuestion[]) => items.map(questionConfirm).filter((item): item is string => item !== null);
  const nameCondition = (items: IntentQuestion[]): IntentCondition[] => [
    { type: "命中特定问题名称", values: items.map((question) => question.name) },
  ];

  const action = bySignal("action");
  if (action.length) {
    const tags = tagsFor(action, ACTION_TAGS);
    cards.push({
      id: "action",
      level: "A级",
      description: tags.length ? `要${tags.join("/")}` : "明确下一步",
      when: "客户明确要求加联系方式、发资料、面谈或看演示，已经进入下一步行动。",
      match: "所有",
      conditions: nameCondition(action),
      directTrigger: true,
      order: "放在默认「A级｜同意邀约」之后。",
      confirms: confirmsOf(action),
      questions: action.map((question) => question.name),
    });
  }

  const price = bySignal("price");
  if (price.length) {
    const actionCard = cards.find((card) => card.id === "action");
    cards.push({
      id: "price",
      level: "A级",
      description: "主动询价",
      when: "客户主动问价格、收费或报价，已经进入商业决策；嫌贵、要优惠不算在这里。",
      match: "所有",
      conditions: nameCondition(price),
      directTrigger: true,
      order: actionCard
        ? `放在「A级｜${actionCard.description}」之后、默认「B级｜主流程命中肯定」之前。`
        : "放在默认「A级｜同意邀约」之后、默认「B级｜主流程命中肯定」之前。",
      confirms: ["你们是否把主动询价算作 A 级；如果只把加微信、面谈算 A 级，这条改成 B 级。", ...confirmsOf(price)],
      questions: price.map((question) => question.name),
    });
  }

  const consult = bySignal("consult");
  if (consult.length >= MIN_CONSULT_QUESTIONS) {
    cards.push({
      id: "consult",
      level: "B级",
      description: "业务咨询/合作评估",
      when: "客户在了解服务内容、优势、案例、流程或专业能力，但还没有询价或提出下一步。",
      match: "所有",
      conditions: nameCondition(consult),
      directTrigger: false,
      order: "放在所有 A 级之后、默认「B级｜主流程命中肯定」之前。",
      confirms: ["如果你们只统计主流程里的业务咨询，就不新增这条；知识库里的咨询也要计入 B 级，就保留。", ...confirmsOf(consult)],
      questions: consult.map((question) => question.name),
    });
  } else {
    for (const question of consult) skipped.push({ name: question.name, reason: "只有这一个业务咨询问题，不单独建意向" });
  }

  const objection = bySignal("objection");
  const covered = objection.filter((question) => COVERED_BY_DEFAULT_C.test(question.name));
  const extraObjection = objection.filter((question) => !COVERED_BY_DEFAULT_C.test(question.name));
  for (const question of covered) skipped.push({ name: question.name, reason: "默认「C级｜在忙/考虑」已覆盖" });
  if (extraObjection.length) {
    const tags = tagsFor(extraObjection, OBJECTION_TAGS);
    cards.push({
      id: "objection",
      level: "C级",
      description: tags.length ? tags.join("/") : "暂缓/异议",
      when: "客户没有拒绝，但嫌贵、要优惠、已有合作方或暂时没预算。",
      match: "所有",
      conditions: nameCondition(extraObjection),
      directTrigger: true,
      order: "放在默认 C 级之后。",
      confirms: confirmsOf(extraObjection),
      questions: extraObjection.map((question) => question.name),
    });
  }

  for (const question of bySignal("reject")) skipped.push({ name: question.name, reason: "明确拒绝或无效通话，默认 D 级处理" });
  for (const question of bySignal("other")) skipped.push({ name: question.name, reason: "身份确认或零散信息" });

  const confirms = [...new Set(cards.flatMap((card) => card.confirms))];
  const skippedConfirms = questions
    .filter((question) => !cards.some((card) => card.questions.includes(question.name)))
    .map(questionConfirm)
    .filter((item): item is string => item !== null);
  return { cards, skipped, confirms: [...new Set([...confirms, ...skippedConfirms])] };
}

export function cardTitle(card: Pick<IntentCard, "level" | "description">): string {
  return `${card.level}｜${card.description}`;
}

export function intentSetups(plan: IntentPlan): IntentSetup[] {
  return plan.cards.map((card) => ({
    level: card.level,
    description: [...card.description].slice(0, INTENT_DESCRIPTION_MAX).join(""),
    match: card.match,
    questions: [...card.questions],
    placement: card.id === "objection" ? "end" : "before-main-affirm",
  }));
}

export function intentMarkdown(analysis: IntentAnalysis, plan: IntentPlan): string {
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);
  const usable = analysis.questions.length;

  push("# 探迹意向设置建议", "", "## 一、识别结果", "");
  push(
    `- 主流程：${analysis.flowCount} 条`,
    `- 含糊话术：${analysis.vagueCount} 条`,
    `- 知识库：${analysis.knowledgeCount} 条`,
    `- 可用于意向设置的问题：${usable} 条`,
    "- 问题分类：无",
    "- Excel 标记读取：正常",
    "",
  );

  push("## 二、先说结论", "");
  push(
    plan.cards.length
      ? `本次建议新增 ${plan.cards.length} 条意向。默认基础意向保留，不重复创建。`
      : "本次不建议新增意向，默认基础意向已经够用。",
    "",
    "只推荐会改变跟进动作、意向等级、业务阶段或业务统计的规则；普通身份确认问题继续不单独建意向。",
    "",
  );

  push("## 三、默认基础意向", "", "以下 5 条保留，不需要重新创建：", "");
  DEFAULT_INTENTS.forEach((name, index) => push(`${index + 1}. ${name}`));
  push("");

  push("## 四、建议新增", "");
  if (plan.cards.length) {
    push("> 注意：下面的“说明”只是帮助理解，不需要复制到网页。真正影响命中的是“网页设置”和“条件组”。“意向描述”只是网页显示名称，也不是条件。", "");
  } else {
    push("暂无。", "");
  }
  plan.cards.forEach((card, index) => {
    push(`### ${index + 1}. ${cardTitle(card)}`, "");
    push(`**什么时候命中：** ${card.when}`, "", "> 以上是说明，不影响命中，不需要填入网页。", "");
    push("**网页设置：**", "", "> 以下内容需要在网页中填写。", "");
    push(`- 意向等级：${card.level}`, `- 意向描述：${card.description}`, "- 参与意向率计算：是", `- 条件匹配：${card.match}`, "");
    push("**条件组：**", "", "> 以下条件才真正决定这条意向是否命中。", "");
    card.conditions.forEach((condition, conditionIndex) => {
      push(`${conditionIndex + 1}. 条件类型：${condition.type}`);
      if (condition.operator) push(`   - 运算符：${condition.operator}`);
      push(`   - 选择：${condition.values.join("、")}`);
    });
    if (card.directTrigger) push("", "这是直接触发型规则：问题名称本身已经说明客户行为，不需要再加其他条件。");
    push("", `**建议顺序：** ${card.order}`, "");
    push(`**需要确认：** ${card.confirms.length ? card.confirms.join(" ") : "无"}`, "");
  });

  push("## 五、不建议新增", "");
  push("公司名称、官网、地址、身份确认等零散信息，不单独新增意向；明确拒绝如果默认 D 级已经覆盖，也不重复创建。", "");
  if (plan.skipped.length) {
    const groups = new Map<string, string[]>();
    for (const item of plan.skipped) groups.set(item.reason, [...(groups.get(item.reason) ?? []), item.name]);
    for (const [reason, names] of groups) push(`- ${reason}：${names.join("、")}`);
    push("");
  }

  push("## 六、网页操作顺序", "");
  push(
    "1. 点击“新建意向”。",
    "2. 填写意向等级和意向描述；意向描述只是显示名称。",
    "3. 选择条件匹配“所有”或“任意”。",
    "4. 点击新增条件，逐行选择条件类型、运算符和具体值。",
    "5. 有第 3、4 条条件时继续新增条件行，不要把说明文字填进去。",
    "6. 保存后检查判断顺序。",
    "",
  );

  push("## 七、需要确认", "");
  if (plan.confirms.length) plan.confirms.forEach((item) => push(`- ${item}`));
  else push("- 无");
  push("");
  return lines.join("\n");
}
