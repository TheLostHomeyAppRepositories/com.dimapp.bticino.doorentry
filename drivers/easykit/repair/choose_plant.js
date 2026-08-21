'use strict';

(function () {
  const container = document.getElementById('options');
  const confirmBtn = document.getElementById('confirm-btn');
  const hiddenInput = document.getElementById('selected-radio-id');

  let selectedId = null;

  function renderOptions(options) {
    container.innerHTML = '';
    if (!Array.isArray(options) || options.length === 0) {
      container.innerHTML = '<p data-i18n="pair.choose_plant.no_plants"></p>';
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    options.forEach((opt, index) => {
      const id = String(opt.id || opt.value || opt._id || index);
      const labelText = opt.label || opt.name || opt.title || id;

      const label = document.createElement('label');
      label.className = 'homey-form-radio';

      const input = document.createElement('input');
      input.className = 'homey-form-radio-input';
      input.type = 'radio';
      input.name = 'plant-selection';
      input.value = id;
      if (index === 0) {
        input.checked = true;
        selectedId = id;
        if (hiddenInput) hiddenInput.value = id;
      }

      input.addEventListener('change', () => {
        if (input.checked) {
          selectedId = input.value;
          if (hiddenInput) hiddenInput.value = selectedId;
          if (confirmBtn) confirmBtn.disabled = false;
          if (typeof Homey !== 'undefined' && Homey && typeof Homey.emit === 'function') {
            Homey.emit('optionSelected', { id: selectedId });
          }
        }
      });

      const checkmark = document.createElement('span');
      checkmark.className = 'homey-form-radio-checkmark';

      const textSpan = document.createElement('span');
      textSpan.className = 'homey-form-radio-text';
      textSpan.textContent = labelText;

      label.appendChild(input);
      label.appendChild(checkmark);
      label.appendChild(textSpan);

      container.appendChild(label);
    });

    if (confirmBtn) {
      confirmBtn.disabled = !selectedId;
    }

    if (selectedId && typeof Homey !== 'undefined' && Homey && typeof Homey.emit === 'function') {
      Homey.emit('optionSelected', { id: selectedId });
    }
  }

  if (typeof Homey !== 'undefined' && Homey && typeof Homey.on === 'function') {
    Homey.on('dataOptions', function (data) {
      const options = data && data.options ? data.options : [];
      renderOptions(options);
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      if (!selectedId) return;
      try {
        if (typeof Homey !== 'undefined' && Homey && typeof Homey.showView === 'function') {
          await Homey.showView('register_device');
        } else if (typeof Homey !== 'undefined' && Homey && typeof Homey.nextView === 'function') {
          await Homey.nextView();
        }
      } catch (e) {
        console.error('Error proceeding after plant selection:', e);
      }
    });
  }
})();
