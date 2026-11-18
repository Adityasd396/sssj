/* Shared navigation, accessible lists and form submission feedback. */
(function () {
  'use strict';
  var saved = document.getElementById('saved-bill');
  if (saved && saved.dataset.key) {
    if (window.BillDraftStorage) BillDraftStorage.complete(saved.dataset.user, saved.dataset.key, location.pathname);
  }
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('main-nav');
  var backdrop = document.getElementById('nav-backdrop');
  function closeMenu() {
    if (!nav || !toggle) return;
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('menu-open');
  }
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      if (backdrop) backdrop.hidden = !open;
      document.body.classList.toggle('menu-open', open);
      if (open) { var first = nav.querySelector('[aria-current=page], a'); if(first) first.focus(); }
    });
    if (backdrop) backdrop.addEventListener('click', closeMenu);
    var closeButton = document.querySelector('[data-close-menu]');
    if(closeButton) closeButton.addEventListener('click', function(){ closeMenu(); toggle.focus(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Tab' && nav.classList.contains('open') && innerWidth <= 1100) {
        var items = Array.from(nav.querySelectorAll('a,button')).filter(function(el) { return el.getClientRects().length; });
        var first = items[0], last = items[items.length-1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      if (event.key === 'Escape' && nav.classList.contains('open')) {
        closeMenu(); toggle.focus();
      }
    });
    document.addEventListener('click', function (event) {
      if (!nav.contains(event.target) && !toggle.contains(event.target)) closeMenu();
    });
    window.addEventListener('resize', closeMenu);
  }

  document.querySelectorAll('[data-password-toggle]').forEach(function(button) {
    button.addEventListener('click', function() {
      var input = document.getElementById(button.dataset.passwordToggle);
      var show = input.type === 'password'; input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show'; button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  // Retain table semantics and headers; add visible field names to mobile cards.
  document.querySelectorAll('.table-wrap').forEach(function (wrap) {
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', wrap.getAttribute('aria-label') || 'Scrollable records');
    var table = wrap.querySelector('table');
    if (!table || wrap.dataset.layout === 'scroll' || table.querySelector('[colspan], [rowspan]')) return;
    var headers = Array.from(table.querySelectorAll('thead th'));
    if (!headers.length) return;
    headers.forEach(function (header) { header.setAttribute('scope', 'col'); });
    wrap.classList.add('mobile-cards');
    table.querySelectorAll('tbody tr').forEach(function (row) {
      Array.from(row.cells).forEach(function (cell, index) {
        if (headers[index]) cell.dataset.label = headers[index].textContent.trim();
      });
    });
  });

  document.querySelectorAll('input[type=number]').forEach(function (input) {
    input.inputMode = input.step === '1' ? 'numeric' : 'decimal';
  });
  document.querySelectorAll('input[name=phone]').forEach(function (input) {
    input.type = 'tel'; input.autocomplete = 'tel';
  });
  var errorCounter = 0;
  document.addEventListener('invalid', function (event) {
    var input = event.target;
    if (!input.matches('input, select, textarea')) return;
    input.setAttribute('aria-invalid', 'true');
    var id = input.dataset.errorMessage;
    var message = id ? document.getElementById(id) : null;
    if (!message) {
      message = document.createElement('span'); message.className = 'field-message';
      message.id = 'validation-message-' + (++errorCounter);
      input.dataset.errorMessage = message.id;
      input.dataset.previousDescription = input.getAttribute('aria-describedby') || '';
      input.setAttribute('aria-describedby', (input.dataset.previousDescription + ' ' + message.id).trim());
      input.insertAdjacentElement('afterend', message);
    }
    message.textContent = input.validationMessage;
  }, true);
  function clearFieldError(event) {
    var input = event.target;
    if (!input.dataset.errorMessage) return;
    var message = document.getElementById(input.dataset.errorMessage);
    if (message) message.remove();
    input.removeAttribute('aria-invalid');
    if (input.dataset.previousDescription) input.setAttribute('aria-describedby', input.dataset.previousDescription);
    else input.removeAttribute('aria-describedby');
    delete input.dataset.errorMessage; delete input.dataset.previousDescription;
  }
  document.addEventListener('input', clearFieldError);
  document.addEventListener('change', clearFieldError);
  document.querySelectorAll('.toolbar input[name=q]').forEach(function (input) {
    if (!input.labels.length) input.setAttribute('aria-label', input.placeholder || 'Search');
  });
  document.querySelectorAll('.toolbar select').forEach(function (select) {
    if (!select.labels.length) select.setAttribute('aria-label', select.name === 'sort' ? 'Sort records' : 'Filter records');
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form.querySelector('.nav-logout') && window.BillDraftStorage) BillDraftStorage.clear(document.body.dataset.user);
    if (form.hasAttribute('data-async')) return;
    if (event.defaultPrevented || form.method.toLowerCase() !== 'post') return;
    if (form.dataset.submitting === 'true') { event.preventDefault(); return; }
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
      event.preventDefault(); return;
    }
    if (!navigator.onLine) {
      showToast('Your device reports limited connectivity. Trying the shop connection…', 'warning');
    }
    form.dataset.submitting = 'true';
    form.setAttribute('aria-busy', 'true');
    Array.from(form.elements).filter(function (element) { return element.tagName === 'BUTTON' && element.type === 'submit'; }).forEach(function (button) {
      if (button.disabled || button.name) return;
      button.dataset.busyLabel = button.textContent;
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = 'Saving…';
    });
  });
  // Back/forward cache must never leave a form permanently disabled.
  window.addEventListener('pageshow', function () {
    document.querySelectorAll('form[data-submitting]').forEach(function (form) {
      delete form.dataset.submitting; form.removeAttribute('aria-busy');
    });
    document.querySelectorAll('[data-busy-label]').forEach(function (button) {
      button.disabled = false; button.classList.remove('is-busy');
      button.textContent = button.dataset.busyLabel; delete button.dataset.busyLabel;
    });
  });
  var banner = document.getElementById('connection-banner');
  function connectivity() { if (banner) banner.hidden = navigator.onLine; }
  window.addEventListener('online', connectivity);
  window.addEventListener('offline', connectivity);
  connectivity();


})();

function showToast(message, kind) {
  var box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  var toast = document.createElement('div'); toast.className = 'toast ' + (kind || 'success');
  var text = document.createElement('span'); text.textContent = message;
  var dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'x';
  dismiss.setAttribute('aria-label', 'Dismiss notification'); dismiss.textContent = '×';
  dismiss.addEventListener('click', function () { toast.remove(); });
  toast.append(text, dismiss); box.appendChild(toast);
  if (kind !== 'danger' && kind !== 'warning') setTimeout(function () { toast.remove(); }, 8000);
}
