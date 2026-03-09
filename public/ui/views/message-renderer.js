/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Message Renderer
   ═══════════════════════════════════════════════════════════════════
   Main message rendering: ChatView class, _appendMessage(),
   _createMessageElement(), message type handling (user, assistant, system, tool)

   Dependencies: engine.js, marked.js (global)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';
import { renderMarkdown, looksLikeMarkdown, looksLikePlan } from './markdown-handler.js';

export class ChatView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket = opts.socket || null;
        this._messagesEl = null;
        this._inputEl = null;
        this._scrollLocked = true;
        this._isProcessing = false;
        this._msgCounter = 0;
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() {
        this._mounted = true;
        this._messagesEl = this.$('.chat-messages') || this.$('#messages');
        this._inputEl = this.$('#chat-input') || this.$('textarea');
        this._setupScrollListener();
        this._subscribeEvents();
    }

    // ── Event subscriptions ──────────────────────────────────────

    _subscribeEvents() {
        const sub = (evt, fn) => {
            this._subs.push(OverlordUI.subscribe(evt, fn.bind(this)));
        };

        sub('message_add', this._handleMessageAdd);
        sub('stream_start', this._handleStreamStart);
        sub('stream_update', this._handleStreamUpdate);
        sub('messages_cleared', () => {
            if (this._messagesEl) this._messagesEl.textContent = '';
        });
        sub('conversation_loaded', (data) => {
            if (this._messagesEl) this._messagesEl.textContent = '';
            if (data && data.messages) {
                data.messages.forEach(m => {
                    const text = this._parseMessageContent(m.content);
                    if (text && text.trim()) this._addMessage(m.role, m.content);
                });
            }
        });
        sub('conversation_new', () => {
            if (this._messagesEl) this._messagesEl.textContent = '';
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  SCROLL MANAGEMENT
    // ══════════════════════════════════════════════════════════════

    _setupScrollListener() {
        if (!this._messagesEl) return;
        const handler = () => this._checkScrollLock();
        this._messagesEl.addEventListener('scroll', handler, { passive: true });
        this._listeners.push(() => this._messagesEl.removeEventListener('scroll', handler));
    }

    _checkScrollLock() {
        if (!this._messagesEl) return;
        const el = this._messagesEl;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        this._scrollLocked = dist < 150;
        const btn = document.getElementById('scroll-to-bottom-btn');
        if (btn) btn.style.display = this._scrollLocked ? 'none' : 'flex';
    }

    _scrollToBottom(smooth = true) {
        if (!this._messagesEl) return;
        this._messagesEl.scrollTo({
            top: this._messagesEl.scrollHeight,
            behavior: smooth ? 'smooth' : 'instant'
        });
        this._scrollLocked = true;
        const btn = document.getElementById('scroll-to-bottom-btn');
        if (btn) btn.style.display = 'none';
    }

    _autoScroll() {
        if (this._scrollLocked) {
            this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
        } else {
            const btn = document.getElementById('scroll-to-bottom-btn');
            if (btn) btn.style.display = 'flex';
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  MESSAGE RENDERING
    // ══════════════════════════════════════════════════════════════

    /**
     * Add a new message to the chat
     */
    _addMessage(role, content, opts = {}) {
        if (!this._messagesEl) return;
        const { images, isPlan, hotInjected } = opts;
        const text = this._cleanPlanJSON(this._parseMessageContent(content));

        const msgIndex = this._msgCounter++;
        const isUser = role === 'user';
        const roleLabel = isUser
            ? (hotInjected ? 'HOT INJECT' : 'USER')
            : role === 'assistant' ? 'Overlord' : role;

        const div = this._createMessageElement({
            role,
            roleLabel,
            text,
            msgIndex,
            isUser,
            isPlan,
            hotInjected,
            images
        });

        this._messagesEl.appendChild(div);
        this._autoScroll();
    }

    /**
     * Create a complete message element
     */
    _createMessageElement({ role, roleLabel, text, msgIndex, isUser, isPlan, hotInjected, images }) {
        const div = h('div', {
            class: 'message ' + role +
                   (hotInjected ? ' hot-injected' : '') +
                   ((isPlan || looksLikePlan(text)) ? ' plan-message' : ''),
            'data-raw': text,
            'data-msg-index': String(msgIndex),
            'data-msg-role': role,
            'data-stream-complete': '1'
        });

        // Role label
        div.appendChild(h('div', { class: 'role' }, roleLabel));

        // Content area
        const contentEl = h('div', { class: 'content' });

        // Image pills
        if (images && images.length > 0) {
            contentEl.appendChild(this._buildImagePills(images, msgIndex));
        }

        // Rendered markdown body
        const bodyHtml = renderMarkdown(text);
        OverlordUI.setTrustedContent(contentEl, bodyHtml);
        div.appendChild(contentEl);

        // Copy/action wrap
        div.appendChild(this._buildActionWrap(isUser));

        return div;
    }

    _parseMessageContent(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .filter(b => typeof b === 'string' || (b && b.text))
                .map(b => typeof b === 'string' ? b : b.text)
                .join('\n\n');
        }
        if (content && content.content) return content.content;
        if (content) return String(content);
        return '';
    }

    /**
     * Build image pills for attachments
     */
    _buildImagePills(images, msgIndex) {
        const container = h('div', { class: 'image-pills' });
        images.forEach((img) => {
            const name = img.name || (img.path || '').split(/[/\\]/).pop();
            const thumbUrl = '/uploads/' + (img.path || '').split(/[/\\]/).pop();
            const displayName = name.length > 22
                ? name.substring(0, 22) + '...'
                : name;
            const sizeStr = img.size || '';
            const typeStr = img.type ? img.type.split('/').pop().toUpperCase() : '';
            const meta = [sizeStr, typeStr].filter(Boolean).join(' \u00b7 ');

            const pill = h('div', { class: 'message-image-pill' },
                h('img', { src: thumbUrl, alt: '' }),
                h('div', { class: 'pill-info' },
                    h('span', { class: 'pill-name' }, displayName),
                    meta ? h('span', { class: 'pill-meta' }, meta) : null
                )
            );
            pill.addEventListener('click', () => {
                if (typeof window.showImagePreview === 'function') {
                    window.showImagePreview(img);
                }
            });
            container.appendChild(pill);
        });
        return container;
    }

    /**
     * Build the action wrap (copy, menu)
     */
    _buildActionWrap(isUser) {
        const wrap = h('div', { class: 'msg-copy-wrap' });

        wrap.appendChild(h('button', {
            class: 'msg-copy-btn',
            'data-chat-action': 'copy-md',
            title: 'Copy message'
        }, '\u2398'));

        wrap.appendChild(h('button', {
            class: 'msg-copy-arrow',
            title: 'Message actions'
        }, '\u25be'));

        const menu = h('div', { class: 'msg-copy-menu' });
        menu.appendChild(h('button', { 'data-chat-action': 'copy-md' }, 'Copy as Markdown'));
        menu.appendChild(h('button', { 'data-chat-action': 'copy-text' }, 'Copy as Plain Text'));

        if (isUser) {
            menu.appendChild(h('hr', { style: 'border-color:rgba(255,255,255,0.08);margin:3px 0;' }));
            menu.appendChild(h('button', { 'data-chat-action': 'resend' }, 'Resend'));
            menu.appendChild(h('button', { 'data-chat-action': 'edit' }, 'Edit & Resend'));
        }

        menu.appendChild(h('hr', { style: 'border-color:rgba(255,255,255,0.08);margin:3px 0;' }));
        menu.appendChild(h('button', { 'data-chat-action': 'fork' }, 'New Chat From Here'));
        menu.appendChild(h('button', {
            'data-chat-action': 'delete',
            style: 'color:var(--accent-red,#f85149);'
        }, 'Delete'));

        wrap.appendChild(menu);
        return wrap;
    }

    // ══════════════════════════════════════════════════════════════
    //  STREAMING
    // ══════════════════════════════════════════════════════════════

    _handleStreamStart() {
        if (!this._messagesEl) return;
        const last = this._messagesEl.lastElementChild;
        if (!last || !last.classList.contains('assistant') ||
            last.getAttribute('data-stream-complete') === '1') {
            const el = h('div', {
                class: 'message assistant',
                'data-streaming': '1'
            }, h('div', { class: 'content' }));
            this._messagesEl.appendChild(el);
            this._autoScroll();
        }
    }

    _handleStreamUpdate(text) {
        if (!this._messagesEl) return;
        let last = this._messagesEl.lastElementChild;

        if (!last || !last.classList.contains('assistant')) {
            const el = h('div', {
                class: 'message assistant',
                'data-streaming': '1'
            }, h('div', { class: 'content' }));
            this._messagesEl.appendChild(el);
            last = el;
        }

        const contentEl = last.querySelector('.content');
        if (contentEl) {
            const html = renderMarkdown(text);
            OverlordUI.setTrustedContent(contentEl, html);
            this._autoScroll();
        }
    }

    _handleMessageAdd(msg) {
        if (!this._messagesEl) return;
        const newContent = (typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content)).trim();
        const last = this._messagesEl.lastElementChild;

        if (msg.role !== 'assistant' && last &&
            last.getAttribute('data-streaming') === '1') {
            last.remove();
        }

        if (msg.role === 'assistant' && last &&
            last.classList.contains('assistant') &&
            last.getAttribute('data-streaming') === '1') {

            last.removeAttribute('data-streaming');
            last.setAttribute('data-stream-complete', '1');
            last.dataset.raw = newContent;
            last.dataset.msgIndex = String(this._msgCounter++);
            last.dataset.msgRole = 'assistant';

            if (looksLikePlan(newContent)) {
                last.classList.add('plan-message');
            }

            const contentEl = last.querySelector('.content');
            if (contentEl) {
                const html = renderMarkdown(newContent);
                OverlordUI.setTrustedContent(contentEl, html);
            }

            if (!last.querySelector('.msg-copy-wrap')) {
                last.appendChild(this._buildActionWrap(false));
            }
            if (!last.querySelector('.role')) {
                const roleEl = h('div', { class: 'role' }, 'Overlord');
                last.insertBefore(roleEl, last.firstChild);
            }

            requestAnimationFrame(() => this._autoScroll());
            return;
        }

        const lastContent = last?.querySelector('.content')?.textContent?.trim() || '';
        if (last && last.classList.contains('assistant') &&
            lastContent === newContent) {
            return;
        }

        this._addMessage(msg.role, msg.content, {
            isPlan: msg.isPlan,
            hotInjected: msg.hot_injected
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  UTILITIES
    // ══════════════════════════════════════════════════════════════

    /**
     * Strip raw plan JSON blocks from message text
     */
    _cleanPlanJSON(text) {
        if (!text) return text;

        const tryFormat = (jsonStr) => {
            try {
                const tasks = JSON.parse(jsonStr);
                if (!Array.isArray(tasks) || !tasks.length || !tasks[0].title) {
                    return null;
                }
                const rows = tasks.map((t, i) => {
                    const title = (t.title || '').trim().replace(/\|/g, '\\|');
                    const desc = String(t.description || '').trim()
                        .substring(0, 120).replace(/\|/g, '\\|') || '\u2014';
                    const pri = t.priority && t.priority !== 'normal'
                        ? t.priority : '\u2014';
                    return '| ' + (i + 1) + ' | ' + title +
                           ' | ' + desc + ' | ' + pri + ' |';
                }).join('\n');
                const header =
                    '| # | Task | Description | Priority |\n' +
                    '|---|------|-------------|----------|';
                return '\n\nPlan — ' + tasks.length +
                    ' task' + (tasks.length !== 1 ? 's' : '') +
                    ':\n\n' + header + '\n' + rows + '\n';
            } catch (_) { return null; }
        };

        text = text.replace(/```json\s*([\s\S]*?)```/gi, (match, inner) => {
            return tryFormat(inner.trim()) || match;
        });

        text = text.replace(
            /(\[\s*\{[\s\S]*?"title"[\s\S]*?\}\s*\])/g,
            (match, inner) => tryFormat(inner.trim()) || match
        );

        return text;
    }
}

export { ChatView as default } from './chat.js';
