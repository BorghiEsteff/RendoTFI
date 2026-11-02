import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createTranslator} from 'next-intl';

for (const locale of ['es', 'en', 'pt']) {
  test(`WhatsApp includes the actual unit title in ${locale}`, () => {
    const messages = JSON.parse(
      readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')
    );
    const t = createTranslator({locale, messages, namespace: 'UnitDetail'});
    const unitTitle = 'Departamento con vista al río / 2 ambientes';
    const result = t('whatsappMessage', {titulo: unitTitle});

    assert.ok(result.includes(unitTitle), `Title missing in ${locale}: ${result}`);
    assert.ok(!result.includes('{titulo}'), `ICU placeholder remained literal: ${result}`);
    assert.equal(decodeURIComponent(encodeURIComponent(result)), result);
  });
}
