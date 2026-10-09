// Only the explicitly synthetic example is freshened. Real observations never are.
process.argv.push('--demo');
await import('../local.mjs');
