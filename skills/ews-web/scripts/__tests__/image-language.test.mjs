import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyImageLanguage,
  isLegalImgLangAssetSet,
  resolveLocaleDeviceImage,
  sourceTreeUnchanged,
} from '../lib/image-language.mjs';
import { PNG_1x1, mobileInventory, pcInventory, writeAssets, writeReadyPack } from './helpers/ready-fixture.mjs';

test('I1 locale×device matches; single-variant ordinary image is not a lang set', () => {
  const root = mkdtempSync(join(tmpdir(), 'ews-i1-'));
  const docs = writeReadyPack(join(root, 'pack'));
  const map = writeAssets(join(root, 'assets'), docs);
  const pcSets = pcInventory().attachments.componentSets;
  const moSets = mobileInventory().attachments.componentSets;
  const sets = { pc: pcSets, mobile: moSets };
  const cnPc = resolveLocaleDeviceImage({
    device: 'pc', language: 'zh-CN', componentId: '100:31',
    componentSetsByDevice: sets, assetsByDevice: map,
  });
  assert.equal(cnPc.status, 'matched');
  assert.equal(cnPc.componentId, '100:31');
  const enMo = resolveLocaleDeviceImage({
    device: 'mobile', language: 'en', componentId: '200:32',
    componentSetsByDevice: sets, assetsByDevice: map,
  });
  assert.equal(enMo.status, 'matched');
  assert.equal(enMo.device, 'mobile');
  assert.equal(enMo.value, 'en');
  const ordinary = pcSets.find((set) => set.id === '100:40');
  assert.equal(isLegalImgLangAssetSet(ordinary), false);
  const plain = resolveLocaleDeviceImage({
    device: 'pc', language: 'en', componentId: '100:41',
    componentSetsByDevice: sets, assetsByDevice: map,
  });
  assert.equal(plain.status, 'not-applicable');
  assert.equal(plain.reason, 'not-img-lang-set');
});

test('I2 CN→EN→CN restores source tree and does not mutate original', () => {
  const root = mkdtempSync(join(tmpdir(), 'ews-i2-'));
  const docs = writeReadyPack(join(root, 'pack'));
  const map = writeAssets(join(root, 'assets'), docs);
  const source = {
    instances: [{ id: '100:8', componentId: '100:31', assetRef: map.pc['100:31'].path, sourceNodeId: '100:8' }],
  };
  const frozen = JSON.parse(JSON.stringify(source));
  const en = applyImageLanguage(source, {
    language: 'en', device: 'pc',
    componentSetsByDevice: { pc: docs.pc.attachments.componentSets },
    assetsByDevice: map,
  });
  assert.equal(en.ok, true, JSON.stringify(en.failVisible));
  assert.equal(en.tree.instances[0].componentId, '100:32');
  const cn = applyImageLanguage(source, {
    language: 'zh-CN', device: 'pc',
    componentSetsByDevice: { pc: docs.pc.attachments.componentSets },
    assetsByDevice: map,
  });
  assert.equal(cn.tree.instances[0].componentId, '100:31');
  assert.equal(cn.tree.instances[0].assetRef, map.pc['100:31'].path);
  assert.equal(sourceTreeUnchanged(source, frozen), true);
  assert.deepEqual(en.source, frozen);
});

test('I3 missing en variant / missing mobile asset / missing file is fail-visible; no CN fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'ews-i3-'));
  const docs = writeReadyPack(join(root, 'pack'));
  const map = writeAssets(join(root, 'assets'), docs);
  const pcSets = JSON.parse(JSON.stringify(docs.pc.attachments.componentSets));
  pcSets[0].propertyDefinitions = pcSets[0].propertyDefinitions || pcSets[0].componentPropertyDefinitions;
  pcSets[0].propertyDefinitions.lang = { type: 'VARIANT', variantOptions: ['cn', 'en', 'jp'] };
  const missingVariant = resolveLocaleDeviceImage({
    device: 'pc', language: 'ja', componentId: '100:31',
    componentSetsByDevice: { pc: pcSets }, assetsByDevice: map,
  });
  assert.equal(missingVariant.ok, false);
  assert.equal(missingVariant.failVisible, true);
  assert.equal(missingVariant.status, 'missing-language-variant');

  const noMobile = resolveLocaleDeviceImage({
    device: 'mobile', language: 'en', componentId: '200:32',
    componentSetsByDevice: { pc: docs.pc.attachments.componentSets },
    assetsByDevice: map,
  });
  assert.equal(noMobile.ok, false);
  assert.match(String(noMobile.reason), /missing componentSets for mobile/);

  const abs32 = join(root, 'assets', map.pc['100:32'].path);
  unlinkSync(abs32);
  const missingFile = resolveLocaleDeviceImage({
    device: 'pc', language: 'en', componentId: '100:31',
    componentSetsByDevice: { pc: docs.pc.attachments.componentSets },
    assetsByDevice: { pc: { '100:32': abs32 } },
    assertFile: (abs) => existsSync(abs) && statSync(abs).isFile(),
  });
  assert.equal(missingFile.ok, false);
  assert.equal(missingFile.status, 'missing-asset');

  const extraAxis = JSON.parse(JSON.stringify(docs.pc.attachments.componentSets[0]));
  extraAxis.variants.push({
    id: '100:33', type: 'COMPONENT', name: 'lang=en, Device=wide',
    componentProperties: { lang: 'en', Device: 'wide' },
    sliceExport: extraAxis.variants[1].sliceExport,
  });
  extraAxis.variants[1].name = 'lang=en, Device=narrow';
  extraAxis.variants[1].componentProperties = { lang: 'en', Device: 'narrow' };
  writeFileSync(join(root, 'wide.png'), PNG_1x1);
  extraAxis.componentPropertyDefinitions = extraAxis.componentPropertyDefinitions || extraAxis.propertyDefinitions;
  extraAxis.propertyDefinitions = extraAxis.componentPropertyDefinitions;
  extraAxis.propertyDefinitions.lang = { type: 'VARIANT', variantOptions: ['cn', 'en'] };
  const ambiguous = resolveLocaleDeviceImage({
    device: 'pc', language: 'en', componentId: '100:32',
    componentSetsByDevice: { pc: [extraAxis] },
    assetsByDevice: map,
    instanceProperties: { Device: 'narrow' },
  });
  const twoEn = extraAxis.variants.filter((variant) => String(variant.componentProperties?.lang) === 'en');
  assert.equal(twoEn.length, 2);
  const wide = resolveLocaleDeviceImage({
    device: 'pc', language: 'en', componentId: '100:32',
    componentSetsByDevice: { pc: [extraAxis] },
    assetsByDevice: map,
    instanceProperties: {},
  });
  assert.equal(wide.ok, false, JSON.stringify(wide));
  assert.equal(wide.status, 'ambiguous-variant-axes');
});
