"use strict";

const api = window.installer;
const root = document.getElementById("root");
const stepsList = document.getElementById("steps");
const closeButton = document.getElementById("close");
let APP_NAME = "探迹话术上传助手";
const isLite = () => Boolean(state.info?.lite);

const state = {
  info: null,
  path: "",
  check: null,
  desktop: true,
  removeData: false,
  progress: { phase: "", done: 0, total: 1 },
  error: "",
  page: "loading",
};

const icons = {
  folder:
    '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 4.2c0-.9.7-1.7 1.7-1.7h3l1.5 1.6h5.1c.9 0 1.7.7 1.7 1.7v5.9c0 .9-.7 1.7-1.7 1.7H3.2c-.9 0-1.7-.7-1.7-1.7z" fill="currentColor" opacity=".9"/></svg>',
  warn:
    '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.2v3.6M8 11.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  check:
    '<svg width="22" height="22" viewBox="0 0 30 30"><path d="M8 15.5l4.8 4.8L22.5 10" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tick: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.2 5.2l1.9 1.9L7.9 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bigWarn:
    '<svg width="22" height="22" viewBox="0 0 30 30"><path d="M15 8v9M15 21.5v.2" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
};

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const gb = (bytes) => {
  const value = Math.max(bytes, 0) / 1024 ** 3;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} GB`;
};

/** Installed before: this run upgrades that copy in place instead of asking where to install. */
const isUpdate = () => state.info?.mode === "install" && Boolean(state.info.existing);
const needed = () => state.info.required;
const shortcutPlaces = () => (state.desktop ? "桌面、开始菜单" : "开始菜单");

function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** "upgrade", "same" or "older", comparing the installer's version with the one already installed. */
function updateKind() {
  const installed = state.info.installedVersion;
  if (!installed) return "upgrade";
  const order = compareVersions(state.info.version, installed);
  return order > 0 ? "upgrade" : order === 0 ? "same" : "older";
}

function locationProblem() {
  const check = state.check;
  if (!check) return null;
  if (check.network) return { level: "error", text: "不能装在网络位置，换一个本机磁盘" };
  if (check.occupied) return { level: "error", text: "这个文件夹里有其他文件，换一个位置" };
  if (!check.writable) return { level: "error", text: "这个位置需要管理员权限，换一个位置" };
  if (check.free < needed()) return { level: "error", text: `${check.drive} 盘空间不够，还差 ${gb(needed() - check.free)}，换个位置` };
  if (/[^\x00-\x7f]/.test(state.path)) {
    return {
      level: "warn",
      text: isLite() ? "路径里有中文，语音模型可能读不了，建议换成英文路径" : "路径里有中文，AI 可能读不了模型，建议换成英文路径",
    };
  }
  if (check.running) return { level: "warn", text: `${APP_NAME}正在运行，${isUpdate() ? "升级" : "安装"}时会自动关掉` };
  return null;
}

function problemLine() {
  const problem = locationProblem();
  if (!problem) return "";
  return `<div class="meta is-${problem.level}">${icons.warn}<span>${escape(problem.text)}</span></div>`;
}

function diskCard() {
  const check = state.check;
  if (!check) return `<div class="disk"><div class="disk-head"><b>&nbsp;</b></div><div class="disk-bar"></div><div class="legend">&nbsp;</div></div>`;
  const total = Math.max(check.total, 1);
  const need = needed();
  const short = check.free < need;
  const usedPct = ((check.total - check.free) / total) * 100;
  const thisPct = (Math.min(need, check.free) / total) * 100;
  return `
    <div class="disk ${short ? "is-short" : ""}">
      <div class="disk-head"><b>${escape(check.drive)} 盘</b><span>共 ${gb(check.total)}</span></div>
      <div class="disk-bar"><i class="used" style="width:${usedPct}%"></i><i class="this" style="width:${thisPct}%"></i></div>
      <div class="legend">
        <span><i class="used"></i>已用 ${gb(check.total - check.free)}</span>
        <span><i class="this"></i>本次安装 ${gb(need)}</span>
        <span><i class="free"></i>${short ? `还差 ${gb(need - check.free)}` : `装完剩 ${gb(check.free - need)}`}</span>
      </div>
    </div>`;
}

function title(text, sub, badge) {
  const mark = badge ? `<div class="badge is-${badge}">${badge === "done" ? icons.check : icons.bigWarn}</div>` : "";
  return `
    <div class="title ${badge ? "has-badge" : ""}">
      ${mark}
      <div>
        <h1>${escape(text)}</h1>
        ${sub ? `<div class="sub">${escape(sub)}</div>` : ""}
      </div>
    </div>`;
}

function rows(items) {
  return `<div class="rows">${items
    .map(([key, value, kind]) => `<div class="row${kind ? ` is-${kind}` : ""}"><span class="key">${escape(key)}</span><span class="value" title="${escape(value)}">${escape(value)}</span></div>`)
    .join("")}</div>`;
}

function phases() {
  if (state.info.mode === "uninstall") {
    return [
      ["shortcuts", "删除快捷方式", ""],
      ["files", "删除程序文件", ""],
      ...(state.removeData ? [["data", "删除设置和登录记录", ""]] : []),
    ];
  }
  const modelLabel = isLite() ? "复制语音模型" : "复制 AI 模型";
  return [
    ["files", "复制程序文件", gb(state.info.required - state.info.modelSize)],
    ...(state.info.modelSize ? [["model", modelLabel, gb(state.info.modelSize)]] : []),
    ["shortcuts", "创建快捷方式", shortcutPlaces()],
  ];
}

function phaseRows() {
  const list = phases();
  const current = list.findIndex(([id]) => id === state.progress.phase);
  return `<div class="rows">${list
    .map(([id, label, detail], index) => {
      const status = index < current ? "done" : index === current ? "active" : "pending";
      const mark = status === "done" ? `<span class="ok">${icons.tick}</span>` : status === "active" ? `<span class="spin"></span>` : `<span class="ring"></span>`;
      return `<div class="row is-${status}" data-phase="${id}"><span class="state">${mark}</span><span>${escape(label)}</span><span class="detail">${escape(detail)}</span></div>`;
    })
    .join("")}</div>`;
}

const percent = () => Math.min(100, Math.floor((state.progress.done / Math.max(state.progress.total, 1)) * 100));

function progressPage(heading, sub, cancelable) {
  return `
    <section class="page">
      ${title(heading, sub)}
      <div class="body">
        <div class="progress">
          <div class="bar"><div class="bar-fill" style="width:${percent()}%"></div></div>
          <div class="progress-line"><span>${cancelable ? (isUpdate() ? "取消的话旧版本保持不变" : "取消的话会还原，不留下文件") : "马上就好"}</span><span class="pct">${percent()}%</span></div>
        </div>
        <div class="phases">${phaseRows()}</div>
      </div>
      <div class="foot">${cancelable ? `<button class="btn" data-action="cancel">取消</button>` : ""}</div>
    </section>`;
}

const views = {
  loading: () => "",

  missing: () => `
    <section class="page">
      ${title("还没解压完", "安装文件不在旁边，请按下面的步骤来", "warn")}
      <div class="body">
        ${rows([
          ["第一步", "右键压缩包，选「全部解压缩」"],
          ["第二步", "打开解压出来的文件夹"],
          ["第三步", `双击「安装${APP_NAME}」`],
        ])}
      </div>
      <div class="foot"><button class="btn" data-action="quit">关闭</button></div>
    </section>`,

  setup: () => {
    if (isUpdate()) return views.upgrade();
    const blocked = !state.check || locationProblem()?.level === "error";
    return `
      <section class="page">
        ${title("选择安装位置", "装好后从桌面或开始菜单打开")}
        <div class="body">
          <div class="field-group">
            <div class="path-row">
              ${icons.folder}
              <div class="path" title="${escape(state.path)}">${escape(state.path)}</div>
              <button class="btn is-small" data-action="choose">更改…</button>
            </div>
            ${problemLine()}
          </div>
          ${diskCard()}
          <label class="check">
            <input type="checkbox" data-action="desktop" ${state.desktop ? "checked" : ""} />
            <span>在桌面放一个快捷方式</span>
          </label>
        </div>
        <div class="foot">
          <button class="btn is-prominent" data-action="install" ${blocked ? "disabled" : ""}>安装</button>
        </div>
      </section>`;
  },

  upgrade: () => {
    const kind = updateKind();
    const { version, installedVersion } = state.info;
    const blocked = !state.check || locationProblem()?.level === "error";
    const older = kind === "older"
      ? `<div class="meta is-warn">${icons.warn}<span>${escape(`电脑上已是更新的 ${installedVersion}，继续会换回 ${version}`)}</span></div>`
      : "";
    return `
      <section class="page">
        ${title(kind === "same" ? `重新安装 ${version}` : kind === "older" ? `换回 ${version}` : `升级到 ${version}`, "装在原来的位置，设置和登录都保留")}
        <div class="body">
          ${rows([
            ["当前版本", installedVersion || "旧版本"],
            ["新版本", version],
            ["位置", state.path],
          ])}
          ${older}
          ${problemLine()}
        </div>
        <div class="foot">
          <button class="btn is-prominent" data-action="install" ${blocked ? "disabled" : ""}>${kind === "same" ? "重新安装" : kind === "older" ? "换回" : "升级"}</button>
        </div>
      </section>`;
  },

  installing: () => progressPage(isUpdate() ? "正在升级" : "正在安装", state.path, true),

  done: () => `
    <section class="page">
      ${isUpdate()
        ? title("升级好了", `已是 ${state.info.version}，设置和登录都保留`, "done")
        : title("装好了", `以后从${state.desktop ? "桌面或" : ""}开始菜单打开`, "done")}
      <div class="body">
        ${rows([
          ["位置", state.path],
          ["快捷方式", shortcutPlaces()],
          isUpdate() ? ["版本", state.info.version] : ["占用", gb(state.info.required)],
        ])}
      </div>
      <div class="foot">
        <button class="btn" data-action="quit">完成</button>
        <button class="btn is-prominent" data-action="launch">打开${APP_NAME}</button>
      </div>
    </section>`,

  failed: () => `
    <section class="page">
      ${isUpdate() ? title("没升级成功", "旧版本还在，可以照常用", "warn") : title("没装上", "已经还原，没有留下文件", "warn")}
      <div class="body">${rows([["原因", state.error || "复制文件时出错", (state.error || "").length > 24 ? "long" : undefined], ...(state.errorDetail ? [["详情", state.errorDetail, "wrap"]] : [])])}</div>
      <div class="foot">
        <button class="btn" data-action="quit">关闭</button>
        <button class="btn is-prominent" data-action="back">${isUpdate() ? "重试" : "重新选择位置"}</button>
      </div>
    </section>`,

  uninstallConfirm: () => {
    const running = state.check?.running;
    return `
      <section class="page">
        ${title(`卸载${APP_NAME}？`, "会删除下面这些")}
        <div class="body">
          ${rows([
            ["程序", state.info.existing],
            ["快捷方式", "桌面、开始菜单"],
          ])}
          <label class="check">
            <input type="checkbox" data-action="removeData" ${state.removeData ? "checked" : ""} />
            <span>同时删除我的设置和登录记录</span>
          </label>
          ${running ? `<div class="meta is-error">${icons.warn}<span>先关掉${APP_NAME}再卸载</span></div>` : ""}
        </div>
        <div class="foot">
          <button class="btn" data-action="quit">取消</button>
          <button class="btn is-destructive" data-action="uninstall" ${running ? "disabled" : ""}>卸载</button>
        </div>
      </section>`;
  },

  uninstalling: () => progressPage("正在卸载", state.info.existing, false),

  uninstalled: () => `
    <section class="page">
      ${title("已卸载", state.removeData ? "程序和设置都删掉了" : "设置还留着，重新安装后可以接着用", "done")}
      <div class="body">
        ${rows([
          ["程序", "已删除"],
          ["快捷方式", "已删除"],
          ["设置", state.removeData ? "已删除" : "已保留"],
        ])}
      </div>
      <div class="foot"><button class="btn is-prominent" data-action="quit">完成</button></div>
    </section>`,
};

const stepIndex = {
  loading: -1,
  missing: 0,
  setup: 0,
  failed: 0,
  installing: 1,
  done: 3,
  uninstallConfirm: 0,
  uninstalling: 1,
  uninstalled: 3,
};

function renderSteps() {
  const labels = state.info?.mode === "uninstall" ? ["确认", "卸载", "完成"] : isUpdate() ? ["确认", "升级", "完成"] : ["选择位置", "安装", "完成"];
  const current = stepIndex[state.page];
  stepsList.innerHTML = labels
    .map((label, index) => {
      const status = index < current ? "is-done" : index === current ? "is-current" : "";
      const num = index < current ? icons.tick : index + 1;
      return `<li class="step ${status}"><span class="num">${num}</span><span>${label}</span></li>`;
    })
    .join("");
}

function mood() {
  if (state.page === "done" || state.page === "uninstalled") return "done";
  if (state.page === "missing" || state.page === "failed") return "attention";
  if (state.page === "setup" && locationProblem()?.level === "error") return "attention";
  if (state.page === "uninstallConfirm" && state.check?.running) return "attention";
  return "calm";
}

let shownPage = "";
function render() {
  root.innerHTML = views[state.page]();
  if (state.page === shownPage) root.firstElementChild?.classList.add("is-settled");
  shownPage = state.page;
  renderSteps();
  document.body.dataset.mood = mood();
  document.body.toggleAttribute("data-busy", state.page === "installing" || state.page === "uninstalling");
  closeButton.disabled = state.page === "uninstalling";
}

/** Same drifting light as the app: the glows move as one sheet, and every so often a gust sweeps in from the left.
 * While installing, each glow also wanders, stretches, turns and pulses on its own, like a voice assistant's
 * light; `energy` eases in and out so the change never jumps. */
function startAmbient() {
  const box = document.getElementById("ambient");
  const sheet = box.firstElementChild;
  const glows = [...sheet.children];
  const spots = [{ size: 0.62, x: 0.085, y: -70 }, { size: 0.55, x: 0.39, y: -120 }, { size: 0.5, x: 0.7, y: 60 }];
  const gustEvery = 13;
  const gustTravel = 0.7;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  const gust = (t) => {
    const q = (((t / gustEvery) % 1) + 1) % 1;
    if (q >= 0.55) return { lift: 0, flutter: 0 };
    const lift = Math.sin((Math.PI * q) / 0.55) ** 2;
    return { lift, flutter: lift * Math.sin(2 * Math.PI * q * 3) };
  };

  /** Smooth wobble in [-1, 1] that never repeats: sines at unrelated frequencies. */
  const wobble = (t, seed) =>
    (Math.sin(t + seed) + 0.6 * Math.sin(1.618 * t + 2.1 * seed) + 0.35 * Math.sin(2.718 * t + 0.7 * seed)) / 1.95;

  const layout = (t, wander, energy) => {
    const width = box.clientWidth;
    sheet.style.transform = `translateX(${10 * Math.sin((2 * Math.PI * t) / 23)}px) scaleY(${1 + 0.04 * Math.sin((2 * Math.PI * t) / 17)})`;
    spots.forEach((spot, index) => {
      const g = gust(t - index * gustTravel);
      const size = width * spot.size;
      const s = index * 3.7;
      const dx = energy * width * 0.16 * wobble(wander * 0.9, s);
      const dy = energy * 46 * wobble(wander * 0.8, s + 1.3);
      const sx = 1 + 0.04 * g.lift + energy * 0.4 * wobble(wander * 1.3, s + 2.6);
      const sy = 1 + 0.1 * g.lift + 0.03 * g.flutter + energy * 0.4 * wobble(wander * 1.1, s + 3.9);
      const turn = energy * 32 * wobble(wander * 0.6, s + 5.2);
      const glow = glows[index];
      glow.style.width = `${size}px`;
      glow.style.height = `${size * 0.6}px`;
      glow.style.transform = `translate(${width * spot.x + 40 * g.lift + 10 * g.flutter + dx}px, ${spot.y + 22 * g.lift + dy}px) rotate(${turn}deg) scale(${sx}, ${sy})`;
      glow.style.opacity = String(1 - energy * 0.45 * (0.5 + 0.5 * wobble(wander * 2.4, s + 6.5)));
    });
  };

  let frame = 0;
  let clock = (Date.now() / 1000) % 36000;
  let wander = 0;
  let energy = 0;
  let last = performance.now();
  const tick = (now) => {
    frame = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const busy = state.page === "installing" || state.page === "uninstalling" ? 1 : 0;
    energy += (busy - energy) * Math.min(1, dt * 1.2);
    clock += dt;
    wander += dt * (0.3 + 1.2 * energy);
    layout(clock, wander, energy);
  };
  const run = () => {
    cancelAnimationFrame(frame);
    if (reduce.matches) layout(0, 0, 0);
    else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
  run();
  reduce.addEventListener("change", run);
}

let shownPhase = "";
function updateProgress() {
  const fill = root.querySelector(".bar-fill");
  if (!fill) return render();
  fill.style.width = `${percent()}%`;
  root.querySelector(".pct").textContent = `${percent()}%`;
  if (state.progress.phase !== shownPhase) root.querySelector(".phases").innerHTML = phaseRows();
  shownPhase = state.progress.phase;
}

let checkToken = 0;
async function recheck() {
  const token = ++checkToken;
  const result = await api.check(state.path);
  if (token !== checkToken) return;
  state.check = result;
  if (state.page === "setup" || state.page === "uninstallConfirm") render();
}

const actions = {
  async choose() {
    const picked = await api.choose(state.path);
    if (!picked) return;
    state.path = picked;
    state.check = null;
    render();
    recheck();
  },
  desktop(event) {
    state.desktop = event.target.checked;
  },
  removeData(event) {
    state.removeData = event.target.checked;
  },
  async install() {
    state.page = "installing";
    state.progress = { phase: "files", done: 0, total: 1 };
    render();
    const result = await api.install({ path: state.path, desktop: state.desktop });
    if (result.ok) state.page = "done";
    else if (result.cancelled) state.page = "setup";
    else {
      state.error = result.error;
      state.errorDetail = result.detail || "";
      state.page = "failed";
    }
    render();
    if (state.page === "setup") recheck();
  },
  cancel() {
    api.cancel();
  },
  back() {
    state.page = "setup";
    render();
    recheck();
  },
  async uninstall() {
    state.page = "uninstalling";
    state.progress = { phase: "shortcuts", done: 0, total: 1 };
    render();
    await api.uninstall({ removeData: state.removeData });
    state.page = "uninstalled";
    render();
  },
  launch() {
    api.launch();
  },
  quit() {
    api.quit();
  },
};

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled || target.type === "checkbox") return;
  actions[target.dataset.action]?.(event);
});

root.addEventListener("change", (event) => {
  if (event.target.type === "checkbox") actions[event.target.dataset.action]?.(event);
});

closeButton.addEventListener("click", () => {
  if (state.page === "installing") api.cancel();
  api.quit();
});

api.onProgress((progress) => {
  state.progress = progress;
  if (state.page === "installing" || state.page === "uninstalling") updateProgress();
});

setInterval(() => {
  if (state.check?.running && (state.page === "setup" || state.page === "uninstallConfirm")) recheck();
}, 1500);

startAmbient();

function applyBrand(info) {
  APP_NAME = info.appName || APP_NAME;
  document.title = info.mode === "uninstall" ? `卸载${APP_NAME}` : `安装${APP_NAME}`;
  const name = document.getElementById("brand-name");
  if (info.lite) {
    name.innerHTML = `探迹话术上传助手 <span class="lite-badge">Lite</span>`;
    document.getElementById("version").textContent = `轻量版 ${info.version}`;
    document.getElementById("feature-ai").innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 8.1l1.8 1.8 3.8-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>轻量版 · 不含本地大模型</span>';
  } else {
    document.getElementById("version").textContent = `版本 ${info.version}`;
  }
}

(async () => {
  state.info = await api.info();
  applyBrand(state.info);
  document.body.classList.toggle("is-uninstall", state.info.mode === "uninstall");
  document.body.classList.toggle("is-lite", Boolean(state.info.lite));
  if (state.info.mode === "uninstall") {
    state.path = state.info.existing;
    state.page = "uninstallConfirm";
  } else if (!state.info.payload) {
    state.page = "missing";
  } else {
    state.path = state.info.existing || state.info.defaultPath;
    state.desktop = state.info.desktopShortcut !== false;
    state.page = "setup";
  }
  render();
  recheck();
})();
