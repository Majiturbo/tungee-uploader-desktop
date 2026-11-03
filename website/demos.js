const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANVAS_W = 660;

function countTo(el, from, to, ms) {
  if (reduced) {
    el.textContent = to;
    return;
  }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function flip(els, mutate, scale = 1, ms = 650) {
  const first = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
  mutate();
  if (reduced) return;
  els.forEach((e) => {
    const a = first.get(e);
    const b = e.getBoundingClientRect();
    const dx = (a.left - b.left) / scale;
    const dy = (a.top - b.top) / scale;
    if (dx || dy) {
      e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: ms,
        easing: "cubic-bezier(.2,.75,.2,1)",
      });
    }
  });
}

const ICONS = {
  导入: '<path d="M12 4v10m0 0-4-4m4 4 4-4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  体检: '<path d="M5 4v5a4 4 0 0 0 8 0V4"/><path d="M9 13v2a5 5 0 0 0 10 0v-2"/><circle cx="19" cy="11" r="2"/>',
  意向: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  上传: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 10a4 4 0 0 1-1 8"/><path d="M12 12v8m0-8-3 3m3-3 3 3"/>',
  对比: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  修改: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
};

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg>';
const SPARK_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>';

function shell(app) {
  const main = app.querySelector(".app-main");
  const modify = app.dataset.mode === "modify";
  const steps = modify ? ["导入", "体检", "对比", "修改"] : ["导入", "体检", "意向", "上传"];
  const side = h("aside", "app-side");
  if (modify) side.append(h("span", "side-mode", "修改已有话术"));
  steps.forEach((s) => {
    const item = h("span", "side-item", `<svg viewBox="0 0 24 24">${ICONS[s]}</svg>${s}`);
    item.dataset.step = s;
    side.append(item);
  });
  const body = h("div", "app-body");
  body.append(side, main);
  const canvas = h("div", "app-canvas");
  canvas.append(h("div", "app-bar", "<i></i><i></i><i></i>"), body);
  app.append(canvas);
  const fit = () => {
    const s = innerWidth <= 640 ? 1 : app.clientWidth / CANVAS_W;
    app.style.setProperty("--s", s);
    app.scale = s;
  };
  new ResizeObserver(fit).observe(app);
  fit();
  const setStep = (s) => side.querySelectorAll(".side-item").forEach((el) => el.classList.toggle("is-on", el.dataset.step === s));
  setStep(app.dataset.step);
  return { main, setStep, app };
}

function makeWait(app) {
  let visible = false;
  let wake = null;
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible && wake) {
        wake();
        wake = null;
      }
    },
    { threshold: 0.3 },
  ).observe(app);
  const gate = () => (visible ? Promise.resolve() : new Promise((r) => (wake = r)));
  return async (ms) => {
    if (reduced) return;
    await gate();
    await sleep(ms);
  };
}

/* ---------- 录音配对 ---------- */

