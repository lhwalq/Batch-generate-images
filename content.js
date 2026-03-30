(function () {
  if (window.__geminiBatchImageLoaded) return;
  window.__geminiBatchImageLoaded = true;

  const STORAGE_KEY = "gbi-state-v1";
  const RESUME_KEY = "gbi-resume-v1";
  
  const SELECTOR_CANDIDATES = {
    promptInput: [
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[aria-label*="Prompt"]',
      'textarea[aria-label*="输入"]'
    ],
    submitButton: [
      'button.send-button',
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="生成"]'
    ],
    downloadAction: [
      'button[aria-label*="下载"]',
      'button[aria-label*="Download full size image"]',
      'button[aria-label*="Download"]'
    ]
  };

  const state = {
    collapsed: true,
    running: false,
    items: [],
    logLines: ["准备就绪"],
    settings: { delaySeconds: 60, includeThumbnail: true },
    lastJsonText: ""
  };

  let root, els = {}, abortController = null;
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  function sanitizeFilenamePart(value, fallback = "item") {
    return String(value ?? "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 80) || fallback;
  }

  function buildFilename(item, index, subIndex = 0) {
    const order = String(index + 1).padStart(3, "0");
    const idPart = sanitizeFilenamePart(item.id || "id");
    const promptPart = sanitizeFilenamePart(item.prompt_en || "img").substring(0, 25);
    const subPart = String(subIndex + 1).padStart(2, "0");
    return `${order}_id${idPart}_${promptPart}_v${subPart}.png`;
  }

  function appendLog(line) {
    const stamp = new Date().toLocaleTimeString();
    state.logLines = [...state.logLines.slice(-15), `[${stamp}] ${line}`];
    render();
  }

  function persistState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings: state.settings
    }));
  }

  function findFirstElement(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  async function waitForGeminiReady() {
    while (true) {
      const input = findFirstElement(SELECTOR_CANDIDATES.promptInput);
      if (input) return input;
      await sleep(1000);
    }
  }

  function getSubmitButton() {
    return findFirstElement(SELECTOR_CANDIDATES.submitButton);
  }

  function clickElement(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    try { el.focus?.(); } catch (_) {}
    try { el.click?.(); } catch (_) {}
  }

  async function humanClickElement(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.max(2, Math.min(rect.width / 2, rect.width - 2));
    const clientY = rect.top + Math.max(2, Math.min(rect.height / 2, rect.height - 2));
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 1
    };

    try { el.focus?.(); } catch (_) {}

    const hoverTypes = ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"];
    const pressTypes = ["pointerdown", "mousedown"];
    const releaseTypes = ["pointerup", "mouseup", "click"];

    hoverTypes.forEach((type) => {
      const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventCtor(type, { ...base, buttons: 0 }));
    });

    pressTypes.forEach((type) => {
      const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventCtor(type, base));
    });

    releaseTypes.forEach((type) => {
      const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventCtor(type, { ...base, buttons: 0 }));
    });

    try { el.click?.(); } catch (_) {}
    await sleep(120);
  }

  function movePointerAwayFromElement(el) {
    if (!el) return;
    const body = document.body || document.documentElement;
    const rect = el.getBoundingClientRect();
    const clientX = Math.max(2, Math.min(window.innerWidth - 2, rect.left - 24));
    const clientY = Math.max(2, Math.min(window.innerHeight - 2, rect.top - 24));
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 0
    };

    ["pointerout", "mouseout", "pointerleave", "mouseleave"].forEach((type) => {
      const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      try { el.dispatchEvent(new EventCtor(type, base)); } catch (_) {}
    });

    ["pointermove", "mousemove", "pointerover", "mouseover"].forEach((type) => {
      const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      try { body.dispatchEvent(new EventCtor(type, base)); } catch (_) {}
    });
  }

  async function keyboardActivate(el) {
    if (!el) return;
    try { el.focus?.(); } catch (_) {}
    const keyEvents = [
      ["keydown", "Enter"],
      ["keyup", "Enter"],
      ["keydown", " "],
      ["keyup", " "]
    ];
    for (const [type, key] of keyEvents) {
      el.dispatchEvent(new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        code: key === "Enter" ? "Enter" : "Space",
      }));
      await sleep(40);
    }
  }

  function getDirectDownloadButton(sourceEl) {
    if (!sourceEl) return null;

    const roots = [];
    let current = sourceEl;
    while (current && current !== document.body) {
      roots.push(current);
      current = current.parentElement;
    }

    for (const root of roots) {
      for (const sel of SELECTOR_CANDIDATES.downloadAction) {
        const btn = root.querySelector(sel);
        if (btn) return btn;
      }
    }

    return null;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";
  }

  function isDownloadButtonActive(btn) {
    if (!btn) return false;
    return isElementVisible(btn) &&
      !btn.disabled &&
      btn.getAttribute("aria-disabled") !== "true";
  }

  async function waitForDownloadButtonToClear(sourceEl, timeoutMs = 30000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const btn = getDirectDownloadButton(sourceEl);
      if (!btn || !isDownloadButtonActive(btn)) {
        return true;
      }

      await sleep(500);
    }

    throw new Error("下载按钮状态未变化，无法确认下载是否真正开始。");
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片转 data URL 失败。"));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchImageAsDataUrl(src) {
    const response = await fetch(src, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`图片请求失败：${response.status}`);
    }

    const blob = await response.blob();
    return blobToDataUrl(blob);
  }

  async function downloadDataUrl(dataUrl, filename) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "DOWNLOAD_DATA_URL",
          dataUrl,
          filename
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "下载启动失败。"));
            return;
          }

          resolve(response.downloadId);
        }
      );
    });
  }

  async function setNextDownloadFilename(filename) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "SET_NEXT_DOWNLOAD",
          filename
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || "下载文件名设置失败。"));
            return;
          }

          resolve();
        }
      );
    });
  }

  async function triggerGeminiDownload(previewSource, filename) {
    try {
      appendLog(`[下载队列] 开始处理: ${filename}`);
      previewSource.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      await sleep(300);

      const hoverTarget = previewSource.querySelector?.("img") || previewSource;
      try { hoverTarget.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      try { hoverTarget.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      await sleep(400);

      const btn = getDirectDownloadButton(previewSource);
      if (!btn) throw new Error("未在图片卡片上找到“下载完整尺寸图片”按钮。");

      appendLog("已定位到卡片下载按钮，直接触发原图下载。");
      await setNextDownloadFilename(filename);
      await humanClickElement(btn);
      await sleep(250);
      await keyboardActivate(btn);
      movePointerAwayFromElement(btn);
      movePointerAwayFromElement(previewSource);
      appendLog("原图下载按钮已触发，等待按钮状态变化确认下载开始。");
      await waitForDownloadButtonToClear(previewSource, 30000);
      appendLog("下载已确认开始。");

      await sleep(500);
      return true;
    } catch (e) {
      appendLog(`下载异常：${e.message}`);
      return false;
    }
  }

  function getAllStepsCount() {
    return document.querySelectorAll('chat-step, [data-message-id], .conversation-container').length;
  }

  async function waitForSendSync(oldStepCount, timeoutMs, signal) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("Aborted");
      if (getAllStepsCount() > oldStepCount) return true;
      await sleep(1500);
    }
    throw new Error("超时");
  }

  async function setPromptValue(prompt) {
    const input = await waitForGeminiReady();
    input.focus();
    const trigger = (el) => {
        ["beforeinput", "input", "change", "blur"].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
    };
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      if (setter) setter.call(input, prompt);
      else input.value = prompt;
    } else if (input.isContentEditable) {
      const s = window.getSelection(); const r = document.createRange();
      r.selectNodeContents(input); r.deleteContents();
      const n = document.createTextNode(prompt); r.insertNode(n);
      r.setStartAfter(n); r.collapse(true);
      if (s) { s.removeAllRanges(); s.addRange(r); }
    }
    trigger(input);
    await sleep(200);
  }

  async function runQueue() {
    if (!state.items.length) { appendLog("队列为空。"); return; }
    if (state.running) return;
    appendLog(">>> 开始全自动任务 (下载确认模式开启) <<<");
    abortController = new AbortController();
    state.running = true; render(); persistState();

    try {
      await waitForGeminiReady();

      // 第一阶段
      appendLog(">>> 第一阶段：同步派发指令...");
      for (let index = 0; index < state.items.length; index += 1) {
        if (!state.running) break;
        const item = state.items[index];
        if (item.status === "done" || item.status === "generated") continue;

        appendLog(`[生图 ${index + 1}/${state.items.length}] 正在启动...`);
        await setPromptValue(item.prompt_en);
        await sleep(1000); 

        const btn = getSubmitButton();
        if (!btn || btn.disabled) throw new Error("发送按钮不可用。");

        const oldCount = getAllStepsCount();
        clickElement(btn);
        
        await waitForSendSync(oldCount, 45000, abortController.signal);
        
        // 阻塞等待生图完成
        appendLog(`[任务 ${index + 1}] 正处于绘制阶段...`);
        const startTime = Date.now();
        while (Date.now() - startTime < 85000) {
           if (abortController?.signal.aborted) break;
           const all = [...document.querySelectorAll('chat-step, [data-message-id], .conversation-container')];
           const container = all[all.length - 1];
           const imgs = container ? container.querySelectorAll('img') : [];
           const submitBtn = getSubmitButton();
           const micBtn = document.querySelector('button[data-node-type="speech_dictation_mic_button"]');
           const ready = (micBtn && micBtn.offsetParent !== null) || (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true');

           if (imgs.length > 0 && ready) {
               appendLog(`[任务 ${index + 1}] 绘制完成。`);
               break;
           }
           await sleep(2000);
        }
        item.status = "generated";
        persistState(); render();
        await sleep(3000); 
      }

      if (state.running) {
          appendLog("所有指令派发完毕，等待预览渲染...");
          await sleep(12000);
      }

      // 第二阶段
      appendLog(">>> 第二阶段：串行下载原图 (含确认逻辑)...");
      for (let index = 0; index < state.items.length; index += 1) {
        if (!state.running) break;
        const item = state.items[index];
        if (item.status !== "generated") continue;

        const fuzzy = item.prompt_en.trim().substring(0, 45);
        const all = [...document.querySelectorAll('chat-step, [data-message-id], .conversation-container, .message-content')];
        const msg = all.find(m => m.textContent.includes(fuzzy));
        if (msg) {
          const imgs = [...msg.querySelectorAll('img')].filter(img => {
            const s = img.src || '';
            const inCard = img.closest('.image-card-container') || img.closest('.attachment-container');
            return (s.includes('googleusercontent.com') || s.startsWith('blob:')) && inCard;
          });
          
          appendLog(`[任务 ${index + 1}] 提取到 ${imgs.length} 张图，开始同步下载...`);
          for (let i = 0; i < imgs.length; i++) {
            const filename = buildFilename(item, index, i);
            await triggerGeminiDownload(imgs[i].closest('.image-card-container') || imgs[i], filename);
          }
          item.status = "done";
          persistState(); render();
        } else {
          appendLog(`索引 ${index + 1}：跳过（未在历史中搜索到）。`);
          item.status = "done";
        }
      }
      appendLog("任务序列全部顺利完成！");
    } catch (e) {
      appendLog(`终止：${e.message}`);
    } finally {
      state.running = false; state.items = [];
      render(); persistState(); abortController = null;
    }
  }

  function handleImport() {
    try {
      const text = els.jsonInput.value.trim();
      const data = JSON.parse(text);
      let list = [];
      if (data.main_image_prompts && Array.isArray(data.main_image_prompts)) list = [...data.main_image_prompts];
      else if (Array.isArray(data)) list = [...data];
      if (data.thumbnail_prompt) {
        if (Array.isArray(data.thumbnail_prompt)) list = list.concat(data.thumbnail_prompt);
        else list.push({ ...data.thumbnail_prompt, id: data.thumbnail_prompt.id || "thumbnail" });
      }
      state.items = list.map((item, index) => ({
        id: String(item.id ?? `item-${index + 1}`),
        prompt_en: item.prompt_en, status: "pending"
      }));
      state.lastJsonText = text;
      render(); persistState();
      appendLog(`导入 ${state.items.length} 个任务 (含封面图)。`);
    } catch (e) { appendLog(`坏 JSON：${e.message}`); }
  }

  function render() {
    if (!root) {
      root = document.createElement("div"); root.id = "gemini-batch-image-root";
      document.body.appendChild(root);
    }
    root.className = state.collapsed ? "gbi-collapsed" : "";
    root.innerHTML = `
      <div class="gbi-header">
        <span class="gbi-title">Gemini 批量下载 Pro</span>
        <div class="gbi-header-actions">
          <button class="gbi-icon-button" id="gbi-toggle-btn">${state.collapsed ? "+" : "−"}</button>
        </div>
      </div>
      <div class="gbi-body">
        <div class="gbi-section">
          <label class="gbi-label">粘贴 JSON</label>
          <textarea class="gbi-textarea" id="gbi-json-input">${state.lastJsonText || ""}</textarea>
          <button class="gbi-button" id="gbi-import-btn">解析任务</button>
        </div>
        <div class="gbi-row">
          <div class="gbi-section">
            <label class="gbi-label">超时 (秒)</label>
            <input type="number" class="gbi-input" id="gbi-delay-input" value="${state.settings.delaySeconds}">
          </div>
          <div class="gbi-section">
            <label class="gbi-label">封面支持</label>
            <select class="gbi-select" id="gbi-thumb-select">
              <option value="true" ${state.settings.includeThumbnail ? "selected" : ""}>包含</option>
              <option value="false" ${!state.settings.includeThumbnail ? "selected" : ""}>不包含</option>
            </select>
          </div>
        </div>
        <div class="gbi-row">
          <button class="gbi-button" id="gbi-start-btn" ${state.running ? "disabled" : ""}>开始批量同步</button>
          <button class="gbi-button" id="gbi-stop-btn" data-variant="secondary" ${!state.running ? "disabled" : ""}>停止</button>
        </div>
        <button class="gbi-button" id="gbi-clear-btn" data-variant="secondary">一键清空队列</button>
        <div class="gbi-section">
          <label class="gbi-label">稳定执行日志</label>
          <div class="gbi-status" id="gbi-logs">
            ${state.logLines.map(line => `<div>${line}</div>`).join("")}
          </div>
        </div>
        <div class="gbi-section">
          <label class="gbi-label">处理队列 (${state.items.filter(i => i.status === "done").length}/${state.items.length})</label>
          <div class="gbi-list">
            ${state.items.map((item, i) => `
              <div class="gbi-item">
                <div class="gbi-item-header">
                  <span class="gbi-item-title">${i + 1}. ${item.id}</span>
                  <span class="gbi-badge">${item.status}</span>
                </div>
                <div class="gbi-item-body">${(item.prompt_en || "").substring(0, 50)}...</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;

    els.jsonInput = root.querySelector("#gbi-json-input");
    els.importBtn = root.querySelector("#gbi-import-btn");
    els.startBtn = root.querySelector("#gbi-start-btn");
    els.stopBtn = root.querySelector("#gbi-stop-btn");
    els.clearBtn = root.querySelector("#gbi-clear-btn");
    els.toggleBtn = root.querySelector("#gbi-toggle-btn");

    els.importBtn.onclick = handleImport;
    els.startBtn.onclick = () => runQueue();
    els.stopBtn.onclick = () => { abortController?.abort(); state.running = false; render(); };
    els.clearBtn.onclick = () => { state.items = []; persistState(); render(); };
    els.toggleBtn.onclick = () => { state.collapsed = !state.collapsed; render(); };

    const logsEl = root.querySelector("#gbi-logs");
    if (logsEl) {
      logsEl.scrollTop = logsEl.scrollHeight;
    }
  }

  render();
})();
