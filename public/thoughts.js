// Toggle thoughts bubble expansion
function toggleThoughts(id) {
    const bubble = document.getElementById(id);
    if (!bubble) return;

    const isOpen = bubble.classList.toggle('tb-open');

    // Auto-scroll to bottom of content when expanding
    if (isOpen) {
        const body = bubble.querySelector('.tb-body');
        if (body) body.scrollTop = body.scrollHeight;
    }
}
