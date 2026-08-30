// One-time, non-blocking toast notices for teardown and layer-budget warnings.

const NOTICE_ID = 'visual-zoom-notice';
const BUDGET_NOTICE_ID = 'visual-zoom-budget-notice';

export function createNotices() {
  let noticeShown = false;
  let budgetNoticeShown = false;

  function getNotice() {
    return document.getElementById(NOTICE_ID);
  }

  function getBudgetNotice() {
    return document.getElementById(BUDGET_NOTICE_ID);
  }

  function showToast(id, message, background, zIndex) {
    const body = document.body;
    if (!body) {
      return;
    }
    const notice = document.createElement('div');
    notice.id = id;
    notice.setAttribute('role', 'status');
    notice.style.cssText =
      `position:fixed;right:16px;bottom:16px;z-index:${zIndex};max-width:320px;` +
      `padding:12px 16px;border-radius:8px;background:${background};color:#fff;` +
      'font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.35);';
    const messageEl = document.createElement('span');
    messageEl.textContent = message;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.style.cssText =
      'margin-left:8px;padding:2px 8px;border:1px solid rgba(255,255,255,0.4);' +
      'border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer;';
    dismiss.addEventListener('click', () => notice.remove());
    notice.append(messageEl, dismiss);
    body.appendChild(notice);
  }

  function showNotice() {
    if (noticeShown) {
      return;
    }
    noticeShown = true;
    showToast(
      NOTICE_ID,
      'Visual Zoom stopped: the page replaced its own content, so zoom was reset to 100%.',
      '#17203a',
      2147483647
    );
  }

  function removeNotice() {
    const notice = getNotice();
    if (notice) {
      notice.remove();
    }
  }

  function removeBudgetNotice() {
    const notice = getBudgetNotice();
    if (notice) {
      notice.remove();
    }
  }

  function showBudgetNotice() {
    if (budgetNoticeShown) {
      return;
    }
    budgetNoticeShown = true;
    showToast(
      BUDGET_NOTICE_ID,
      'Visual Zoom may be slow on this page: it is larger than the browser\'s ' +
        'compositor texture limit.',
      '#3a2d12',
      2147483646
    );
  }

  function reset() {
    noticeShown = false;
    budgetNoticeShown = false;
  }

  return {
    showNotice,
    removeNotice,
    showBudgetNotice,
    removeBudgetNotice,
    reset,
    isNoticeShown: () => noticeShown,
    isBudgetNoticeShown: () => budgetNoticeShown,
  };
}
