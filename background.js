let nextDownloadInfo = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "SET_NEXT_DOWNLOAD") {
    if (!request.filename) {
      sendResponse({ ok: false, error: "Missing filename." });
      return false;
    }

    nextDownloadInfo = {
      filename: request.filename,
      timestamp: Date.now()
    };
    sendResponse({ ok: true });
    return false;
  }

  if (request?.type !== "DOWNLOAD_DATA_URL") {
    return false;
  }

  const { dataUrl, filename } = request;
  if (!dataUrl || !filename) {
    sendResponse({ ok: false, error: "Missing dataUrl or filename." });
    return false;
  }

  chrome.downloads.download(
    {
      url: dataUrl,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ ok: true, downloadId });
    }
  );

  return true;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!nextDownloadInfo) {
    suggest();
    return;
  }

  if (Date.now() - nextDownloadInfo.timestamp > 30000) {
    nextDownloadInfo = null;
    suggest();
    return;
  }

  suggest({
    filename: nextDownloadInfo.filename,
    conflictAction: "uniquify"
  });
  nextDownloadInfo = null;
});
