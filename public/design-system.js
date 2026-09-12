import { mountQuestionBankUX } from './question-bank-ux.js';
import { mountKnowledgeGraphUX } from './knowledge-graph-ux.js';

// Preserve native nodes, IDs, options, FormData and listeners. Card, canvas,
// navigation and conversation controls keep their product-specific geometry.
const protectedSurface = '.global-header, .workspace-sidebar, .mobile-student-nav, .app-teacher-nav, .app-student-home, .app-device-toolbar, .app-device-menu, .ai-teacher-composer, .ai-dialogue-head, .app-course-context-dialog, .ai-dialogue-actions, .knowledge-book, .knowledge-library-wall, .knowledge-graph-canvas, .question-knowledge-tree, .lesson-player-stage';
const protectedButton = '[role="tab"], [role="option"], [role="treeitem"], [data-course-id], [data-graph-view], [data-mastery-quick-filter], .student-practice-options button, .question-bank-ux-practice-options button, .question-bank-row, .knowledge-slide-item';

export function enhanceControls(root = document) {
  const nodes = [];
  if (root.matches?.('button,input,select,textarea')) nodes.push(root);
  nodes.push(...root.querySelectorAll('button,input,select,textarea'));
  for (const node of nodes) {
    if (node.hidden || node.closest(protectedSurface)) continue;
    if (node.matches('select')) node.classList.add('form-select');
    else if (node.matches('textarea,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])')) node.classList.add('form-control');
    else if (node.matches('button') && !node.matches(protectedButton) && !node.querySelector('small')) {
      node.classList.add('btn');
      if (node.matches('.primary-btn, .shelf-create-button, [data-primary-action]')) node.classList.add('btn-primary');
      const text = node.textContent.trim();
      if (!text && (node.getAttribute('aria-label') || node.title)) node.classList.add('btn-icon', 'btn-ghost');
      if (node.querySelector('svg, i[data-lucide]') && node.title && !node.getAttribute('aria-label')) node.setAttribute('aria-label', node.title);
    }
  }
}

export function mountDesignSystem() {
  if (document.documentElement.dataset.designSystem) return;
  document.documentElement.dataset.designSystem = 'tabler-1.5';
  enhanceControls();
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) enhanceControls(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  let queued = false;
  const syncWorkspaces = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      mountQuestionBankUX();
      mountKnowledgeGraphUX();
      enhanceControls();
    });
  };
  document.addEventListener('learning-workspace:change', syncWorkspaces);
  document.addEventListener('portal-role:change', syncWorkspaces);
  document.addEventListener('education-data:ready', syncWorkspaces);
  syncWorkspaces();
  const main = document.querySelector('#appMainContent');
  if (main) {
    const resize = new ResizeObserver(entries => {
      const available = Math.max(0, entries[0].contentRect.height);
      document.documentElement.style.setProperty('--ds-content-height', `${available}px`);
    });
    resize.observe(main);
  }
}
