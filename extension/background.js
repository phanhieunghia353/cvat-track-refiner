// activeTab grants access only after a deliberate toolbar click. No host list,
// token, remote service, or machine-specific path is needed.
chrome.action.onClicked.addListener((tab) => {
  if (Number.isInteger(tab.id))
    chrome.windows.create({
      url: chrome.runtime.getURL(`panel.html?tab=${tab.id}`),
      type: "popup",
      width: 1140,
      height: 850,
    });
});