const matchDemo = {
  rows: [
    { no: 1, name: "开场白", text: "您好，我是示例科技的客服小王", file: "1.wav", basis: "按编号" },
    { no: 2, name: "产品介绍", text: "这边专门给企业做工商变更的服务", file: "2.wav", basis: "按编号" },
    { no: 3, name: "客户邀约-意向邀约01", text: "我这边让负责的老师给您回个电话", file: "新录音 3.m4a", basis: "听内容 96%", listen: true },
    { no: 4, name: "客户邀约-意向邀约02", text: "我加您微信，让老师跟您详细说说", file: "新录音 7.m4a", basis: "听内容 92%", listen: true },
    { no: 18, name: "价格怎么算", text: "按年收费，基础版每年三千元", file: "价格.m4a", basis: "按文件名" },
    { no: 58, name: "公司变更/工商变更", text: "可以的，我们主要做省内企业的变更", file: "变更-重录.m4a", basis: "你已确认", unsure: true },
  ],
  build(ui) {
    ui.main.innerHTML = `
      <h4 class="m-title js-title">录音匹配</h4>
      <p class="m-sub"><span class="js-sub">已自动匹配 <b class="js-count">0</b>/58</span><span class="m-hint js-hint"></span></p>
      <div class="mlist"></div>`;
    const list = ui.main.querySelector(".mlist");
    const rows = this.rows.map((r) => {
      const el = h("div", "mrow", `<span class="mno">${r.no}</span><div class="mtext"><b>${r.name}</b><span>${r.text}</span></div><span class="mbasis"></span><span class="mfile"></span>`);
      list.append(el);
      return { el, r, basis: el.querySelector(".mbasis"), file: el.querySelector(".mfile") };
    });
    return { ...ui, rows, title: ui.main.querySelector(".js-title"), sub: ui.main.querySelector(".js-sub"), hint: ui.main.querySelector(".js-hint") };
  },
  reset(c) {
    c.sub.innerHTML = '已自动匹配 <b class="js-count">0</b>/58';
    c.count = c.sub.querySelector(".js-count");
    c.hint.textContent = "";
    c.rows.forEach(({ el, basis, file }) => {
      el.className = "mrow";
      basis.textContent = "";
      file.innerHTML = '<i class="skeleton"></i>';
    });
  },
  async play(c, wait) {
    countTo(c.count, 0, 52, 800);
    let n = 52;
    await wait(900);
    for (const row of c.rows) {
      const { el, r, basis, file } = row;
      if (r.listen) {
        el.classList.add("is-listening");
        file.innerHTML = '<span class="wave"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
        c.hint.textContent = "正在听录音内容…";
        await wait(1300);
        el.classList.remove("is-listening");
      } else if (r.unsure) {
        el.classList.add("is-unsure");
        basis.textContent = "两条录音都像这句";
        file.innerHTML = '<span class="pill warn">请你确认</span>';
        c.hint.textContent = "没把握的交给你";
        await wait(1700);
        el.classList.remove("is-unsure");
      } else {
        await wait(420);
      }
      el.classList.add("is-done");
      basis.textContent = r.basis;
      file.innerHTML = `<span class="pill">${r.file}</span>`;
      if (!r.unsure) c.count.textContent = ++n;
      c.hint.textContent = "";
    }
    await wait(500);
    c.sub.innerHTML = "58 条录音都配好了";
  },
};

/* ---------- 话术体检 ---------- */

const checkupDemo = {
  phrases: ["你们之前打过电话", "不是早就打过了", "之前有人找过我", "有没有人找过我", "不是之前联系过吗"],
  build(ui) {
    ui.main.innerHTML = `
      <h4 class="m-title">话术体检</h4>
      <p class="m-sub">29 项 · 修正会另存为新文件，原文件不变</p>
      <div class="tabs"><span>需选择 2</span><span class="on">补问法 7</span><span>QA 设置 4</span><span>自动修正 16</span></div>
      <p class="ai-line">${SPARK_SVG}<span class="js-ai"></span></p>
      <div class="q-head"><b>之前你们有人联系过我了</b><span>现有 3 条</span></div>
      <ul class="cands"></ul>
      <div class="sheet-foot"><span class="js-sel"></span><span class="fbtn js-save">另存修正版</span></div>
      <div class="toast js-toast">${CHECK_SVG}已另存并复查通过 · 原文件不变</div>`;
    const $ = (s) => ui.main.querySelector(s);
    return { ...ui, ai: $(".js-ai"), aiLine: $(".ai-line"), list: $(".cands"), sel: $(".js-sel"), save: $(".js-save"), toast: $(".js-toast") };
  },
  reset(c) {
    c.list.innerHTML = "";
    c.ai.textContent = "AI 正在写候选问法…";
    c.aiLine.classList.add("busy");
    c.sel.textContent = "已选 19 项";
    c.save.className = "fbtn js-save";
    c.toast.classList.remove("show");
  },
  async play(c, wait) {
    let sel = 19;
    await wait(700);
    for (const p of this.phrases) {
      const li = h("li", null, '<span class="cbox"></span><span class="ctext typing"></span>');
      c.list.append(li);
      const text = li.querySelector(".ctext");
      for (const ch of p) {
        text.textContent += ch;
        await wait(55);
      }
      text.classList.remove("typing");
      await wait(160);
      li.querySelector(".cbox").classList.add("on");
      c.sel.textContent = `已选 ${++sel} 项`;
      await wait(260);
    }
    c.aiLine.classList.remove("busy");
    c.ai.textContent = "AI 写完了，可以保存";
    c.save.classList.add("ready");
    await wait(900);
    c.save.classList.add("press");
    await wait(180);
    c.save.classList.remove("press");
    c.toast.classList.add("show");
    await wait(600);
  },
};

