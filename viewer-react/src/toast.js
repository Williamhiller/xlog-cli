let container = null;

function getContainer() {
  if (container && container.parentNode) {
    return container;
  }

  container = document.createElement("div");
  container.id = "xlog-toast-container";
  document.body.appendChild(container);
  return container;
}

export function showToast(text, type = "success") {
  const box = getContainer();

  const toast = document.createElement("div");
  toast.className = `xlog-toast xlog-toast--${type}`;
  toast.textContent = text;
  box.appendChild(toast);

  while (box.children.length > 3) {
    box.removeChild(box.firstChild);
  }

  setTimeout(() => {
    toast.classList.add("is-out");
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 220);
  }, 2500);
}
