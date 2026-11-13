// Info tips: a small (i) button whose explanation opens on hover (mouse), on keyboard
// focus, or on a tap (touch screens have no hover). The text stays in the page as a
// role="tooltip" element that the button points to, so screen readers can reach it.
//
// Markup (written in index.html, or built with tip()):
//   <span class="tip">
//     <button type="button" class="tip-btn" aria-label="About …" aria-describedby="x" aria-expanded="false">…</button>
//     <span class="tip-text" role="tooltip" id="x">…</span>
//   </span>

import { el, icon } from './dom.js';

let nextId = 0;

/** A tip for content built in script. `align: 'end'` opens it leftwards, for tips near the right edge. */
export function tip(label, children, { align = 'start' } = {}) {
    const id = `tip-${++nextId}`;
    return el('span', { class: align === 'end' ? 'tip tip-end' : 'tip' },
        el('button', { type: 'button', class: 'tip-btn', 'aria-label': label, 'aria-describedby': id, 'aria-expanded': 'false' }, icon('info')),
        el('span', { class: 'tip-text', role: 'tooltip', id }, children));
}

function setOpen(tipNode, open) {
    tipNode.classList.toggle('is-open', open);
    tipNode.querySelector('.tip-btn')?.setAttribute('aria-expanded', String(open));
}

const closeAll = (except = null) => {
    for (const node of document.querySelectorAll('.tip.is-open')) if (node !== except) setOpen(node, false);
};

/** One set of listeners for every tip on the page, including ones rendered later. */
export function initTips() {
    document.addEventListener('click', (event) => {
        const button = event.target.closest('.tip-btn');
        if (!button) {
            if (!event.target.closest('.tip-text')) closeAll();
            return;
        }
        const node = button.closest('.tip');
        closeAll(node);
        setOpen(node, !node.classList.contains('is-open'));
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAll();
    });
}
