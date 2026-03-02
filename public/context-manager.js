// ============================================================================
// OVERLORD WEB - Context Management Module
// ============================================================================
// This file adds context warning functionality to overlord-web

// Context state
let contextUsage = {
    percentUsed: 0,
    percentLeft: 100,
    status: 'normal',
    estimatedTokens: 0,
    maxTokens: 128000
};

// Initialize context management
function initContextManagement() {
    // Listen for context warning events from server
    if (typeof socket !== 'undefined') {
        socket.on('context_warning', (usage) => {
            contextUsage = usage;
            updateContextUI();
            
            // Show modal if critical
            if (usage.status === 'critical' && !document.getElementById('context-modal')?.classList.contains('open')) {
                showContextModal();
            }
        });
        
        socket.on('messages_cleared', () => {
            contextUsage = { percentUsed: 0, percentLeft: 100, status: 'normal', estimatedTokens: 0, maxTokens: 128000 };
            updateContextUI();
        });
    }
}

// Update context indicator UI
function updateContextUI() {
    // Check if context bar exists, create if not
    let contextBar = document.getElementById('context-bar-container');
    if (!contextBar) {
        contextBar = createContextBar();
    }
    
    const fill = document.getElementById('context-bar-fill');
    const text = document.getElementById('context-bar-text');
    const status = document.getElementById('context-bar-status');
    
    if (fill && text && status) {
        const percent = Math.min(contextUsage.percentUsed, 100);
        fill.style.width = percent + '%';
        
        // Update color based on status
        fill.className = 'context-bar-fill ' + contextUsage.status;
        
        if (contextUsage.percentLeft <= 10) {
            text.textContent = contextUsage.percentLeft.toFixed(1) + '% left';
        } else {
            text.textContent = contextUsage.percentUsed.toFixed(1) + '% used';
        }
        
        text.className = 'context-bar-text ' + contextUsage.status;
        
        // Update status indicator in status bar
        if (status) {
            if (contextUsage.status === 'critical') {
                status.textContent = '⚠️ CRITICAL';
                status.className = 'context-status critical';
            } else if (contextUsage.status === 'warning') {
                status.textContent = '⚡ ' + contextUsage.percentLeft.toFixed(0) + '% left';
                status.className = 'context-status warning';
            } else {
                status.textContent = '';
                status.className = 'context-status';
            }
        }
    }
}

// Create context bar element
function createContextBar() {
    const container = document.createElement('div');
    container.id = 'context-bar-container';
    container.className = 'context-bar-container';
    container.innerHTML = `
        <div class="context-bar">
            <div class="context-bar-fill" id="context-bar-fill" style="width: 0%"></div>
        </div>
        <span class="context-bar-text" id="context-bar-text">0% used</span>
        <span class="context-status" id="context-bar-status"></span>
    `;
    
    // Insert before input area
    const inputArea = document.querySelector('.input-area');
    if (inputArea) {
        inputArea.insertBefore(container, inputArea.firstChild);
    }
    
    return container;
}

// Show context modal
function showContextModal() {
    // Remove existing modal if any
    const existing = document.getElementById('context-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'context-modal';
    modal.className = 'add-task-modal open';
    modal.onclick = function(e) {
        if (e.target === modal) closeContextModal();
    };
    
    modal.innerHTML = `
        <div class="add-task-content" onclick="event.stopPropagation()">
            <div class="edit-task-header" style="background: var(--accent-red);">
                <div>
                    <div class="edit-task-title" style="color: #000;">⚠️ Context Limit Warning</div>
                </div>
                <span class="image-preview-close" onclick="closeContextModal()">×</span>
            </div>
            <div style="padding: 16px;">
                <p style="margin-bottom: 12px;"><strong>Context usage:</strong> ${contextUsage.percentUsed.toFixed(1)}%</p>
                <p style="margin-bottom: 12px;"><strong>Tokens used:</strong> ~${contextUsage.estimatedTokens?.toLocaleString() || '0'} / ${contextUsage.maxTokens?.toLocaleString()}</p>
                <p style="margin-bottom: 16px; color: var(--accent-red);">Context is almost full! Choose an action below:</p>
                
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <button class="btn" onclick="clearContext()" style="padding: 12px; text-align: left; border-left: 3px solid var(--accent-magenta);">
                        <strong>📋 Summarize</strong><br>
                        <small style="color: var(--text-secondary);">Keep last 2 messages</small>
                    </button>
                    <button class="btn" onclick="archiveAndNewContext()" style="padding: 12px; text-align: left; border-left: 3px solid var(--accent-yellow);">
                        <strong>📦 Archive & New</strong><br>
                        <small style="color: var(--text-secondary);">Save current, start fresh</small>
                    </button>
                    <button class="btn" onclick="newContext()" style="padding: 12px; text-align: left; border-left: 3px solid var(--accent-cyan);">
                        <strong>🆕 Start Fresh</strong><br>
                        <small style="color: var(--text-secondary);">Discard and start new</small>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Close context modal
function closeContextModal() {
    const modal = document.getElementById('context-modal');
    if (modal) modal.remove();
}

// Clear context (keep last 2 messages)
function clearContext() {
    if (typeof socket !== 'undefined') {
        socket.emit('clear_context');
        closeContextModal();
        log('Context cleared - keeping summary', 'success');
    }
}

// Archive and start new
function archiveAndNewContext() {
    if (typeof socket !== 'undefined') {
        socket.emit('archive_and_new');
        closeContextModal();
        log('Archived and started new conversation', 'success');
    }
}

// Start fresh (discard)
function newContext() {
    if (typeof socket !== 'undefined') {
        socket.emit('new_conversation');
        closeContextModal();
        log('Started fresh conversation', 'success');
    }
}

// Add CSS for context management
function addContextCSS() {
    const css = `
        .context-bar-container {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--bg-dark);
            border-bottom: 1px solid var(--border);
        }
        
        .context-bar {
            flex: 1;
            height: 4px;
            background: var(--bg-input);
            border-radius: 2px;
            overflow: hidden;
        }
        
        .context-bar-fill {
            height: 100%;
            background: var(--accent-green);
            transition: width 0.3s, background 0.3s;
        }
        
        .context-bar-fill.warning {
            background: var(--accent-yellow);
        }
        
        .context-bar-fill.critical {
            background: var(--accent-red);
            animation: pulse-bar 0.5s infinite;
        }
        
        @keyframes pulse-bar {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .context-bar-text {
            font-size: 10px;
            font-family: 'SF Mono', 'Menlo', monospace;
            min-width: 60px;
            text-align: right;
        }
        
        .context-bar-text.warning {
            color: var(--accent-yellow);
        }
        
        .context-bar-text.critical {
            color: var(--accent-red);
            font-weight: bold;
        }
        
        .context-status {
            font-size: 10px;
            font-weight: bold;
        }
        
        .context-status.warning {
            color: var(--accent-yellow);
        }
        
        .context-status.critical {
            color: var(--accent-red);
            animation: pulse-status 1s infinite;
        }
        
        @keyframes pulse-status {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    `;
    
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        addContextCSS();
        initContextManagement();
    });
} else {
    addContextCSS();
    initContextManagement();
}

console.log('[Context] Management module loaded');
