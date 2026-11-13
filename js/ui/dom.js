// Tiny DOM helpers. Text always goes in through textContent / text nodes, never
// innerHTML, so place and station names from the network cannot inject markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(node, props) {
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.setAttribute('class', value);
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style') node.style.cssText = value; // not setAttribute: the CSP blocks style attributes
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value === true ? '' : value);
    }
}

function appendChildren(node, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

/** el('div', { class: 'card' }, child, 'text', ...) */
export function el(tag, props, ...children) {
    const node = document.createElement(tag);
    applyProps(node, props);
    appendChildren(node, children);
    return node;
}

export function svg(tag, props, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    applyProps(node, props);
    appendChildren(node, children);
    return node;
}

/** Reference to an icon from the SVG sprite in index.html. */
export function icon(name, className = 'icon') {
    return svg('svg', { class: className, 'aria-hidden': 'true', focusable: 'false' },
        svg('use', { href: `#i-${name}` }));
}

export const $ = (id) => document.getElementById(id);

export function setText(id, text) {
    const node = $(id);
    if (node && node.textContent !== text) node.textContent = text;
}
