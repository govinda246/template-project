import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleDnsQuery,
  parseAllowedDnsNames,
  parseDnsQuery,
} from './dns-filter.mjs';

function dnsQuery(name) {
  const labels = name.split('.');
  const questionLength = labels.reduce((length, label) => length + label.length + 1, 5);
  const message = Buffer.alloc(12 + questionLength);
  message.writeUInt16BE(0x1234, 0);
  message.writeUInt16BE(0x0100, 2);
  message.writeUInt16BE(1, 4);
  let offset = 12;
  for (const label of labels) {
    message[offset++] = label.length;
    message.write(label, offset, 'ascii');
    offset += label.length;
  }
  message[offset++] = 0;
  message.writeUInt16BE(1, offset);
  message.writeUInt16BE(1, offset + 2);
  return message;
}

test('only exact allowlisted DNS names are forwarded', async () => {
  const allowed = parseAllowedDnsNames('api.github.com\n');
  let forwarded = 0;

  const accepted = await handleDnsQuery(dnsQuery('api.github.com'), allowed, async (query) => {
    forwarded += 1;
    return query;
  });
  const denied = await handleDnsQuery(
    dnsQuery('secret.exfil.example.com'),
    allowed,
    async () => assert.fail('denied query reached upstream'),
  );

  assert.equal(accepted.denied, false);
  assert.equal(denied.denied, true);
  assert.equal(forwarded, 1);
  assert.equal(denied.response.readUInt16BE(2) & 0x000f, 3);
});

test('subdomains of an exact host are not implicitly allowed', async () => {
  const allowed = parseAllowedDnsNames('github.com\n');
  const result = await handleDnsQuery(
    dnsQuery('secret.github.com'),
    allowed,
    async () => assert.fail('subdomain reached upstream'),
  );

  assert.equal(result.denied, true);
});

test('rejects additional DNS records that could carry encoded data', async () => {
  const allowed = parseAllowedDnsNames('api.github.com\n');
  const query = Buffer.concat([dnsQuery('api.github.com'), Buffer.from([1])]);

  const result = await handleDnsQuery(
    query,
    allowed,
    async () => assert.fail('smuggled data reached upstream'),
  );

  assert.equal(result.denied, true);
});

test('accepts an empty EDNS0 record but strips it before forwarding', async () => {
  const allowed = parseAllowedDnsNames('api.github.com\n');
  const query = Buffer.alloc(dnsQuery('api.github.com').length + 11);
  dnsQuery('api.github.com').copy(query);
  query.writeUInt16BE(1, 10);
  const optOffset = query.length - 11;
  query.writeUInt16BE(41, optOffset + 1);
  query.writeUInt16BE(1232, optOffset + 3);
  let forwarded;

  const result = await handleDnsQuery(query, allowed, async (message) => {
    forwarded = message;
    return message;
  });

  assert.equal(result.denied, false);
  assert.equal(forwarded.readUInt16BE(10), 0);
  assert.equal(forwarded.length, query.length - 11);
});

test('rejects EDNS0 options and oversized UDP payloads', async () => {
  const allowed = parseAllowedDnsNames('api.github.com\n');
  const base = dnsQuery('api.github.com');
  const withOption = Buffer.alloc(base.length + 15);
  base.copy(withOption);
  withOption.writeUInt16BE(1, 10);
  withOption.writeUInt16BE(41, base.length + 1);
  withOption.writeUInt16BE(1232, base.length + 3);
  withOption.writeUInt16BE(4, base.length + 9);
  withOption.writeUInt16BE(0xffff, base.length + 11);
  withOption.writeUInt16BE(0, base.length + 13);

  assert.throws(() => parseDnsQuery(withOption), /empty EDNS0/);

  const oversized = Buffer.alloc(base.length + 11);
  base.copy(oversized);
  oversized.writeUInt16BE(1, 10);
  oversized.writeUInt16BE(41, base.length + 1);
  oversized.writeUInt16BE(511, base.length + 3);
  assert.throws(() => parseDnsQuery(oversized), /empty EDNS0/);

  const tooLarge = Buffer.alloc(base.length + 11);
  base.copy(tooLarge);
  tooLarge.writeUInt16BE(1, 10);
  tooLarge.writeUInt16BE(41, base.length + 1);
  tooLarge.writeUInt16BE(4096, base.length + 3);
  assert.throws(() => parseDnsQuery(tooLarge), /empty EDNS0/);
});

test('parses a single conventional DNS question', () => {
  assert.equal(parseDnsQuery(dnsQuery('registry.npmjs.org')).name, 'registry.npmjs.org');
});
