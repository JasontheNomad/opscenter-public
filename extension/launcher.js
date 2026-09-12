// Teams only shows its rail-free meeting UI in the window its launcher opens, and only the launcher's
// own handoff carries your signed-in identity into it — so the launcher has to run. All we do is press
// its button. Closing the leftover tab is the background worker's job: this page navigates itself into
// the full web client right after the click, which destroys anything scheduled here.
const LABEL = /continue on this browser/i;

const findButton = () =>
	[...document.querySelectorAll('button, a, [role="button"]')].find((el) => LABEL.test(el.textContent || ''));

chrome.runtime.sendMessage({ launcher: true });

let clicked = false;
const tryClick = () => {
	if (clicked) return;
	const btn = findButton();
	if (!btn) return;
	clicked = true;
	btn.click();
};

tryClick();
const observer = new MutationObserver(tryClick);
observer.observe(document.documentElement, { childList: true, subtree: true });
// give up watching if the button never appears (renamed, or a launcher variant we don't handle)
setTimeout(() => observer.disconnect(), 20000);