/* ---------- 意向建议 ---------- */

const intentDemo = {
  chips: [
    { t: "给我发资料", to: 0 },
    { t: "价格介绍", to: 1 },
    { t: "面谈", to: 0 },
    { t: "太贵了", to: 2 },
    { t: "加我微信", to: 0 },
    { t: "多少钱一年", to: 1 },
    { t: "已经有合作了", to: 2, unsure: true },
    { t: "你是机器人吗", to: -1 },
  ],
  build(ui) {
    ui.main.innerHTML = `
      <h4 class="m-title js-title"></h4>
      <div class="m-subrow">
        <p class="m-sub">8 个知识库问题 · 本地 AI 归类，不联网</p>
        <span class="fbtn js-auto">上传时自动设置</span>
      </div>
      <p class="pool-label js-pool-label"></p>
      <div class="pool"></div>
      <div class="icards">
        <div class="icard"><div class="icard-head"><span class="grade">A级</span>要联系方式 / 资料 / 面谈</div><div class="slot"></div></div>
        <div class="icard"><div class="icard-head"><span class="grade">A级</span>主动询价</div><div class="slot"></div></div>
        <div class="icard"><div class="icard-head"><span class="grade c">C级</span>价格异议 / 已有合作</div><div class="slot"></div></div>
      </div>`;
    const $ = (s) => ui.main.querySelector(s);
    const pool = $(".pool");
    const chips = this.chips.map((d) => {
      const el = h("span", "qchip", d.t);
      pool.append(el);
      return { el, d };
    });
    return { ...ui, pool, chips, slots: [...ui.main.querySelectorAll(".slot")], title: $(".js-title"), auto: $(".js-auto"), poolLabel: $(".js-pool-label") };
  },
  reset(c) {
    c.title.textContent = "正在读懂客户会问什么";
    c.poolLabel.textContent = "知识库问题";
    c.auto.className = "fbtn js-auto";
    c.chips.forEach(({ el }) => {
      el.className = "qchip";
      c.pool.append(el);
    });
  },
  async play(c, wait) {
    const all = c.chips.map((x) => x.el);
    await wait(800);
    for (const { el, d } of c.chips) {
      if (d.to < 0) continue;
      el.classList.add("thinking");
      await wait(420);
      flip(all, () => {
        el.classList.remove("thinking");
        if (d.unsure) el.classList.add("unsure");
        c.slots[d.to].append(el);
      }, c.app.scale);
      await wait(650);
    }
    c.poolLabel.textContent = "不建意向";
    c.title.textContent = "建议新增 3 条意向";
    await wait(700);
    c.auto.classList.add("ready");
    await wait(800);
  },
};

/* ---------- 自动上传 ---------- */

