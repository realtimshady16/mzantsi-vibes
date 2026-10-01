/**
 * Mzantsi Vibes — contribute form.
 *
 * No GitHub account, no token, no editor. The form loads the real section list
 * from the Worker, posts to /api/submit, and shows the resulting PR link.
 */

(function () {
  'use strict';

  var form = document.getElementById('contributeForm');
  var sectionSelect = document.getElementById('section');
  var sectionsNote = document.getElementById('sectionsNote');
  var newSectionWrap = document.getElementById('newSectionWrap');
  var newSectionName = document.getElementById('newSectionName');
  var editFields = document.getElementById('editFields');
  var newFields = document.getElementById('newFields');
  var originalInput = document.getElementById('original');
  var editReplacement = document.getElementById('editReplacement');
  var contentInput = document.getElementById('content');
  var handleInput = document.getElementById('handle');
  var submitBtn = document.getElementById('submitBtn');
  var statusBox = document.getElementById('status');

  var NEW_SECTION = 'new';
  var LIMITS = { content: 4000, original: 2000, handle: 60 };

  /* If /api/sections is unreachable the form still works, but the list may be
   * behind the README. The Worker validates the choice and says so clearly. */
  var FALLBACK_GROUPS = [
    { pillar: "I'm Going to Study", sections: ['Before You Apply', 'Paying for It', 'Getting There', 'While You Are There', 'After Your Degree'] },
    { pillar: "I'm Going to Work", sections: ['Getting Work-Ready', 'Finding Work', 'Starting Something', 'Understanding Your Money'] },
    { pillar: "I Don't Know Yet", sections: ['Things you can do right now'] },
    { pillar: 'For Everyone', sections: ['How Do I Adult?', 'Mental Health 101', 'Being Healthy 101', 'Book Summaries', 'TED Talks & Speeches'] },
  ];

  function currentFlow() {
    var checked = form.querySelector('input[name="flow"]:checked');
    return checked ? checked.value : 'new';
  }

  function setStatus(message, kind) {
    statusBox.className = 'status-box ' + kind;
    statusBox.innerHTML = message;
  }

  function clearStatus() {
    statusBox.className = 'status-box hidden';
    statusBox.innerHTML = '';
  }

  function currentGroup() {
    var value = sectionSelect.value;
    if (!value || value.indexOf(NEW_SECTION + '::') !== 0) return null;
    return value.slice(NEW_SECTION.length + 2);
  }

  /* --- flow switching --- */
  function applyFlow() {
    var isEdit = currentFlow() === 'edit';
    editFields.hidden = !isEdit;
    newFields.hidden = isEdit;
    originalInput.required = isEdit;
    editReplacement.required = isEdit;
    contentInput.required = !isEdit;
    updateCounters();
  }

  /* --- section list --- */
  function buildSectionList(groups, degraded) {
    sectionSelect.innerHTML = '';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a section…';
    sectionSelect.appendChild(placeholder);

    groups.forEach(function (group) {
      var optgroup = document.createElement('optgroup');
      optgroup.label = group.pillar;

      group.sections.forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        optgroup.appendChild(opt);
      });

      var add = document.createElement('option');
      add.value = NEW_SECTION + '::' + group.pillar;
      add.textContent = '+ New section under “' + group.pillar + '”';
      optgroup.appendChild(add);

      sectionSelect.appendChild(optgroup);
    });

    if (degraded) {
      sectionsNote.textContent =
        'Showing a saved copy of the sections — the live list could not be reached. ' +
        'If your section is missing, reload the page in a moment.';
    } else {
      sectionsNote.textContent = 'These are the live sections from the README right now.';
    }
  }

  function onSectionChange() {
    var isNewSection = sectionSelect.value.indexOf(NEW_SECTION + '::') === 0;
    newSectionWrap.classList.toggle('hidden', !isNewSection);
    newSectionName.required = isNewSection && currentFlow() !== 'edit';
    clearStatus();
  }

  function loadSections() {
    fetch('/api/sections', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('bad status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.groups) || !data.groups.length) {
          throw new Error('no groups');
        }
        buildSectionList(data.groups, false);
        sectionSelect.disabled = false;
      })
      .catch(function () {
        buildSectionList(FALLBACK_GROUPS, true);
        sectionSelect.disabled = false;
      });
  }

  /* --- character counters --- */
  var counters = [];

  function paintCounter(entry) {
    var len = entry.input.value.length;
    entry.counter.textContent = len + ' / ' + entry.max;
    entry.counter.classList.toggle('over', len > entry.max);
  }

  function updateCounters() {
    counters.forEach(paintCounter);
  }

  function addCounter(input, max) {
    var counter = document.createElement('span');
    counter.className = 'counter';
    counter.setAttribute('aria-hidden', 'true');
    // Inside an editor the textarea is hidden in rich mode, so hang the counter off the whole editor.
    (input.closest('.editor') || input).insertAdjacentElement('afterend', counter);

    var entry = { input: input, counter: counter, max: max };
    counters.push(entry);

    input.addEventListener('input', function () { paintCounter(entry); });
    paintCounter(entry);
  }

  /* --- rich text / markdown editors ---
   * Each content field is a Quill editor plus its original <textarea>. The
   * textarea always holds the markdown and is what gets submitted, so the
   * counters, validation and payload code do not care which mode was used.
   * If the editor libraries fail to load, the field falls back to markdown. */
  var converter =
    window.createConverter && window.TurndownService && window.marked && window.Quill
      ? window.createConverter(window.TurndownService, window.marked)
      : null;
  var editors = {};

  function setupEditor(root) {
    var key = root.getAttribute('data-editor');
    var textarea = root.querySelector('textarea');
    var tabs = Array.prototype.slice.call(root.querySelectorAll('.editor-tab'));
    var panes = Array.prototype.slice.call(root.querySelectorAll('.editor-pane'));
    var quill = null;
    var api = { mode: 'markdown' };

    function showPane(mode) {
      api.mode = mode;
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-mode') === mode;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach(function (pane) {
        pane.hidden = pane.getAttribute('data-pane') !== mode;
      });
    }

    if (!converter) {
      // Libraries did not load: markdown only, and no tabs to confuse anyone.
      root.querySelector('.editor-tabs').hidden = true;
      showPane('markdown');
      editors[key] = api;
      return;
    }

    quill = new window.Quill(root.querySelector('.editor-rich'), {
      theme: 'snow',
      placeholder: textarea.getAttribute('data-rich-placeholder') || 'Write it here…',
      // Only what the site can show: bold, italic, links and bullets.
      formats: ['bold', 'italic', 'link', 'list'],
      modules: { toolbar: ['bold', 'italic', 'link', { list: 'bullet' }, 'clean'] },
    });

    quill.on('text-change', function (_delta, _old, source) {
      if (source === 'silent') return;
      textarea.value = quill.getText().trim() ? converter.htmlToMarkdown(quill.root.innerHTML) : '';
      textarea.dispatchEvent(new Event('input')); // repaint the counter
    });

    function loadIntoQuill() {
      var md = textarea.value;
      quill.setContents(md.trim() ? quill.clipboard.convert(converter.markdownToHtml(md)) : [], 'silent');
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var next = tab.getAttribute('data-mode');
        if (next === api.mode) return;
        if (next === 'richtext') loadIntoQuill();
        showPane(next);
      });
    });

    // form.reset() clears the textarea but knows nothing about Quill.
    api.refresh = function () { if (api.mode === 'richtext') loadIntoQuill(); };

    editors[key] = api;
    showPane('richtext');
  }

  function activeFormat() {
    var ed = editors[currentFlow() === 'edit' ? 'editReplacement' : 'content'];
    return ed && ed.mode === 'richtext' ? 'richtext' : 'markdown';
  }

  /* --- submit --- */
  function onSubmit(event) {
    event.preventDefault();
    clearStatus();

    var flow = currentFlow();
    var pillar = currentGroup();

    /* The selected <option> lives inside an <optgroup> labelled with the
     * pillar, so recover the pillar from the DOM rather than encoding it in
     * the value for existing sections. */
    if (!pillar && sectionSelect.selectedIndex >= 0) {
      var group = sectionSelect.options[sectionSelect.selectedIndex].parentNode;
      if (group && group.tagName === 'OPTGROUP') pillar = group.label;
    }

    if (!sectionSelect.value) {
      setStatus('Please choose which section this belongs to.', 'warning');
      return;
    }
    if (!pillar) {
      setStatus('Could not work out which part of the site that is. Please reload and try again.', 'error');
      return;
    }
    if (flow === 'new' && sectionSelect.value.indexOf(NEW_SECTION + '::') === 0 && !newSectionName.value.trim()) {
      setStatus('Please give your new section a name.', 'warning');
      return;
    }
    if (flow === 'edit' && !originalInput.value.trim()) {
      setStatus('Please paste the text that needs fixing.', 'warning');
      return;
    }

    var body = flow === 'edit' ? editReplacement : contentInput;
    if (!body.value.trim()) {
      setStatus('Please write what you want to add or change.', 'warning');
      return;
    }

    var payload = {
      flow: flow,
      format: activeFormat(),
      pillar: pillar,
      // The select's value for "+ New section" is 'new::<pillar>' (that is how the
      // pillar is recovered above); the Worker wants plain 'new'.
      section: sectionSelect.value.indexOf(NEW_SECTION + '::') === 0 ? NEW_SECTION : sectionSelect.value,
      content: flow === 'edit' ? editReplacement.value : contentInput.value,
      handle: handleInput.value,
      website: document.getElementById('website').value,
    };
    if (flow === 'edit') payload.original = originalInput.value;
    if (sectionSelect.value.indexOf(NEW_SECTION + '::') === 0) {
      payload.newSectionName = newSectionName.value;
    }

    submitBtn.classList.add('is-busy');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    setStatus('Opening your pull request…', 'info');

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data || {} };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          throw new Error(result.data.error || 'Submission failed. Please try again.');
        }

        var d = result.data;

        // Reset first: onSectionChange() clears the status box, which would
        // wipe the success message before anyone could read it.
        form.reset();
        applyFlow();
        onSectionChange();
        updateCounters();

        if (!d.prUrl) {
          setStatus('Thanks — that went through.', 'success');
          return;
        }

        setStatus(
          '🎉 <span class="pr-number">Pull request #' + d.prNumber + ' opened!</span><br />' +
            'A maintainer reviews it daily, and approved changes go live that evening. ' +
            'You can watch it here:<br />' +
            '<a href="' + d.prUrl + '" target="_blank" rel="noopener">' + d.prUrl + '</a>',
          'success'
        );
      })
      .catch(function (err) {
        setStatus(err.message, 'error');
      })
      .then(function () {
        submitBtn.classList.remove('is-busy');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send it in';
      });
  }

  /* --- init --- */
  document.addEventListener('DOMContentLoaded', function () {
    addCounter(contentInput, LIMITS.content);
    addCounter(editReplacement, LIMITS.content);
    addCounter(originalInput, LIMITS.original);
    addCounter(handleInput, LIMITS.handle);
    addCounter(newSectionName, 80);

    Array.prototype.forEach.call(form.querySelectorAll('input[name="flow"]'), function (radio) {
      radio.addEventListener('change', function () {
        applyFlow();
        onSectionChange();
      });
    });

    Array.prototype.forEach.call(form.querySelectorAll('.editor'), setupEditor);
    form.addEventListener('reset', function () {
      setTimeout(function () {
        Object.keys(editors).forEach(function (k) { if (editors[k].refresh) editors[k].refresh(); });
      }, 0);
    });

    sectionSelect.addEventListener('change', onSectionChange);
    form.addEventListener('submit', onSubmit);

    applyFlow();
    loadSections();
  });
})();
