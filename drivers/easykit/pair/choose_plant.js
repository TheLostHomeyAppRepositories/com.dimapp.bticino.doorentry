'use strict';

(function () {
  const optionsContainer = document.getElementById('options');
  const hiddenField = document.getElementById('selected-radio-id');
  const confirmBtn = document.getElementById('confirm-btn');

  // disable confirm until an option is selected
  if (confirmBtn) {
    confirmBtn.classList.add('is-disabled');
    confirmBtn.setAttribute('aria-disabled', 'true');
  }

  // Create radio buttons dynamically.
  // Accepts either an array of strings or an array of objects { id, label }.
  function createRadioButtons(items) {
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';
    if (!Array.isArray(items)) return;

    console.log('createRadioButtons: creating', items.length, 'options');

    items.forEach((it, idx) => {
      const id = (typeof it === 'object' && it.id) ? String(it.id) : `opt-${idx}`;
      const labelText = (typeof it === 'object' && it.label) ? it.label : String(it);

      const label = document.createElement('label');
      label.className = 'homey-form-radio';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'choose_plant_radio';
      input.id = id;
      input.value = id;
      input.className = 'homey-form-radio-input';

      const checkmark = document.createElement('span');
      checkmark.className = 'homey-form-radio-checkmark';

      const text = document.createElement('span');
      text.className = 'homey-form-radio-text';
      text.textContent = labelText;

      // assemble label (input + checkmark + text)
      label.appendChild(input);
      label.appendChild(checkmark);
      label.appendChild(text);

      // change handler
      input.addEventListener('change', () => {
        if (hiddenField) hiddenField.value = id;
        if (confirmBtn) {
          confirmBtn.classList.remove('is-disabled');
          confirmBtn.setAttribute('aria-disabled', 'false');
        }
        try { Homey.emit('optionSelected', { id }); } catch (e) { /* ignore */ }
      });

      optionsContainer.appendChild(label);
    });
  }

  // Expose function for other scripts
  window.createRadioButtons = createRadioButtons;

  // Listen for data from backend: { options: [...] }
  if (typeof Homey !== 'undefined' && Homey && typeof Homey.on === 'function') {
    Homey.on('dataOptions', function (data) {
      console.log('dataOptions received', data);
      const opts = (data && data.options) ? data.options : [];
      createRadioButtons(opts);
    });
  }

  // Confirm button: emit selected id and rely on backend to show next view
  if (confirmBtn) confirmBtn.addEventListener('click', (ev) => {
    // prevent action when button is visually/semantically disabled
    if (confirmBtn.classList.contains('is-disabled') || confirmBtn.getAttribute('aria-disabled') === 'true') {
      ev && ev.preventDefault();
      return;
    }

    // const selected = hiddenField ? hiddenField.value : '';
    // console.log('choose_plant: Confirm clicked, selected=', selected);
    // if (typeof Homey !== 'undefined' && Homey && typeof Homey.emit === 'function'){
    //   Homey.emit('confirmOption', { id: selected })
    //     .then((res) => {
    //       console.log('choose_plant: confirmOption resolved with', res);
    //     })
    //     .catch((err) => {
    //       console.error('choose_plant: confirmOption failed', err);
    //     });
    // } else {
    //   console.warn('choose_plant: Homey.emit not available');
    // }
    // do not call Homey.nextView() here; backend will show the register_device view
    Homey.showView('register_device')

    if (confirmBtn) {
      confirmBtn.classList.add('is-disabled');
      confirmBtn.setAttribute('aria-disabled', 'true');
    }
  });

})();