const uploadDemo = {
  groups: [
    { name: "开场白", n: 1, label: "主流程：开场白" },
    { name: "产品介绍", n: 1, label: "主流程：产品介绍" },
    { name: "客户邀约", n: 7, label: "主流程：客户邀约" },
    { name: "结束话语", n: 4, label: "主流程：结束话语" },
    { name: "含糊话术", n: 4, label: "含糊话术" },
    { name: "知识库", n: 41, label: "知识库", wide: true },
  ],
  build(ui) {
    ui.main.innerHTML = `
      <h4 class="m-title js-title"></h4>
      <p class="m-sub js-sub"></p>
      <div class="ustruct"><div class="urow"></div><div class="urow"></div></div>
      <div class="ulog"><b>运行记录</b><ul></ul></div>
      <div class="banner js-banner"><span class="banner-dot"></span><span>浏览器被关了 · 已传的 <b class="js-done">0</b> 条都记下了</span><span class="fbtn ready js-resume">接着传</span></div>`;
    const $ = (s) => ui.main.querySelector(s);
    const rows = ui.main.querySelectorAll(".urow");
    const dots = [];
    this.groups.forEach((g, gi) => {
      const blk = h("div", "ublk" + (g.wide ? " wide" : ""), `<b>${g.name}<em>${g.n}</em></b><div class="udots"></div>`);
      const wrap = blk.querySelector(".udots");
      for (let i = 0; i < g.n; i++) {
        const d = h("i", "udot");
        wrap.append(d);
        dots.push({ el: d, g, last: i === g.n - 1 });
      }
      rows[gi < 4 ? 0 : 1].append(blk);
    });
    return { ...ui, dots, title: $(".js-title"), sub: $(".js-sub"), log: $(".ulog ul"), banner: $(".js-banner"), done: $(".js-done"), resume: $(".js-resume") };
  },
  reset(c) {
    c.title.innerHTML = '准备上传 <span class="js-n">0</span>/58';
    c.n = c.title.querySelector(".js-n");
    c.sub.textContent = "转换录音格式，打开 Chrome…";
    c.log.innerHTML = "";
    c.banner.classList.remove("show");
    c.resume.classList.remove("press");
    c.dots.forEach((d) => (d.el.className = "udot"));
    c.clock = 0;
  },
  addLog(c, text) {
    const s = String(12 + Math.floor(c.clock / 60)).padStart(2, "0") + ":" + String(c.clock % 60).padStart(2, "0");
    c.clock += 7;
    c.log.append(h("li", null, `<time>10:${s}</time>${text}`));
    while (c.log.children.length > 3) c.log.firstElementChild.remove();
  },
  async play(c, wait) {
    await wait(500);
    this.addLog(c, "已启动 Chrome");
    await wait(500);
    this.addLog(c, "已登录探迹");
    c.title.firstChild.textContent = "正在上传 ";
    const cut = 34;
    for (let i = 0; i < c.dots.length; i++) {
      if (i === cut) {
        c.done.textContent = cut;
        c.banner.classList.add("show");
        c.sub.textContent = "已经停下";
        this.addLog(c, "浏览器窗口已被关闭");
        await wait(1500);
        c.resume.classList.add("press");
        await wait(180);
        c.banner.classList.remove("show");
        this.addLog(c, `接着传：跳过已完成的 ${cut} 条`);
        await wait(500);
      }
      const d = c.dots[i];
      c.sub.textContent = `${d.g.label}：正在上传录音`;
      d.el.classList.add("up");
      await wait(d.g.wide ? 70 : 150);
      d.el.classList.replace("up", "ok");
      c.n.textContent = i + 1;
      if (d.last && d.g.name !== "开场白" && d.g.name !== "产品介绍") this.addLog(c, `${d.g.label} ${d.g.n} 条已上传`);
    }
    c.title.textContent = "传完了";
    c.sub.textContent = "全部完成，话术保留为编辑中";
    this.addLog(c, "全部完成");
    await wait(600);
  },
};

/* ---------- 修改已有话术 ---------- */

