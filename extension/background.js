// Tabs that reported themselves as the Teams launcher. The launcher page navigates itself into the full
// web client right after its button is clicked, so anything scheduled inside that page dies with it —
// closing it has to happen out here.
const launcherTabs = new Set();
const isLauncher = (url) => url.startsWith('https://teams.microsoft.com/dl/launcher/');

// The launcher window is unavoidable (Teams only hands your identity to the rail-free meeting UI through
// its own launcher) and macOS won't open a window off-screen, so the next best thing is to give it the
// meeting window's shape: the hand-off then reads as one window loading rather than a stray window.
const GEOMETRY = { width: 1357, height: 846, left: 181, top: 67 };

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (!msg?.launcher || sender.tab?.id === undefined) return;
	launcherTabs.add(sender.tab.id);
	if (sender.tab.windowId !== undefined) chrome.windows.update(sender.tab.windowId, GEOMETRY);
	// don't sit on a stale id if the click never happens
	setTimeout(() => launcherTabs.delete(sender.tab.id), 60000);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (!launcherTabs.has(tabId) || !changeInfo.url || isLauncher(changeInfo.url)) return;
	launcherTabs.delete(tabId);
	chrome.tabs.remove(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => launcherTabs.delete(tabId));
