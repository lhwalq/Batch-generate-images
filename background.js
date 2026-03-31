let nextDownloadInfo = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "GET_DOWNLOAD_BASELINE") {
    chrome.downloads.search({}, (items) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({
        ok: true,
        downloadIds: items.map((item) => item.id).filter((id) => typeof id === "number")
      });
    });
    return true;
  }

  if (request?.type === "WAIT_FOR_NEW_DOWNLOAD_START") {
    const { afterTs, timeoutMs, baselineIds } = request;
    const startedAfter = Number(afterTs) > 0 ? Number(afterTs) : Date.now();
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 10000;
    const startedAt = Date.now();
    const baselineIdSet = new Set(Array.isArray(baselineIds) ? baselineIds : []);

    const poll = () => {
      chrome.downloads.search({}, (items) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        const match = items
          .filter((item) => !baselineIdSet.has(item.id))
          .filter((item) => {
            const itemStartedAt = item.startTime ? Date.parse(item.startTime) : 0;
            return Number.isFinite(itemStartedAt) && itemStartedAt >= startedAfter - 2000;
          })
          .sort((left, right) => {
            const leftStartedAt = left.startTime ? Date.parse(left.startTime) : 0;
            const rightStartedAt = right.startTime ? Date.parse(right.startTime) : 0;
            return rightStartedAt - leftStartedAt;
          })[0];

        if (match?.id) {
          sendResponse({ ok: true, downloadId: match.id, filename: match.filename || "" });
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          sendResponse({ ok: false, error: "Download did not start before timeout." });
          return;
        }

        setTimeout(poll, 500);
      });
    };

    poll();
    return true;
  }

  if (request?.type === "WAIT_FOR_DOWNLOAD_COMPLETE_BY_ID") {
    const { downloadId, timeoutMs } = request;
    if (typeof downloadId !== "number") {
      sendResponse({ ok: false, error: "Missing downloadId." });
      return false;
    }

    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 90000;
    const startedAt = Date.now();
    let completeSeenAt = 0;

    const poll = () => {
      chrome.downloads.search({ id: downloadId }, (items) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        const match = items[0];
        if (match?.state === "complete") {
          if (!completeSeenAt) {
            completeSeenAt = Date.now();
          }

          const bytesStable = typeof match.totalBytes !== "number" ||
            match.totalBytes <= 0 ||
            match.bytesReceived === match.totalBytes;

          if (bytesStable && Date.now() - completeSeenAt >= 1500) {
            sendResponse({ ok: true, downloadId });
            return;
          }

          setTimeout(poll, 800);
          return;
        }

        completeSeenAt = 0;

        if (match?.state === "interrupted") {
          sendResponse({ ok: false, error: "Download was interrupted." });
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          sendResponse({ ok: false, error: "Download did not complete before timeout." });
          return;
        }

        setTimeout(poll, 800);
      });
    };

    poll();
    return true;
  }

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

  if (Date.now() - nextDownloadInfo.timestamp > 180000) {
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