const modifyDemo = {
  items: [
    { name: "开场白 1", kind: "主流程", body: "<s>您好，耽误您一分钟时间</s> → <ins>您好，想跟您简单介绍一下新服务</ins>", tag: "文字和录音" },
    { name: "价格怎么算", kind: "知识库", body: "<s>按年收费，具体看套餐</s> → <ins>按年收费，基础版每年三千元</ins>", tag: "文字和录音" },
    { name: "产品介绍 2", kind: "主流程", body: "换成录音「产品介绍-新.m4a」", tag: "只换录音" },
    { name: "售后怎么联系", kind: "知识库", body: "探迹里有，表里没有，不会删除", tag: "不处理", muted: true },
  ],
  build(ui) {
    ui.main.innerHTML = `
      <h4 class="m-title js-title"></h4>
      <p class="m-sub js-sub"></p>
      <div class="diffs"></div>`;
    const list = ui.main.querySelector(".diffs");
    const items = this.items.map((it) => {
      const el = h(
        "div",
        "diff" + (it.muted ? " muted" : ""),
        `<span class="cbox${it.muted ? " off" : ""}"></span><div><b>${it.name}<em>${it.kind}</em><span class="dtag">${it.tag}</span></b><p>${it.body}</p></div><span class="dstate"></span>`,
      );
      list.append(el);
      return { el, it, box: el.querySelector(".cbox"), state: el.querySelector(".dstate") };
    });
    return { ...ui, list, items, title: ui.main.querySelector(".js-title"), sub: ui.main.querySelector(".js-sub") };
  },
  reset(c) {
    c.setStep("对比");
    c.title.textContent = "正在和线上对比";
    c.sub.textContent = "只读不改，找出和表格不一样的地方";
    c.list.classList.add("scanning");
    c.items.forEach(({ el, box, state }) => {
      el.classList.remove("show");
      box.classList.remove("on");
      state.className = "dstate";
      state.textContent = "";
    });
  },
  async play(c, wait) {
    await wait(700);
    for (const { el } of c.items) {
      el.classList.add("show");
      await wait(650);
    }
    c.list.classList.remove("scanning");
    c.title.textContent = "改 3 处，换 3 条录音";
    c.sub.textContent = "改之前的线上内容已备份，勾选要改的";
    await wait(500);
    for (const { box, it } of c.items) {
      if (it.muted) continue;
      box.classList.add("on");
      await wait(220);
    }
    await wait(900);
    c.setStep("修改");
    c.sub.textContent = "只改勾选的这些，其他内容不动";
    let k = 0;
    for (const { it, state } of c.items) {
      if (it.muted) continue;
      c.title.textContent = `正在修改 ${++k}/3`;
      state.className = "dstate busy";
      state.textContent = "修改中";
      await wait(900);
      state.className = "dstate ok";
      state.innerHTML = `${CHECK_SVG}已改好`;
    }
    c.title.textContent = "改完了";
    c.sub.textContent = "改好了 3 处，话术保留为编辑中";
    await wait(600);
  },
};

const DEMOS = { match: matchDemo, checkup: checkupDemo, intent: intentDemo, upload: uploadDemo, modify: modifyDemo };

async function run(app) {
  const demo = DEMOS[app.dataset.demo];
  const wait = makeWait(app);
  const ctx = demo.build(shell(app));
  do {
    app.classList.add("resetting");
    demo.reset(ctx);
    void app.offsetWidth;
    app.classList.remove("resetting");
    await wait(400);
    await demo.play(ctx, wait);
    await wait(2800);
  } while (!reduced);
}

document.querySelectorAll(".app[data-demo]").forEach(run);

const heroCount = document.querySelector(".js-hero-count");
const heroBar = document.querySelector(".js-hero-bar");
if (heroCount && !reduced) {
  heroCount.textContent = "0";
  heroBar.style.width = "0%";
  setTimeout(() => {
    countTo(heroCount, 0, 57, 1600);
    heroBar.style.width = "98%";
  }, 700);
}
