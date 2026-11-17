export function setupSettings(trigger: HTMLButtonElement, panel: HTMLElement, closeButton: HTMLButtonElement) {
  const native = Object.hasOwn(HTMLElement.prototype, 'popover');
  let open = false;
  const reflect = (value: boolean) => { open = value; trigger.setAttribute('aria-expanded', String(value)); };
  const close = () => {
    if (!open) return;
    if (native) panel.hidePopover(); else panel.hidden = true;
    reflect(false); trigger.focus();
  };
  if (native) {
    panel.addEventListener('toggle', event => reflect((event as ToggleEvent).newState === 'open'));
  } else {
    // Older browsers retain the same fixed floating panel and Tab order.
    panel.removeAttribute('popover'); trigger.removeAttribute('popovertarget'); panel.hidden = true;
    trigger.addEventListener('click', () => {
      if (open) close();
      else { panel.hidden = false; reflect(true); panel.querySelector<HTMLButtonElement>('[autofocus]')?.focus(); }
    });
    document.addEventListener('pointerdown', event => {
      if (open && !panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
    });
  }
  closeButton.addEventListener('click', close);
  return { close, isOpen: () => open };
}
