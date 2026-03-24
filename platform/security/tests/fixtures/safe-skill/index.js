// Safe skill - just reads and formats data
const fs = require('fs');
const path = require('path');

function processData(inputFile) {
    const data = fs.readFileSync(inputFile, 'utf-8');
    const lines = data.split('\n');
    const result = lines.map(line => line.trim()).filter(Boolean);
    console.log(`Processed ${result.length} lines`);
    return result;
}

module.exports = { processData };
