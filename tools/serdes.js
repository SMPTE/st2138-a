const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const protobuf = require('protobufjs');

function fixEnumField(obj, enumType, fieldPath) {
    const keys = fieldPath.split('.');
    const lastKey = keys.pop();
  
    let current = obj;
    for (const key of keys) {
      if (current[key] === undefined) return;
      current = current[key];
    }
  
    if (
      current &&
      typeof current[lastKey] === 'string' &&
      enumType.values[current[lastKey]] !== undefined
    ) {
      current[lastKey] = enumType.values[current[lastKey]];
    }
  }
  
  function fixEnums(obj, root) {
    const ParamType = root.lookupEnum('ParamType');
    const ConstraintType = root.lookupEnum('Constraint.ConstraintType');
  
    // Fix top-level type
    fixEnumField(obj, ParamType, 'type');
  
    // Fix constraint.type
    fixEnumField(obj, ConstraintType, 'constraint.type');
  
    // If you have other enums, you can repeat here...
  }

async function main() {
  const [, , yamlFilePath] = process.argv;

  if (!yamlFilePath) {
    console.error('Usage: node read_param.js <param.yaml>');
    process.exit(1);
  }

  // Load .proto file
  const root = await protobuf.load(path.join(__dirname, '../interface/proto/param.proto'));
  const Param = root.lookupType('Param');

  // Load and parse YAML file
  const yamlText = fs.readFileSync(yamlFilePath, 'utf8');
  const yamlObject = yaml.parse(yamlText);

  // Fix enums
  fixEnums(yamlObject, root);

  // Validate the object against the schema
  const err = Param.verify(yamlObject);
  if (err) {
    throw new Error('YAML does not match Param schema: ' + err);
  }

  // Convert plain object to a protobuf message
  const message = Param.fromObject(yamlObject);

  // Print message
  console.log('Parsed Param message:');
  console.dir(message, { depth: null });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});