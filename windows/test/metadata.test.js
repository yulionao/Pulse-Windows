const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMetadataText, localizedField } = require('../src/main/metadata');

test('parses the plugin metadata comment block', () => {
  const metadata = parseMetadataText(`#!/usr/bin/env python3
# UsageBoardPlugin:
# {
#   "name": "Example",
#   "name@zh-Hans": "示例",
#   "parameters": [{"name":"TOKEN","type":"secret","required":true}]
# }
# /UsageBoardPlugin
print("ignored")`);
  assert.equal(metadata.name, 'Example');
  assert.equal(metadata.parameters[0].name, 'TOKEN');
  assert.equal(localizedField(metadata, 'name', 'zh-Hans'), '示例');
});

test('rejects incomplete and malformed metadata', () => {
  assert.equal(parseMetadataText('# UsageBoardPlugin:\n# {"name":"x"}'), null);
  assert.equal(parseMetadataText('# UsageBoardPlugin:\n# nope\n# /UsageBoardPlugin'), null);
});
