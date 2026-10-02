const fs = require('node:fs');
const path = require('node:path');

// A spec can accumulate measurements across its tests without rewriting the
// historical reference fixture. Resolve the active profile lazily at test time.
function createMeasurementReport(name, getTestInfo) {
  const baseline = path.resolve(__dirname, '../measurements', name);
  const filename = () => path.join(getTestInfo().project.outputDir, 'measurements', name);
  const read = () => {
    const generated = filename();
    const source = fs.existsSync(generated) ? generated : baseline;
    return fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, 'utf8')) : {};
  };
  const write = value => {
    const target = filename();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
  };
  return { read, write, update: value => write(Object.assign(read(), value)) };
}

module.exports = { createMeasurementReport };
