let nextDownloadInfo = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SET_NEXT_DOWNLOAD") {
    nextDownloadInfo = {
      filename: request.filename,
      timestamp: Date.now()
    };
    sendResponse({ status: "ok" });
  }
});

// 重命名触发：拦截并应用预设的文件名
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (nextDownloadInfo && (Date.now() - nextDownloadInfo.timestamp < 15000)) {
    suggest({
      filename: nextDownloadInfo.filename,
      conflictAction: "uniquify"
    });
    // 消耗掉此信息，防止污染
    nextDownloadInfo = null;
  }
});

// 状态追踪：当下载状态发生变化时，如果完成，则向页面发送信号
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === "complete") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "DOWNLOAD_FINISHED", id: delta.id });
      }
    });
  }
});
