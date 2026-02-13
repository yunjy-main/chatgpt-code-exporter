// checkpoint: popup.js@v0.5.0_inject_content_js_on_button_click

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

document.getElementById("exportBtn")
  .addEventListener("click", async () => {

    const tab = await getActiveTab();
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    window.close();
  });
