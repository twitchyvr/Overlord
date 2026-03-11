const fs = require('fs');
const scriptsToRemove = [
    'analyze_orchestration.js',
    'analyze_sections.cjs',
    'analyze_shared.cjs',
    'check_extracted.cjs',
    'check_files.cjs',
    'cleanup.cjs',
    'extract_sections.cjs',
    'find_funcs.cjs',
    'find_ranges.cjs',
    'check_approval.cjs',
    'categorize.cjs',
    'search_funcs.cjs',
    'simple_test.cjs',
    'run_lint.cjs',
    'test_modules.cjs'
];

scriptsToRemove.forEach(name => {
    try {
        fs.unlinkSync('./scripts/' + name);
        console.log('Removed:', name);
    } catch (e) {
        // File might not exist
    }
});
console.log('Done cleaning up scripts');
