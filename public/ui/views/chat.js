/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Chat View
   ═══════════════════════════════════════════════════════════════════
   The main chat interface. Handles message rendering, streaming,
   input, plan approval, thoughts bubbles, and message actions.

   Dependencies: engine.js, marked.js (global)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

export class ChatView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket = opts.socket || null;
        this._messagesEl = null;
        this._inputEl = null;
        this._scrollLocked = true;
        this._isProcessing = false;
        this._msgCounter = 0;
        this._thinkingTimers = new Map();
        this._hotInjectCount = 0;
        this._approvalToolId = null;
        this._planVariantState = { multiVariant: false, preferred: 'regular', active: 'regular' };
        this._attachedImages = [];
        this._scrollThreshold = 150;
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() {
        this._mounted = true;
        this._messagesEl = this.$('.chat-messages') || this.$('#messages');
        this._inputEl = this.$('#chat-input') || this.$('textarea');

        this._setupScrollListener();
        this._setupInputListeners();
        this._setupDelegatedActions();
        this._subscribeEvents();
    }

    // ── Event subscriptions ──────────────────────────────────────

    _subscribeEvents() {
        const sub = (evt, fn) => {
            this._subs.push(OverlordUI.subscribe(evt, fn.bind(this)));
        };

        // Messaging & streaming
        sub('message_add', this._handleMessageAdd);
        sub('stream_start', this._handleStreamStart);
        sub('stream_update', this._handleStreamUpdate);

        // Thoughts
        sub('neural_thought', this._handleNeuralThought);
        sub('thinking_done', this._handleThinkingDone);

        // Plan system
        sub('plan_ready', (d) => this._showPlanBar(d.taskCount, d));
        sub('plan_variant_switched', (d) => {
            const label = this.$('#plan-bar-label');
            if (label) {
                OverlordUI.setContent(label,
                    'Plan ready (' + d.variant + ') — ' + d.taskCount +
                    ' task' + (d.taskCount !== 1 ? 's' : '') + ' — review the task panel');
            }
            this._updateVariantTabs(d.variant);
        });
        sub('plan_cancelled_ack', () => this._hidePlanBar());
        sub('plan_approved_ack', () => this._hidePlanBar());
        sub('plan_timeout', () => this._hidePlanBar());

        // Conversation lifecycle
        sub('messages_cleared', () => {
            if (this._messagesEl) this._messagesEl.textContent = '';
        });
        sub('conversation_loaded', (data) => {
            if (this._messagesEl) this._messagesEl.textContent = '';
            if (data && data.messages) {
                data.messages.forEach(m => this._addMessage(m.role, m.content));
            }
        });
        sub('conversation_new', () => {
            if (this._messagesEl) this._messagesEl.textContent = '';
        });

        // Media
        sub('images_generated', (data) => this._appendGeneratedImages(data));
        sub('audio_ready', (data) => this._appendAudioPlayer(data));

        // Processing state
        sub('request_start', () => {
            this._isProcessing = true;
            this._updateSendButtonState();
            this._updateHotInjectBtn();
        });
        sub('request_end', () => {
            this._isProcessing = false;
            this._updateSendButtonState();
            this._updateHotInjectBtn();
        });

        // Hot inject
        sub('hot_inject_pending', (data) => {
            this._hotInjectCount = data.count || 0;
            this._updateHotInjectBtn();
        });
        sub('hot_inject_applied', () => {
            this._hotInjectCount = Math.max(0, this._hotInjectCount - 1);
            this._updateHotInjectBtn();
        });

        // Approval modal
        sub('approval_request', (data) => this._showApprovalModal(data));
        sub('approval_resolved', (data) => {
            if (data.toolId === this._approvalToolId) this._hideApprovalModal();
        });
        sub('approval_timeout', (data) => {
            if (data.toolId === this._approvalToolId) this._hideApprovalModal();
        });

        // Tool exception modal
        sub('tool_exception_request', (data) => this._showExceptionModal(data));
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
        this._scrollLocked = dist < this._scrollThreshold;
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

    /** Conditionally auto-scroll or show the scroll-to-bottom indicator. */
    _autoScroll() {
        if (this._scrollLocked) {
            this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
        } else {
            const btn = document.getElementById('scroll-to-bottom-btn');
            if (btn) btn.style.display = 'flex';
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  INPUT & SEND
    // ══════════════════════════════════════════════════════════════

    _setupInputListeners() {
        if (!this._inputEl) return;

        // Ctrl+Enter to send
        this._inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.send();
            }
            // Alt+Enter for hot inject
            if (e.key === 'Enter' && e.altKey) {
                e.preventDefault();
                this.hotInjectSend();
            }
        });
    }

    _setupDelegatedActions() {
        // Send button
        this.on('click', '#btn-send', () => this.send());

        // Cancel button
        this.on('click', '#btn-cancel', () => {
            if (this._socket) this._socket.emit('cancel');
        });

        // Scroll-to-bottom
        this.on('click', '#scroll-to-bottom-btn', () => this._scrollToBottom());

        // Hot inject button
        this.on('click', '#btn-hot-inject', () => this.hotInjectSend());

        // Plan bar buttons
        this.on('click', '#plan-approve-btn', () => this.approvePlan());
        this.on('click', '#plan-cancel-btn', () => this.cancelPlan());
        this.on('click', '#plan-revise-btn', () => this._showPlanRevise());

        // Variant tabs
        this.on('click', '.plan-variant-tab', (e, el) => {
            const variant = el.dataset.variant;
            if (variant) this._switchPlanVariant(variant);
        });

        // Copy menu toggle
        this.on('click', '.msg-copy-arrow', (e, el) => {
            const wrap = el.closest('.msg-copy-wrap');
            if (!wrap) return;
            const menu = wrap.querySelector('.msg-copy-menu');
            if (!menu) return;
            const visible = menu.style.display === 'block';
            this.$$('.msg-copy-menu').forEach(m => { m.style.display = 'none'; });
            menu.style.display = visible ? 'none' : 'block';
        });

        // Close copy menus on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.msg-copy-wrap')) {
                this.$$('.msg-copy-menu').forEach(m => { m.style.display = 'none'; });
            }
        });

        // Message action delegation
        this.on('click', '[data-chat-action]', (e, el) => {
            const action = el.dataset.chatAction;
            switch (action) {
                case 'copy-md':      this.copyMessage(el, 'markdown'); break;
                case 'copy-text':    this.copyMessage(el, 'text'); break;
                case 'resend':       this.resendMessage(el); break;
                case 'edit':         this.editMessage(el); break;
                case 'fork':         this.forkChatFromHere(el); break;
                case 'delete':       this.deleteMessage(el); break;
            }
        });

        // Approval modal buttons
        this.on('click', '#approval-approve-btn', () => this.respondApproval(true));
        this.on('click', '#approval-deny-btn', () => this.respondApproval(false));
    }

    send() {
        if (!this._inputEl) return;
        let text = this._inputEl.value.trim();
        if (!text) return;

        // Block send while plan bar is visible
        const planBar = document.getElementById('plan-approval-bar');
        if (planBar && planBar.classList.contains('visible')) {
            OverlordUI.dispatch('log', {
                message: 'A plan is awaiting approval. Use the plan bar first.',
                type: 'warning'
            });
            return;
        }

        // Include attached images
        if (this._attachedImages.length > 0) {
            const imgInfo = this._attachedImages.map(img =>
                'Image: ' + img.path +
                (img.exif ? ' [EXIF: ' + JSON.stringify(img.exif) + ']' : '')
            ).join('\n');
            text = text + '\n\n' + imgInfo;
        }

        this._inputEl.value = '';
        const imagesToSend = [...this._attachedImages];
        this._attachedImages = [];
        imagesToSend.forEach(img => {
            if (img.localThumb) URL.revokeObjectURL(img.localThumb);
        });

        if (this._socket) {
            this._socket.emit('user_input', text, imagesToSend);
        }
    }

    hotInjectSend() {
        if (!this._inputEl) return;
        const text = this._inputEl.value.trim();
        if (!text) return;
        this._inputEl.value = '';
        if (this._socket) {
            this._socket.emit('hot_inject', text, (ack) => {
                if (ack && ack.status === 'hot_queued') {
                    OverlordUI.dispatch('log', {
                        message: 'Hot inject queued — next cycle gap',
                        type: 'info'
                    });
                } else if (ack && ack.status === 'immediate') {
                    OverlordUI.dispatch('log', {
                        message: 'Hot inject sent immediately (AI idle)',
                        type: 'info'
                    });
                }
            });
        }
    }

    _updateSendButtonState() {
        const btn = this.$('#btn-send');
        if (!btn) return;
        btn.disabled = false;
        if (this._isProcessing) {
            btn.title = 'Send — message will be injected at next AI cycle boundary';
            btn.style.opacity = '0.85';
        } else {
            btn.title = 'Send message';
            btn.style.opacity = '';
        }
    }

    _updateHotInjectBtn() {
        const btn = this.$('#btn-hot-inject') || document.getElementById('btn-hot-inject');
        if (!btn) return;
        if (this._isProcessing) {
            btn.style.display = '';
            OverlordUI.setContent(btn,
                this._hotInjectCount > 0
                    ? 'Hot (' + this._hotInjectCount + ')'
                    : 'Hot'
            );
        } else {
            btn.style.display = 'none';
            this._hotInjectCount = 0;
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  MESSAGE RENDERING
    // ══════════════════════════════════════════════════════════════

    _addMessage(role, content, opts = {}) {
        if (!this._messagesEl) return;
        const { images, isPlan, hotInjected } = opts;
        const text = this._cleanPlanJSON(this._parseMessageContent(content));

        const msgIndex = this._msgCounter++;
        const isUser = role === 'user';
        const roleLabel = isUser
            ? (hotInjected ? 'HOT INJECT' : 'USER')
            : role === 'assistant' ? 'Assistant' : role;

        // Build message container
        const div = h('div', {
            class: 'message ' + role +
                   (hotInjected ? ' hot-injected' : '') +
                   ((isPlan || this._looksLikePlan(text)) ? ' plan-message' : ''),
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
        const bodyHtml = this._renderMarkdown(text);
        OverlordUI.setTrustedContent(contentEl, bodyHtml);
        div.appendChild(contentEl);

        // Copy/action wrap
        div.appendChild(this._buildActionWrap(isUser));

        this._messagesEl.appendChild(div);
        this._autoScroll();
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

    _renderMarkdown(text) {
        try {
            if (typeof marked !== 'undefined') {
                return marked.parse(text);
            }
        } catch (_) { /* fall through */ }
        return OverlordUI.escapeHtml(text);
    }

    _looksLikePlan(text) {
        return typeof text === 'string' &&
            (text.startsWith('Plan Approved') || text.includes('Plan ready'));
    }

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

    _buildActionWrap(isUser) {
        const wrap = h('div', { class: 'msg-copy-wrap' });

        // Primary copy button
        wrap.appendChild(h('button', {
            class: 'msg-copy-btn',
            'data-chat-action': 'copy-md',
            title: 'Copy message'
        }, '\u2398'));

        // Dropdown arrow
        wrap.appendChild(h('button', {
            class: 'msg-copy-arrow',
            title: 'Message actions'
        }, '\u25be'));

        // Dropdown menu
        const menu = h('div', { class: 'msg-copy-menu' });
        menu.appendChild(
            h('button', { 'data-chat-action': 'copy-md' }, 'Copy as Markdown')
        );
        menu.appendChild(
            h('button', { 'data-chat-action': 'copy-text' }, 'Copy as Plain Text')
        );

        if (isUser) {
            menu.appendChild(h('hr', {
                style: 'border-color:rgba(255,255,255,0.08);margin:3px 0;'
            }));
            menu.appendChild(
                h('button', { 'data-chat-action': 'resend' }, 'Resend')
            );
            menu.appendChild(
                h('button', { 'data-chat-action': 'edit' }, 'Edit & Resend')
            );
        }

        menu.appendChild(h('hr', {
            style: 'border-color:rgba(255,255,255,0.08);margin:3px 0;'
        }));
        menu.appendChild(
            h('button', { 'data-chat-action': 'fork' }, 'New Chat From Here')
        );
        menu.appendChild(
            h('button', {
                'data-chat-action': 'delete',
                style: 'color:var(--accent-red,#f85149);'
            }, 'Delete')
        );

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

        // Create placeholder if none exists (missed stream_start fallback)
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
            const html = this._renderMarkdown(text);
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

        // Remove orphaned streaming div if incoming is not assistant
        if (msg.role !== 'assistant' && last &&
            last.getAttribute('data-streaming') === '1') {
            last.remove();
        }

        // Finalize streaming assistant element in-place
        if (msg.role === 'assistant' && last &&
            last.classList.contains('assistant') &&
            last.getAttribute('data-streaming') === '1') {

            last.removeAttribute('data-streaming');
            last.setAttribute('data-stream-complete', '1');
            last.dataset.raw = newContent;
            last.dataset.msgIndex = String(this._msgCounter++);
            last.dataset.msgRole = 'assistant';

            if (this._looksLikePlan(newContent)) {
                last.classList.add('plan-message');
            }

            const contentEl = last.querySelector('.content');
            if (contentEl) {
                const html = this._renderMarkdown(newContent);
                OverlordUI.setTrustedContent(contentEl, html);
            }

            // Add action wrap if missing
            if (!last.querySelector('.msg-copy-wrap')) {
                last.appendChild(this._buildActionWrap(false));
            }
            // Add role label if missing
            if (!last.querySelector('.role')) {
                const roleEl = h('div', { class: 'role' }, 'Assistant');
                last.insertBefore(roleEl, last.firstChild);
            }

            requestAnimationFrame(() => this._autoScroll());
            return;
        }

        // Skip exact duplicates
        const lastContent = last?.querySelector('.content')?.textContent?.trim() || '';
        if (last && last.classList.contains('assistant') &&
            lastContent === newContent) {
            return;
        }

        // Add fresh message
        this._addMessage(msg.role, msg.content, {
            isPlan: msg.isPlan,
            hotInjected: msg.hot_injected
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  THOUGHTS BUBBLE
    // ══════════════════════════════════════════════════════════════

    _handleNeuralThought(thought) {
        if (!this._messagesEl) return;

        // Attach to last assistant message, creating one if needed
        let lastMsg = this._messagesEl.lastElementChild;
        if (!lastMsg || !lastMsg.classList.contains('assistant')) {
            const el = h('div', {
                class: 'message assistant',
                'data-streaming': '1'
            }, h('div', { class: 'content' }));
            this._messagesEl.appendChild(el);
            lastMsg = el;
            if (this._scrollLocked) {
                this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
            }
        }

        let bubble = lastMsg.querySelector('.thoughts-bubble');
        if (!bubble) {
            bubble = this._createThoughtsBubble();
            lastMsg.insertBefore(bubble, lastMsg.firstChild);
        }

        // Accumulate raw thought text
        const prev = bubble.getAttribute('data-thoughts') || '';
        const combined = prev + thought;
        bubble.setAttribute('data-thoughts', combined);

        // Render content
        const contentEl = bubble.querySelector('.tb-content');
        if (contentEl) this._renderThoughtsContent(contentEl, combined);

        // Live token count
        const badge = bubble.querySelector('.tb-badge');
        if (badge) {
            const tok = this._estimateTokens(combined);
            OverlordUI.setContent(badge, '~' + tok.toLocaleString() + ' tok');
            badge.style.display = 'inline';
        }

        // Auto-scroll expanded body
        const body = bubble.querySelector('.tb-body');
        if (body && bubble.classList.contains('tb-open')) {
            body.scrollTop = body.scrollHeight;
        }
    }

    _createThoughtsBubble() {
        const bId = 'thoughts-' + Date.now();
        const startTs = Date.now();

        const bubble = h('div', {
            class: 'thoughts-bubble is-streaming',
            id: bId,
            'data-thoughts': '',
            'data-start': String(startTs)
        });

        const header = h('div', { class: 'tb-header' });
        header.addEventListener('click', () => this.toggleThoughts(bId));

        header.appendChild(h('span', { class: 'tb-icon' }, '\ud83d\udcad'));

        const meta = h('span', { class: 'tb-meta' }, 'Thinking\u2026 0s');
        header.appendChild(meta);

        const badge = h('span', { class: 'tb-badge' });
        header.appendChild(badge);

        header.appendChild(h('span', { class: 'tb-chevron' }, '\u25b8'));

        const body = h('div', { class: 'tb-body' });
        body.appendChild(h('div', { class: 'tb-content' }));

        bubble.appendChild(header);
        bubble.appendChild(body);

        // Live timer: ticks every 100ms while is-streaming
        const timerId = setInterval(() => {
            if (!bubble.classList.contains('is-streaming')) {
                clearInterval(timerId);
                this._thinkingTimers.delete(bId);
                return;
            }
            const secs = ((Date.now() - startTs) / 1000).toFixed(1);
            OverlordUI.setContent(meta, 'Thinking\u2026 ' + secs + 's');
        }, 100);
        this._thinkingTimers.set(bId, timerId);

        return bubble;
    }

    _handleThinkingDone(data) {
        const bubbles = document.querySelectorAll('.thoughts-bubble.is-streaming');
        bubbles.forEach(bubble => {
            bubble.classList.remove('is-streaming');

            const bId = bubble.id;
            const timerId = this._thinkingTimers.get(bId);
            if (timerId) {
                clearInterval(timerId);
                this._thinkingTimers.delete(bId);
            }

            const start = parseInt(bubble.getAttribute('data-start') || '0', 10);
            const elapsed = start
                ? ((Date.now() - start) / 1000).toFixed(1)
                : null;

            const meta = bubble.querySelector('.tb-meta');
            const badge = bubble.querySelector('.tb-badge');

            if (meta) {
                OverlordUI.setContent(meta,
                    elapsed ? 'Reasoned for ' + elapsed + 's' : 'Reasoned');
            }

            if (badge && data) {
                const finalTok = data.chars
                    ? Math.ceil(data.chars / 3.5)
                    : (data.words ? Math.ceil(data.words * 1.33) : null);
                if (finalTok) {
                    OverlordUI.setContent(badge, finalTok.toLocaleString() + ' tok');
                    badge.style.display = 'inline';
                }
            }
        });
    }

    toggleThoughts(bubbleId) {
        const bubble = document.getElementById(bubbleId);
        if (!bubble) return;
        bubble.classList.toggle('tb-open');
        const body = bubble.querySelector('.tb-body');
        if (body && bubble.classList.contains('tb-open')) {
            body.scrollTop = body.scrollHeight;
        }
    }

    _estimateTokens(text) {
        return Math.max(1, Math.ceil(
            text.replace(/\x00CHIP:[^\x00]*\x00/g, '').length / 3.5
        ));
    }

    /**
     * Render thoughts content with embedded tool chip sentinels.
     * Chip sentinel format: \x00CHIP:{json}\x00
     */
    _renderThoughtsContent(container, raw) {
        const CHIP_RE = /\x00CHIP:(\{[\s\S]*?\})\x00/g;
        const parts = [];
        let lastIdx = 0;
        let m;
        while ((m = CHIP_RE.exec(raw)) !== null) {
            if (m.index > lastIdx) {
                parts.push({ t: 'text', v: raw.slice(lastIdx, m.index) });
            }
            parts.push({ t: 'chip', j: m[1] });
            lastIdx = m.index + m[0].length;
        }
        if (lastIdx < raw.length) {
            parts.push({ t: 'text', v: raw.slice(lastIdx) });
        }

        // Preserve existing chip elements by id
        const existing = {};
        container.querySelectorAll('.tc[data-tc-id]').forEach(c => {
            existing[c.dataset.tcId] = c;
        });

        container.textContent = '';
        const frag = document.createDocumentFragment();

        parts.forEach(part => {
            if (part.t === 'text' && part.v) {
                frag.appendChild(h('pre', { class: 'tb-text-seg' }, part.v));
            } else if (part.t === 'chip') {
                try {
                    const chip = JSON.parse(part.j);
                    if (chip.id && existing[chip.id]) {
                        frag.appendChild(existing[chip.id]);
                    } else {
                        frag.appendChild(this._createToolChipEl(chip));
                    }
                } catch (_) {
                    frag.appendChild(h('pre', { class: 'tb-text-seg' }, part.j));
                }
            }
        });

        container.appendChild(frag);
    }

    _createToolChipEl(chip) {
        const el = document.createElement('details');
        const isDelegate = chip.name === 'delegate_to_agent';
        el.className = 'tc' + (isDelegate ? ' tc-delegate' : '');
        const safeId = (chip.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        if (chip.id) el.dataset.tcId = chip.id;

        const sum = document.createElement('summary');
        const icon = isDelegate ? '\u2728' : '\u2699\ufe0f';

        sum.appendChild(h('span', { class: 'tc-chevron' }, '\u25b8'));
        sum.appendChild(h('span', { class: 'tc-icon' }, icon));
        sum.appendChild(h('span', { class: 'tc-name' }, chip.name || ''));
        sum.appendChild(h('span', { class: 'tc-param', id: 'tcp-' + safeId }));
        sum.appendChild(h('span', { class: 'tc-dur', id: 'tcd-' + safeId }));
        sum.appendChild(h('span', { class: 'tc-dot run', id: 'tcdot-' + safeId }));

        const body = h('div', { class: 'tc-body', id: 'tcbody-' + safeId });
        OverlordUI.setContent(body, h('span', {
            class: 'tc-lbl',
            style: 'opacity:0.4;'
        }, 'awaiting execution\u2026'));

        el.appendChild(sum);
        el.appendChild(body);
        return el;
    }

    // ══════════════════════════════════════════════════════════════
    //  PLAN APPROVAL BAR
    // ══════════════════════════════════════════════════════════════

    _showPlanBar(taskCount, variantData) {
        const bar = document.getElementById('plan-approval-bar');
        if (!bar) return;

        const label = bar.querySelector('#plan-bar-label');
        if (label) {
            OverlordUI.setContent(label,
                'Plan ready — ' + taskCount +
                ' task' + (taskCount !== 1 ? 's' : '') +
                ' — review the task panel');
        }

        bar.classList.add('visible');

        // Show/hide variant tabs
        const tabsEl = bar.querySelector('#plan-variant-tabs');
        if (variantData && variantData.multiVariant && tabsEl) {
            tabsEl.style.display = 'flex';
            this._planVariantState = {
                multiVariant: true,
                preferred: variantData.preferred || 'regular',
                active: variantData.preferred || 'regular'
            };
            this._updateVariantTabs(this._planVariantState.active);
        } else if (tabsEl) {
            tabsEl.style.display = 'none';
            this._planVariantState = {
                multiVariant: false,
                preferred: 'regular',
                active: 'regular'
            };
        }
    }

    _hidePlanBar() {
        const bar = document.getElementById('plan-approval-bar');
        if (bar) bar.classList.remove('visible');
        const ri = document.getElementById('plan-revise-input');
        if (ri) {
            ri.value = '';
            ri.classList.remove('visible');
        }
        this._resetPlanBarButtons();
        this._updateSendButtonState();
    }

    _resetPlanBarButtons() {
        const reviseBtn = document.getElementById('plan-revise-btn');
        const approveBtn = document.getElementById('plan-approve-btn');
        if (reviseBtn) OverlordUI.setContent(reviseBtn, 'Revise');
        if (approveBtn) approveBtn.style.display = '';
    }

    approvePlan() {
        if (this._socket) this._socket.emit('approve_plan');
        this._hidePlanBar();
        OverlordUI.dispatch('log', { message: 'Plan approved', type: 'success' });
    }

    cancelPlan() {
        if (this._socket) this._socket.emit('cancel_plan');
        this._hidePlanBar();
        OverlordUI.dispatch('log', { message: 'Plan cancelled', type: 'info' });
    }

    _showPlanRevise() {
        const ri = document.getElementById('plan-revise-input');
        const reviseBtn = document.getElementById('plan-revise-btn');
        const approveBtn = document.getElementById('plan-approve-btn');
        if (!ri) return;

        const showing = ri.classList.toggle('visible');
        if (showing) {
            ri.focus();
            if (reviseBtn) {
                OverlordUI.setContent(reviseBtn, '\u21b5 Submit');
                reviseBtn.onclick = () => this._submitPlanRevision();
            }
            if (approveBtn) approveBtn.style.display = 'none';
        } else {
            this._resetPlanBarButtons();
        }
    }

    _submitPlanRevision() {
        const ri = document.getElementById('plan-revise-input');
        const feedback = ri?.value.trim();
        if (!feedback) { ri?.focus(); return; }
        if (this._socket) this._socket.emit('revise_plan', feedback);
        this._hidePlanBar();
        OverlordUI.dispatch('log', {
            message: 'Revision sent — AI will re-plan: ' + feedback,
            type: 'info'
        });
    }

    _switchPlanVariant(variant) {
        if (!this._planVariantState.multiVariant) return;
        this._planVariantState.active = variant;
        this._updateVariantTabs(variant);
        if (this._socket) {
            this._socket.emit('switch_plan_variant', { variant });
        }
        OverlordUI.dispatch('log', {
            message: 'Switching to ' + variant + ' plan variant',
            type: 'info'
        });
    }

    _updateVariantTabs(active) {
        ['short', 'regular', 'long'].forEach(v => {
            const btn = document.getElementById('plan-tab-' + v);
            if (!btn) return;
            const isActive = v === active;
            btn.style.background = isActive ? 'var(--accent-cyan)' : 'transparent';
            btn.style.color = isActive ? '#000' : 'var(--text-secondary)';
            btn.style.fontWeight = isActive ? '700' : '400';
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  MESSAGE ACTIONS
    // ══════════════════════════════════════════════════════════════

    copyMessage(btnEl, format) {
        const msgDiv = btnEl.closest('.message');
        if (!msgDiv) return;
        let text;
        if (format === 'markdown') {
            text = msgDiv.dataset.raw ||
                   msgDiv.querySelector('.content')?.innerText || '';
        } else {
            text = msgDiv.querySelector('.content')?.innerText || '';
        }
        this.$$('.msg-copy-menu').forEach(m => { m.style.display = 'none'; });
        if (!navigator.clipboard) return;
        const copyBtn = msgDiv.querySelector('.msg-copy-btn');
        navigator.clipboard.writeText(text).then(() => {
            if (copyBtn) {
                const orig = copyBtn.textContent;
                OverlordUI.setContent(copyBtn, '\u2713');
                copyBtn.style.color = 'var(--accent-green, #00ff88)';
                setTimeout(() => {
                    OverlordUI.setContent(copyBtn, orig);
                    copyBtn.style.color = '';
                }, 1500);
            }
        }).catch(() => {});
    }

    resendMessage(btnEl) {
        const msgDiv = btnEl.closest('.message');
        if (!msgDiv) return;
        this.$$('.msg-copy-menu').forEach(m => { m.style.display = 'none'; });
        const rawText = msgDiv.dataset.raw ||
                        msgDiv.querySelector('.content')?.innerText || '';
        if (!rawText.trim()) return;
        if (this._inputEl) {
            this._inputEl.value = rawText;
            this.send();
        }
        OverlordUI.dispatch('log', { message: 'Message resent', type: 'info' });
    }

    editMessage(btnEl) {
        const msgDiv = btnEl.closest('.message');
        if (!msgDiv) return;
        this.$$('.msg-copy-menu').forEach(m => { m.style.display = 'none'; });
        const rawText = msgDiv.dataset.raw ||
                        msgDiv.querySelector('.content')?.innerText || '';
        if (this._inputEl) {
            this._inputEl.value = rawText;
            this._inputEl.focus();
            this._inputEl.style.height = 'auto';
            this._inputEl.style.height =
                Math.min(this._inputEl.scrollHeight, 200) + 'px';
        }
        OverlordUI.dispatch('log', {
            message: 'Message loaded for editing — modify and send when ready',
            type: 'info'
        });
    }

    deleteMessage(btnEl) {
        const msgDiv = btnEl.closest('.message');
        if (!msgDiv) return;
        this.$$('.msg-copy-menu').forEach(m => { m.style.display = 'none'; });
        const msgIndex = parseInt(msgDiv.dataset.msgIndex, 10);
        if (isNaN(msgIndex)) {
            OverlordUI.dispatch('log', {
                message: 'Cannot delete — message index unknown',
                type: 'error'
            });
            return;
        }
        if (!confirm(
            'Delete this message from the conversation history?\n\n' +
            'This cannot be undone.'
        )) return;
        if (this._socket) {
            this._socket.emit('delete_message', { messageIndex: msgIndex }, (result) => {
                if (result && result.success) {
                    msgDiv.style.transition = 'opacity 0.3s, max-height 0.3s';
                    msgDiv.style.opacity = '0';
                    msgDiv.style.maxHeight = '0';
                    msgDiv.style.overflow = 'hidden';
                    setTimeout(() => msgDiv.remove(), 350);
                    OverlordUI.dispatch('log', {
                        message: 'Message deleted',
                        type: 'info'
                    });
                } else {
                    OverlordUI.dispatch('log', {
                        message: 'Delete failed: ' + (result?.error || 'unknown error'),
                        type: 'error'
                    });
                }
            });
        }
    }

    forkChatFromHere(btnEl) {
        const msgDiv = btnEl.closest('.message');
        if (!msgDiv) return;
        this.$$('.msg-copy-menu').forEach(m => { m.style.display = 'none'; });
        const msgIndex = parseInt(msgDiv.dataset.msgIndex, 10);
        if (isNaN(msgIndex)) {
            OverlordUI.dispatch('log', {
                message: 'Cannot fork — message index unknown',
                type: 'error'
            });
            return;
        }
        if (!confirm(
            'Create a new conversation branching from this message?\n\n' +
            'All messages up to this point will be copied to a new chat.'
        )) return;
        if (this._socket) {
            this._socket.emit('fork_conversation', { messageIndex: msgIndex }, (result) => {
                if (result && result.success) {
                    OverlordUI.dispatch('log', {
                        message: 'Forked into new conversation: ' + (result.id || ''),
                        type: 'success'
                    });
                    if (result.id) this._socket.emit('load_conversation', result.id);
                } else {
                    OverlordUI.dispatch('log', {
                        message: 'Fork failed: ' + (result?.error || 'unknown error'),
                        type: 'error'
                    });
                }
            });
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  APPROVAL MODAL
    // ══════════════════════════════════════════════════════════════

    _showApprovalModal(data) {
        this._approvalToolId = data.toolId;

        const modal = document.getElementById('approval-modal');
        if (!modal) return;

        const nameEl = modal.querySelector('#approval-tool-name');
        const tierEl = modal.querySelector('#approval-tier');
        const reasonEl = modal.querySelector('#approval-reasoning');
        const inputEl = modal.querySelector('#approval-input');

        const tierLabels = {
            1: 'T1 — Auto',
            2: 'T2 — Auto',
            3: 'T3 — Needs Approval',
            4: 'T4 — High Risk'
        };

        if (nameEl) {
            OverlordUI.setContent(nameEl, data.toolName || data.toolId || '?');
        }
        if (tierEl) {
            OverlordUI.setContent(tierEl,
                tierLabels[data.tier] || ('Tier ' + (data.tier || '?')));
        }
        if (reasonEl) {
            OverlordUI.setContent(reasonEl, data.reasoning || data.confidence || '');
        }
        if (inputEl) {
            OverlordUI.setContent(inputEl,
                data.inputSummary ||
                JSON.stringify(data.input || {}).substring(0, 400));
        }

        // Store toolId on the DOM so the global respondApproval fallback can read it
        modal.dataset.toolId = data.toolId;
        modal.style.display = 'block';
        OverlordUI.dispatch('log', {
            message: 'Approval required for: ' + (data.toolName || data.toolId),
            type: 'warning'
        });
    }

    _hideApprovalModal() {
        const modal = document.getElementById('approval-modal');
        if (modal) { modal.style.display = 'none'; delete modal.dataset.toolId; }
        this._approvalToolId = null;
    }

    respondApproval(approved) {
        if (!this._approvalToolId) return;
        if (this._socket) {
            this._socket.emit('approval_response', {
                toolId: this._approvalToolId,
                approved
            });
        }
        this._hideApprovalModal();
        OverlordUI.dispatch('log', {
            message: approved ? 'Tool approved' : 'Tool denied',
            type: approved ? 'success' : 'warning'
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  TOOL EXCEPTION MODAL
    // ══════════════════════════════════════════════════════════════

    _showExceptionModal(data) {
        const { id, agentName, tool, justification, orchestratorThoughts } = data;

        const content = h('div', { class: 'exception-modal-body' }, [
            h('div', { class: 'exception-row' }, [
                h('span', { class: 'exception-label' }, 'Agent'),
                h('span', { class: 'exception-value' }, agentName || '?')
            ]),
            h('div', { class: 'exception-row' }, [
                h('span', { class: 'exception-label' }, 'Requested Tool'),
                h('span', { class: 'exception-value exception-tool' }, tool || '?')
            ]),
            h('div', { class: 'exception-row exception-block' }, [
                h('span', { class: 'exception-label' }, 'Agent\'s Justification'),
                h('p', { class: 'exception-text' }, justification || '')
            ]),
            h('div', { class: 'exception-row exception-block' }, [
                h('span', { class: 'exception-label' }, 'Orchestrator\'s Assessment'),
                h('p', { class: 'exception-text exception-assessment' }, orchestratorThoughts || '')
            ]),
            h('div', { class: 'exception-actions' }, [
                Button.create('Allow', {
                    variant: 'primary',
                    icon: '✅',
                    onClick: () => { this._resolveException(id, true); Modal.close('tool-exception'); }
                }),
                Button.create('Deny', {
                    variant: 'danger',
                    icon: '🚫',
                    onClick: () => { this._resolveException(id, false); Modal.close('tool-exception'); }
                })
            ])
        ]);

        Modal.open('tool-exception', {
            title: '🔐 Tool Access Request',
            content,
            size: 'sm'
        });

        OverlordUI.dispatch('log', {
            message: `Tool exception request: ${agentName} wants to use ${tool}`,
            type: 'warning'
        });
    }

    _resolveException(toolId, approved) {
        if (this._socket) {
            this._socket.emit('approval_response', { toolId, approved });
        }
        OverlordUI.dispatch('log', {
            message: approved ? `Tool exception allowed: ${toolId}` : `Tool exception denied: ${toolId}`,
            type: approved ? 'success' : 'warning'
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  MEDIA ATTACHMENTS
    // ══════════════════════════════════════════════════════════════

    _appendGeneratedImages(data) {
        if (!this._messagesEl || !data) return;
        const { prompt, images } = data;
        const lastMsg = this._messagesEl.lastElementChild;
        if (!lastMsg) return;

        const container = h('div', { class: 'ai-generated-images' });
        (images || []).forEach(img => {
            const src = img.servePath || img.url;
            if (src) {
                const imgEl = h('img', {
                    class: 'ai-generated-img',
                    src: src,
                    alt: 'Generated image',
                    title: (prompt || '').substring(0, 60)
                });
                imgEl.addEventListener('click', () => window.open(src, '_blank'));
                container.appendChild(imgEl);
            }
        });

        lastMsg.appendChild(container);
        lastMsg.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    _appendAudioPlayer(data) {
        if (!this._messagesEl || !data) return;
        const { servePath, filename, text } = data;
        const lastMsg = this._messagesEl.lastElementChild;
        if (!lastMsg) return;

        const audioId = 'audio-' + Date.now();
        const player = h('div', { class: 'audio-player' },
            h('button', {
                class: 'audio-play-btn',
                id: 'btn-' + audioId,
                onClick: () => {
                    if (typeof window.playAudio === 'function') {
                        window.playAudio(servePath, audioId);
                    }
                }
            }, '\u25b6'),
            h('span', { class: 'audio-label' }, text || filename || '')
        );

        lastMsg.appendChild(player);
    }

    // ══════════════════════════════════════════════════════════════
    //  UTILITIES
    // ══════════════════════════════════════════════════════════════

    _escapeHtml(str) {
        return OverlordUI.escapeHtml(str || '');
    }

    /**
     * Pass through already-parsed HTML from marked.parse(). The library
     * produces sanitized HTML from markdown — re-escaping would
     * double-encode entities (e.g., &lt; becomes &amp;lt;).
     */
    _escapeHtmlPreserveLinks(html) {
        return html;
    }

    /**
     * Strip raw plan JSON blocks from message text, replacing with
     * a clean markdown task table card.
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

        // Match ```json [...] ``` blocks
        text = text.replace(/```json\s*([\s\S]*?)```/gi, (match, inner) => {
            return tryFormat(inner.trim()) || match;
        });

        // Match bare JSON array of task objects
        text = text.replace(
            /(\[\s*\{[\s\S]*?"title"[\s\S]*?\}\s*\])/g,
            (match, inner) => tryFormat(inner.trim()) || match
        );

        return text;
    }
}
