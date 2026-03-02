

// ==================== PANEL RESIZE & DRAG ====================

function initPanelResize() {
    const rightPanel = document.querySelector('.right-panel');
    if (!rightPanel) return;
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    // Create resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'panel-resize-handle';
    resizeHandle.title = 'Drag to resize';
    
    // Add resize handle styles inline
    resizeHandle.style.cssText = `
        position: absolute;
        left: -4px;
        top: 0;
        bottom: 0;
        width: 8px;
        cursor: ew-resize;
        z-index: 10;
    `;
    
    rightPanel.style.position = 'relative';
    rightPanel.appendChild(resizeHandle);
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = rightPanel.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const diff = e.clientX - startX;
        const newWidth = Math.max(180, Math.min(600, startWidth + diff));
        rightPanel.style.width = newWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save panel width to localStorage
            localStorage.setItem('panelWidth', rightPanel.style.width);
        }
    });
    
    // Load saved width
    const savedWidth = localStorage.getItem('panelWidth');
    if (savedWidth) {
        rightPanel.style.width = savedWidth;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanelResize);
} else {
    initPanelResize();
}
