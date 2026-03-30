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
    collapsed: false,
    running: false,
    items: [],
    logLines: ["准备就绪"],
    settings: { delaySeconds: 60, includeThumbnail: true },
    lastJsonText: ""
  };

  let root, els = {}, abortController = null, downloadResolver = null;
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  // 监听后台的下载完成信号
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "DOWNLOAD_FINISHED") {
       if (downloadResolver) {
           downloadResolver();
           downloadResolver = null;
       }
    }
  });

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    el.scrollIntoView({ block: "center" });
    ["mousedown", "click", "mouseup"].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  }

  async function triggerGeminiDownload(previewSource, filename) {
    try {
      appendLog(`[下载队列] 开始处理: ${filename}`);
      clickElement(previewSource);
      await sleep(2000);

      const dialog = document.querySelector('mat-dialog-container');
      if (!dialog) throw new Error("无法开启预览弹窗。");

      let btn = null;
      for (const sel of SELECTOR_CANDIDATES.downloadAction) {
        btn = dialog.querySelector(sel);
        if (btn) break;
      }
      if (!btn) throw new Error("未检测到下载按钮。");

      // 关键：在点击前锁定后台文件名
      await chrome.runtime.sendMessage({ type: "SET_NEXT_DOWNLOAD", filename: filename });

      // 准备好一个 Promise，等待后台通知下载完成
      const downloadDone = new Promise((resolve) => {
          downloadResolver = resolve;
          // 设置一个 15s 的保险超时，由于网络问题可能导致信号丢失
          setTimeout(resolve, 15000);
      });

      clickElement(btn);
      appendLog("正在下载中，请勿进行其他操作...");
      
      // 真正阻塞等待：直到文件落盘才进行下一步
      await downloadDone;
      appendLog("下载成功，准备关闭预览。");

      const close = dialog.querySelector('button[mat-dialog-close], button[aria-label*="Close"], button[aria-label*="关闭"]');
      if (close) clickElement(close);
      else { const b = document.querySelector('.cdk-overlay-backdrop'); if(b) b.click(); }
      
      await sleep(1000); // 缓冲
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
    let lastRetry = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("Aborted");
      if (getAllStepsCount() > oldStepCount) return true;
      if (Date.now() - lastRetry > 8000) {
        const input = findFirstElement(SELECTOR_CANDIDATES.promptInput);
        if (input && (input.innerText || input.value || "").trim().length > 5) {
            appendLog("检测到发送未生效，重试中...");
            clickElement(getSubmitButton());
        }
        lastRetry = Date.now();
      }
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
    els.stopBtn.onclick = () => { abortController?.abort(); if(downloadResolver) downloadResolver(); state.running = false; render(); };
    els.clearBtn.onclick = () => { state.items = []; persistState(); render(); };
    els.toggleBtn.onclick = () => { state.collapsed = !state.collapsed; persistState(); render(); };
  }

  render();
})();
