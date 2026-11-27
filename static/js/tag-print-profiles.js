(() => {
  const form = document.querySelector('[data-label-settings]');
  const controls = form?.querySelector('[data-print-profiles]');
  if (!controls) return;

  const key = 'billing-tag-print-profiles-v1';
  const fields = ['paper_w', 'paper_h', 'rotate', 'left', 'right', 'top', 'bottom', 'x', 'y', 'gap'];
  const list = controls.querySelector('[data-profile-list]');
  const nameInput = controls.querySelector('[data-profile-name]');
  const status = controls.querySelector('[data-profile-status]');
  const load = controls.querySelector('[data-profile-load]');
  const remove = controls.querySelector('[data-profile-delete]');
  let profiles = [];

  function updateButtons() {
    load.disabled = remove.disabled = list.value === '';
  }

  function showProfiles(selectedName = '') {
    list.replaceChildren(new Option('Choose a profile', ''));
    profiles.forEach(profile => list.add(new Option(profile.name, profile.name)));
    list.value = selectedName;
    updateButtons();
  }

  function write(next, selectedName, message) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      profiles = next;
      showProfiles(selectedName);
      status.textContent = message;
    } catch {
      status.textContent = 'Could not save changes. Browser storage is unavailable.';
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved)) {
      profiles = saved.filter(profile => profile && typeof profile.name === 'string'
        && profile.name && profile.fields && typeof profile.fields === 'object').slice(0, 30);
    }
  } catch {
    status.textContent = 'Saved profiles could not be read. You can still adjust and print this preview.';
  }

  controls.querySelector('[data-profile-save]').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      status.textContent = 'Enter a name for this profile.';
      nameInput.focus();
      return;
    }
    const next = profiles.filter(profile => profile.name !== name);
    if (next.length >= 30) {
      status.textContent = 'Remove a profile before saving another.';
      return;
    }
    const inputs = fields.map(field => form.elements.namedItem(field));
    if (inputs.some(input => !input.reportValidity())) return;
    const settings = Object.fromEntries(inputs.map(input => [input.name, input.value]));
    write([...next, { name, fields: settings }], name, 'Printer settings saved on this device.');
  });

  list.addEventListener('change', updateButtons);
  load.addEventListener('click', () => {
    const profile = profiles.find(item => item.name === list.value);
    if (!profile) return;
    for (const field of fields) {
      const value = profile.fields[field];
      if (typeof value === 'string') form.elements.namedItem(field).value = value;
    }
    nameInput.value = profile.name;
    form.dispatchEvent(new Event('input', { bubbles: true }));
    status.textContent = 'Settings loaded. Update the preview before printing.';
  });
  remove.addEventListener('click', () => {
    write(profiles.filter(profile => profile.name !== list.value), '', 'Profile removed from this device.');
  });

  controls.hidden = false;
  showProfiles();
})();
