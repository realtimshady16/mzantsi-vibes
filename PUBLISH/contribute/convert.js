/**
 * Rich text <-> markdown, for the contribute form.
 *
 * The form lets people write in either a rich text editor (Quill) or raw
 * markdown. Whatever they used, the markdown textarea is the source of truth
 * and is what gets submitted; this module is the bridge between the two.
 *
 * The Worker runs src/readme.js normalizeMarkdown() over the result, so the
 * two ends agree on the final shape: `-   [Name](url) — description`.
 *
 * Takes the libraries as arguments so it works in the browser (globals) and in
 * Node tests (npm packages) without a bundler.
 */
(function (root) {
  'use strict';

  function createConverter(TurndownService, markedLib) {
    var turndown = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });

    // The site manages its own headings, and the Worker rejects any submitted
    // line starting with #. Flatten headings to plain text instead of letting
    // a pasted heading turn into a rejection the contributor cannot see why.
    turndown.addRule('flattenHeadings', {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      replacement: function (content) {
        return '\n\n' + content.replace(/[*_]/g, '').trim() + '\n\n';
      },
    });

    // Images and rules can't be shown by the site's resource list, and "---"
    // is reserved. Drop them rather than write something that never renders.
    turndown.addRule('dropImages', { filter: ['img', 'hr'], replacement: function () { return ''; } });
    turndown.remove(['script', 'style']);

    function htmlToMarkdown(html) {
      return turndown
        .turndown(String(html || ''))
        .replace(/ /g, ' ')
        .split('\n')
        .map(function (line) { return line.replace(/\s+$/, ''); })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function markdownToHtml(md) {
      // Escape raw HTML first: the result is pasted into an editable element,
      // and typed markdown has no business carrying live tags into it.
      var safe = String(md || '').replace(/</g, '&lt;');
      return markedLib.parse(safe, { gfm: true, breaks: false });
    }

    return { htmlToMarkdown: htmlToMarkdown, markdownToHtml: markdownToHtml };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createConverter: createConverter };
  else root.createConverter = createConverter;
})(typeof self !== 'undefined' ? self : this);
