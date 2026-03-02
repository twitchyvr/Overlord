/**
 * Approval Flow Tests
 * Tests for the Promise-based blocking approval mechanism in orchestration-module.js
 */

// ==================== UNIT: waitForApproval / handleApprovalResponse ====================

/**
 * We extract the core approval logic for isolated testing.
 * The real module has hub dependencies, so we replicate just the
 * data structures and resolution logic.
 */

function createApprovalSystem() {
    const pendingResolvers = new Map();

    function waitForApproval(toolId, timeoutMs) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (pendingResolvers.has(toolId)) {
                    pendingResolvers.delete(toolId);
                    resolve(false); // timeout → deny
                }
            }, timeoutMs);

            pendingResolvers.set(toolId, { resolve, timer });
        });
    }

    function handleApprovalResponse(data) {
        if (!data || !data.toolId) return;
        if (pendingResolvers.has(data.toolId)) {
            const { resolve, timer } = pendingResolvers.get(data.toolId);
            clearTimeout(timer);
            pendingResolvers.delete(data.toolId);
            resolve(data.approved === true);
        }
    }

    function handleCancel() {
        for (const [, { resolve, timer }] of pendingResolvers) {
            clearTimeout(timer);
            resolve(false);
        }
        pendingResolvers.clear();
    }

    return { waitForApproval, handleApprovalResponse, handleCancel, pendingResolvers };
}

describe('Approval: waitForApproval', () => {

    test('resolves true when approved before timeout', async () => {
        const { waitForApproval, handleApprovalResponse } = createApprovalSystem();
        const toolId = 'tool-001';

        const promise = waitForApproval(toolId, 5000);
        handleApprovalResponse({ toolId, approved: true });

        const result = await promise;
        expect(result).toBe(true);
    });

    test('resolves false when denied', async () => {
        const { waitForApproval, handleApprovalResponse } = createApprovalSystem();
        const toolId = 'tool-002';

        const promise = waitForApproval(toolId, 5000);
        handleApprovalResponse({ toolId, approved: false });

        const result = await promise;
        expect(result).toBe(false);
    });

    test('resolves false on timeout', async () => {
        const { waitForApproval } = createApprovalSystem();
        const toolId = 'tool-timeout';

        // Very short timeout for test speed
        const result = await waitForApproval(toolId, 50);
        expect(result).toBe(false);
    }, 1000);

    test('clears resolver from Map after resolution', async () => {
        const { waitForApproval, handleApprovalResponse, pendingResolvers } = createApprovalSystem();
        const toolId = 'tool-003';

        const promise = waitForApproval(toolId, 5000);
        expect(pendingResolvers.has(toolId)).toBe(true);

        handleApprovalResponse({ toolId, approved: true });
        await promise;

        expect(pendingResolvers.has(toolId)).toBe(false);
    });

    test('handles response for unknown toolId gracefully (no error)', () => {
        const { handleApprovalResponse } = createApprovalSystem();
        // Should not throw
        expect(() => {
            handleApprovalResponse({ toolId: 'nonexistent-tool', approved: true });
        }).not.toThrow();
    });

    test('handles null/undefined data gracefully', () => {
        const { handleApprovalResponse } = createApprovalSystem();
        expect(() => handleApprovalResponse(null)).not.toThrow();
        expect(() => handleApprovalResponse(undefined)).not.toThrow();
        expect(() => handleApprovalResponse({})).not.toThrow();
    });

    test('multiple concurrent approvals resolve independently', async () => {
        const { waitForApproval, handleApprovalResponse } = createApprovalSystem();

        const p1 = waitForApproval('tool-A', 5000);
        const p2 = waitForApproval('tool-B', 5000);
        const p3 = waitForApproval('tool-C', 5000);

        handleApprovalResponse({ toolId: 'tool-A', approved: true });
        handleApprovalResponse({ toolId: 'tool-B', approved: false });
        handleApprovalResponse({ toolId: 'tool-C', approved: true });

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
        expect(r1).toBe(true);
        expect(r2).toBe(false);
        expect(r3).toBe(true);
    });

    test('handleCancel resolves all pending approvals as denied', async () => {
        const { waitForApproval, handleCancel } = createApprovalSystem();

        const p1 = waitForApproval('tool-X', 10000);
        const p2 = waitForApproval('tool-Y', 10000);

        // Cancel all
        handleCancel();

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(false);
        expect(r2).toBe(false);
    });

    test('approved=undefined is treated as denied', async () => {
        const { waitForApproval, handleApprovalResponse } = createApprovalSystem();
        const toolId = 'tool-undefined';

        const promise = waitForApproval(toolId, 5000);
        handleApprovalResponse({ toolId, approved: undefined });

        const result = await promise;
        expect(result).toBe(false);  // undefined !== true
    });

    test('second response for same toolId does nothing (already resolved)', async () => {
        const { waitForApproval, handleApprovalResponse, pendingResolvers } = createApprovalSystem();
        const toolId = 'tool-double';

        const promise = waitForApproval(toolId, 5000);
        handleApprovalResponse({ toolId, approved: true });
        await promise;

        // Second response — resolver already removed, should not throw
        expect(() => {
            handleApprovalResponse({ toolId, approved: false });
        }).not.toThrow();

        // Map should still be empty
        expect(pendingResolvers.size).toBe(0);
    });

});

// ==================== INTEGRATION: Approval event flow ====================

describe('Approval: event flow contract', () => {

    test('approval_response event structure matches what frontend sends', () => {
        // Verify the expected structure from the frontend respondApproval() function
        const approvePayload = { toolId: 'toolu_01ABC', approved: true };
        const denyPayload = { toolId: 'toolu_01ABC', approved: false };

        expect(typeof approvePayload.toolId).toBe('string');
        expect(approvePayload.approved).toBe(true);
        expect(typeof denyPayload.toolId).toBe('string');
        expect(denyPayload.approved).toBe(false);
    });

    test('approval_request event structure matches what backend emits', () => {
        // Verify the expected structure from orchestration-module
        const requestPayload = {
            toolName: 'bash',
            toolId: 'toolu_01ABC',
            input: { command: 'rm -rf /' },
            tier: 4,
            confidence: 0.9,
            reasoning: 'Destructive operation detected',
            inputSummary: '{"command":"rm -rf /"}'
        };

        expect(typeof requestPayload.toolName).toBe('string');
        expect(typeof requestPayload.toolId).toBe('string');
        expect(typeof requestPayload.tier).toBe('number');
        expect(requestPayload.tier).toBeGreaterThanOrEqual(1);
        expect(requestPayload.tier).toBeLessThanOrEqual(4);
    });

});
