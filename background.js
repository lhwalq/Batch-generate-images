chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
