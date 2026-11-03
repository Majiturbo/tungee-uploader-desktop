import type { IntentSignal } from "../shared/intent-plan";

interface ReferenceEntry {
  signal: IntentSignal;
  alternative?: IntentSignal;
}

const STANDARD_QUESTIONS: Record<string, ReferenceEntry> = {
  "公司(做/卖)什么": { signal: "other" },
  公司叫什么: { signal: "other" },
  公司官网是什么: { signal: "other" },
  公司地址在哪: { signal: "other" },
  位置远: { signal: "objection" },
  "优势/亮点": { signal: "consult" },
  "合作过的企业/案例": { signal: "consult" },
  "给我发资料/短信/邮件": { signal: "action" },
  "便宜一点/太贵了/优惠": { signal: "objection" },
  价格介绍: { signal: "price" },
  "怎么合作/流程": { signal: "consult", alternative: "price" },
  怎么合作: { signal: "consult", alternative: "price" },
  "面谈/上门": { signal: "action" },
  面谈: { signal: "action" },
  "产品演示/效果展示": { signal: "action" },
  "产品演示/试用": { signal: "action" },
  "你是谁/什么事": { signal: "other" },
  你怎么知道我电话的: { signal: "other" },
  不是本地号码: { signal: "other" },
  怎么是外地号码: { signal: "other" },
  "我不是老板/负责人": { signal: "other" },
  加我微信: { signal: "action" },
  微信不是手机号: { signal: "action" },
  有合作商了: { signal: "objection" },
  在忙: { signal: "objection" },
  之前你们有人联系过我了: { signal: "other" },
  "考虑一下/再说": { signal: "objection" },
  是不是机器人: { signal: "other" },
  "我打断一下/听我说完": { signal: "other" },
  "我打断一下/听我说完吗/听得到吗": { signal: "other" },
  "骂人/脏话/举报": { signal: "reject" },
  系统提示: { signal: "reject" },
  "打错/无关人员": { signal: "reject" },
  我是同行: { signal: "reject" },
  没听明白: { signal: "other" },
  "你们是骗子吗/可信吗": { signal: "other" },
  诈骗: { signal: "other" },
  拜拜: { signal: "other" },
  加我QQ: { signal: "action" },
  怎么联系你: { signal: "action" },
  你记一下这个号码: { signal: "action" },
  "不做了/不需要": { signal: "reject" },
  "预算不够/没预算": { signal: "objection" },
};

export function questionKey(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

const REFERENCE = new Map(Object.entries(STANDARD_QUESTIONS).map(([name, entry]) => [questionKey(name), entry]));

export function referenceSignal(name: string): ReferenceEntry | undefined {
  return REFERENCE.get(questionKey(name));
}

const KEYWORD_RULES: Array<[IntentSignal, RegExp]> = [
  ["reject", /不需要|不要了|打错|举报|骂|同行|别打了|别再打/],
  ["objection", /便宜|太贵|优惠|折扣|打折|考虑|在忙|合作商|供应商|已经有|顾问|法务|找好了|预算|没钱|太远/],
  ["price", /多少钱|价格|收费|费用|报价|怎么算钱|价位/],
  ["action", /微信|qq|联系方式|号码|资料|发我|面谈|见面|上门|演示|试用|邮件|短信/i],
];

export function keywordSignal(name: string, phrases: string[]): IntentSignal {
  const text = [name, ...phrases].join(" ");
  for (const [signal, pattern] of KEYWORD_RULES) {
    if (pattern.test(text)) return signal;
  }
  return "consult";
}
