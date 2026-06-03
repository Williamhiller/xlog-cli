// UI/UX enhancements for xLogger viewer
// Improves user experience with better interactions, animations, and accessibility

const UI_ENHANCEMENT_VERSION = '1.0.0';
const ANIMATION_DURATION_MS = 200;
const DEBOUNCE_DELAY_MS = 300;

export class UIEnhancements {
  constructor(options = {}) {
    this.version = UI_ENHANCEMENT_VERSION;
    this.animationDuration = options.animationDuration || ANIMATION_DURATION_MS;
    this.debounceDelay = options.debounceDelay || DEBOUNCE_DELAY_MS;

    this.shortcuts = new Map();
    this.tooltips = new Map();
    this.modals = new Map();

    this.init();
  }

  init() {
    this.setupKeyboardShortcuts();
    this.setupTooltips();
    this.setupAccessibility();
    this.setupAnimations();
  }

  // Keyboard shortcuts
  setupKeyboardShortcuts() {
    // Register default shortcuts
    this.registerShortcut('ctrl+k', 'focusSearch', 'Focus search input');
    this.registerShortcut('ctrl+/', 'toggleHelp', 'Toggle help panel');
    this.registerShortcut('escape', 'closePanel', 'Close active panel');
    this.registerShortcut('ctrl+shift+c', 'clearLogs', 'Clear all logs');
    this.registerShortcut('ctrl+shift+r', 'refresh', 'Refresh logs');

    // Listen for keyboard events
    document.addEventListener('keydown', (event) => {
      this.handleKeyboardShortcut(event);
    });
  }

  registerShortcut(key, action, description) {
    this.shortcuts.set(key, { action, description });
  }

  handleKeyboardShortcut(event) {
    const key = this.getShortcutKey(event);
    const shortcut = this.shortcuts.get(key);

    if (shortcut) {
      event.preventDefault();
      this.executeShortcut(shortcut.action);
    }
  }

  getShortcutKey(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.shiftKey) parts.push('shift');
    if (event.altKey) parts.push('alt');
    parts.push(event.key.toLowerCase());
    return parts.join('+');
  }

  executeShortcut(action) {
    switch (action) {
      case 'focusSearch':
        this.focusSearch();
        break;
      case 'toggleHelp':
        this.toggleHelp();
        break;
      case 'closePanel':
        this.closeActivePanel();
        break;
      case 'clearLogs':
        this.clearLogs();
        break;
      case 'refresh':
        this.refreshLogs();
        break;
    }
  }

  focusSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  toggleHelp() {
    const helpPanel = document.getElementById('help-panel');
    if (helpPanel) {
      helpPanel.hidden = !helpPanel.hidden;
    }
  }

  closeActivePanel() {
    const activePanel = document.querySelector('.panel:not([hidden])');
    if (activePanel) {
      activePanel.hidden = true;
    }
  }

  clearLogs() {
    if (confirm('Are you sure you want to clear all logs?')) {
      // Trigger clear action
      const clearButton = document.getElementById('clear-logs');
      if (clearButton) {
        clearButton.click();
      }
    }
  }

  refreshLogs() {
    // Trigger refresh action
    const refreshButton = document.getElementById('refresh-logs');
    if (refreshButton) {
      refreshButton.click();
    }
  }

  // Tooltips
  setupTooltips() {
    // Initialize tooltips for elements with data-tooltip attribute
    document.querySelectorAll('[data-tooltip]').forEach(element => {
      this.initTooltip(element);
    });

    // Observe DOM for new elements
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.hasAttribute('data-tooltip')) {
              this.initTooltip(node);
            }
            node.querySelectorAll('[data-tooltip]').forEach(element => {
              this.initTooltip(element);
            });
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  initTooltip(element) {
    const tooltipText = element.getAttribute('data-tooltip');
    if (!tooltipText) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = tooltipText;
    tooltip.style.cssText = `
      position: absolute;
      background: var(--tooltip-bg, #333);
      color: var(--tooltip-text, #fff);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 1000;
      opacity: 0;
      transition: opacity ${this.animationDuration}ms ease;
      pointer-events: none;
    `;

    document.body.appendChild(tooltip);

    element.addEventListener('mouseenter', () => {
      this.showTooltip(element, tooltip);
    });

    element.addEventListener('mouseleave', () => {
      this.hideTooltip(tooltip);
    });

    this.tooltips.set(element, tooltip);
  }

  showTooltip(element, tooltip) {
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    tooltip.style.left = `${rect.left + rect.width / 2 - tooltipRect.width / 2}px`;
    tooltip.style.top = `${rect.top - tooltipRect.height - 8}px`;
    tooltip.style.opacity = '1';
  }

  hideTooltip(tooltip) {
    tooltip.style.opacity = '0';
  }

  // Accessibility
  setupAccessibility() {
    // Add ARIA labels
    this.addAriaLabels();

    // Setup focus management
    this.setupFocusManagement();

    // Add skip links
    this.addSkipLinks();
  }

  addAriaLabels() {
    // Add ARIA labels to interactive elements
    document.querySelectorAll('button, input, select, textarea').forEach(element => {
      if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) {
        const label = element.getAttribute('data-tooltip') ||
                     element.getAttribute('title') ||
                     element.textContent?.trim();
        if (label) {
          element.setAttribute('aria-label', label);
        }
      }
    });
  }

  setupFocusManagement() {
    // Trap focus in modals
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        const modal = document.querySelector('.modal:not([hidden])');
        if (modal) {
          this.trapFocus(event, modal);
        }
      }
    });
  }

  trapFocus(event, container) {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === firstElement) {
        lastElement.focus();
        event.preventDefault();
      }
    } else {
      if (document.activeElement === lastElement) {
        firstElement.focus();
        event.preventDefault();
      }
    }
  }

  addSkipLinks() {
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Skip to main content';
    skipLink.className = 'skip-link';
    skipLink.style.cssText = `
      position: absolute;
      top: -40px;
      left: 0;
      background: var(--primary-color, #007bff);
      color: white;
      padding: 8px;
      text-decoration: none;
      z-index: 10000;
      transition: top ${this.animationDuration}ms ease;
    `;

    skipLink.addEventListener('focus', () => {
      skipLink.style.top = '0';
    });

    skipLink.addEventListener('blur', () => {
      skipLink.style.top = '-40px';
    });

    document.body.insertBefore(skipLink, document.body.firstChild);
  }

  // Animations
  setupAnimations() {
    // Add smooth transitions to panels
    document.querySelectorAll('.panel').forEach(panel => {
      panel.style.transition = `opacity ${this.animationDuration}ms ease, transform ${this.animationDuration}ms ease`;
    });

    // Add hover effects to interactive elements
    document.querySelectorAll('button, .log-row, .session-item').forEach(element => {
      element.style.transition = `background-color ${this.animationDuration}ms ease, transform ${this.animationDuration}ms ease`;
    });
  }

  // Utility functions
  debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }

  throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // Cleanup
  destroy() {
    this.tooltips.forEach((tooltip, element) => {
      tooltip.remove();
    });
    this.tooltips.clear();
    this.shortcuts.clear();
  }
}

// Utility function to create UI enhancements
export function createUIEnhancements(options = {}) {
  return new UIEnhancements(options);
}

// Utility function to initialize UI enhancements
export function initUIEnhancements(options = {}) {
  const enhancements = createUIEnhancements(options);

  // Make available globally for debugging
  if (typeof window !== 'undefined') {
    window.xlogUIEnhancements = enhancements;
  }

  return enhancements;
}

// Auto-initialize if in browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initUIEnhancements();
    });
  } else {
    initUIEnhancements();
  }
}