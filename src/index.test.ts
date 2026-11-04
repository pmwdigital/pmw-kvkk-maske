import { describe, expect, it } from 'vitest';
import { createPiiVault, foldText, isValidIban, isValidTckn, passesLuhn } from './index.js';

const VALID_TCKN = '10000000146';
const VALID_CARD = '4111 1111 1111 1111';
const VALID_IBAN = 'TR33 0006 1005 1978 6457 8413 26';

describe('doğrulayıcılar', () => {
  it('TC kimlik numarasını sağlama haneleriyle tanır', () => {
    expect(isValidTckn(VALID_TCKN)).toBe(true);
    expect(isValidTckn('10000000145')).toBe(false);
    expect(isValidTckn('01234567890')).toBe(false);
    expect(isValidTckn('1000000014')).toBe(false);
  });

  it('kart numarasını Luhn ile, IBAN\'ı mod 97 ile tanır', () => {
    expect(passesLuhn('4111111111111111')).toBe(true);
    expect(passesLuhn('4111111111111112')).toBe(false);
    expect(isValidIban(VALID_IBAN)).toBe(true);
    expect(isValidIban('TR33 0006 1005 1978 6457 8413 27')).toBe(false);
    expect(isValidIban('TR33 0006 1005 1978 6457 8413')).toBe(false);
  });

  it('Türkçe harfleri büyük-küçük ve şapkadan bağımsız katlar, uzunluğu korur', () => {
    const text = 'İSMAİL IŞIK Şükrü Gül Çağrı Âdem';
    expect(foldText(text)).toBe('ismail isik sukru gul cagri adem');
    expect(foldText(text)).toHaveLength(text.length);
    expect(foldText('Merhaba 😀 Dünya')).toHaveLength('Merhaba 😀 Dünya'.length);
    expect(foldText('AYŞE YILMAZ')).toBe('ayse yilmaz');
  });
});

describe('maskeleme', () => {
  it('telefonu her biçimde tanır ve aynı numaraya aynı yer tutucuyu verir', () => {
    const vault = createPiiVault();
    const forms = ['0532 123 45 67', '+90 532 123 45 67', '(0532) 123-45-67', '05321234567', '5321234567', '+905321234567', '0090 532 123 45 67'];
    for (const form of forms) {
      expect(vault.mask(`Numarası ${form} imiş.`)).toBe('Numarası [telefon_1] imiş.');
    }
    expect(vault.mask('Sabit hat 0212 123 45 67')).toBe('Sabit hat [telefon_2]');
    expect(vault.mask('Yurt dışı +44 20 7946 0958')).toBe('Yurt dışı [telefon_3]');
  });

  it('e-posta, TC kimlik, kart ve IBAN\'ı maskeler', () => {
    const vault = createPiiVault();
    const masked = vault.mask(
      `Müşteri ahmet.yilmaz@example.com, TC ${VALID_TCKN}, kart ${VALID_CARD}, IBAN ${VALID_IBAN}.`,
    );
    expect(masked).toBe('Müşteri [eposta_1], TC [tc_no_1], kart [kart_1], IBAN [iban_1].');
    expect(vault.size).toBe(4);
  });

  it('kişisel veri olmayan sayıları ve metni olduğu gibi bırakır', () => {
    const vault = createPiiVault();
    const samples = [
      'Toplam 1.250,00 TL, KDV %10, 4 kişi, masa 12.',
      'Tarih 19.10.2026 saat 14:30; çalışma saatleri 11:00 - 00:00.',
      'Fiş No: 0057, Z No 11, EKÜ 2, ABC-12 ve #48 kapandı.',
      'Barkod 8690000000012 ve 8690000000029, stok 359 adet.',
      'Şirket VKN 4561234567, sipariş SA-20261019-001.',
      'Geçersiz kart 4111 1111 1111 1112, geçersiz TC 10000000145.',
      'Hatalı IBAN TR33 0006 1005 1978 6457 8413 27 yazılmış.',
      '2026-10-19T14:30:00Z tarihli rapor, tutar 35900 kuruş.',
    ];
    for (const sample of samples) expect(vault.mask(sample)).toBe(sample);
    expect(vault.size).toBe(0);
  });

  it('kişisel veri yoksa aynı metni döndürür', () => {
    const vault = createPiiVault({ names: ['Ahmet Yılmaz'] });
    const text = 'Bugün en çok mercimek çorbası satıldı.';
    expect(vault.mask(text)).toBe(text);
    expect(vault.mask('')).toBe('');
  });

  it('bilinen kişi adlarını Türkçe harf ve büyük-küçük farkından bağımsız maskeler', () => {
    const vault = createPiiVault({ names: ['AHMET YILMAZ', 'Ayşe Demir', 'Ahmet Yılmaz'] });
    expect(vault.mask("ahmet yilmaz bugün geldi, AYŞE DEMİR'in vardiyası 18:00'de.")).toBe(
      "[kisi_1] bugün geldi, [kisi_2]'in vardiyası 18:00'de.",
    );
    expect(vault.mask('Ahmet   Yılmaz')).toBe('[kisi_1]');
    expect(vault.unmask('[kisi_1]')).toBe('AHMET YILMAZ');
  });

  it('tek kelimelik ve başka kelimenin parçası olan adları maskelemez', () => {
    const vault = createPiiVault({ names: ['Gül', 'Ali', 'Ahmet Yılmaz', 'A B'] });
    const text = 'Gül şerbeti, Ali Bey, Ahmetcan Yılmazlar ve Ahmet Yılmazoğlu geldi.';
    expect(vault.mask(text)).toBe(text);
  });

  it('uzun adı kısa adın önüne koyar', () => {
    const vault = createPiiVault({ names: ['Ayşe Kaya', 'Ayşe Kaya Demir'] });
    expect(vault.mask('Ayşe Kaya Demir ve Ayşe Kaya')).toBe('[kisi_1] ve [kisi_2]');
    expect(vault.unmask('[kisi_1] ve [kisi_2]')).toBe('Ayşe Kaya Demir ve Ayşe Kaya');
  });

  it('ad listesinden en fazla 5000 farklı adı kullanır', () => {
    const names = Array.from({ length: 5001 }, (_, i) => `Kişi${i} Örnek`);
    const vault = createPiiVault({ names });
    expect(vault.mask('Kişi0 Örnek ve Kişi5000 Örnek')).toBe('[kisi_1] ve Kişi5000 Örnek');
  });
});

describe('geri çevirme', () => {
  it('maskelenen metni aslına döndürür, bilinmeyen yer tutucuya dokunmaz', () => {
    const vault = createPiiVault({ names: ['Ahmet Yılmaz'] });
    const original = 'Ahmet Yılmaz için 0532 123 45 67 ve ahmet@example.com kaydedildi.';
    const masked = vault.mask(original);
    expect(masked).not.toContain('0532');
    expect(masked).not.toContain('Ahmet');
    expect(vault.unmask(masked)).toBe(original);
    expect(vault.unmask('Bilinmeyen [telefon_9] ve [kisi_7] ile [link] metni')).toBe('Bilinmeyen [telefon_9] ve [kisi_7] ile [link] metni');
    expect(vault.unmask('[TELEFON_1]')).toBe('0532 123 45 67');
  });

  it('bir türde en fazla 9999 yer tutucuyu geri çevirir', () => {
    const vault = createPiiVault();
    vault.mask(Array.from({ length: 10000 }, (_, i) => `k${i}@example.com`).join(' '));
    expect(vault.size).toBe(10000);
    expect(vault.unmask('[eposta_9999] [eposta_10000]')).toBe('k9998@example.com [eposta_10000]');
  });

  it('JSON içindeki yer tutucuyu geçerli JSON kalacak biçimde açar', () => {
    const vault = createPiiVault({ names: ['Ayşe "Kaya" Demir'] });
    vault.mask('Ayşe "Kaya" Demir 0532 123 45 67');
    const args = '{"customer_name":"[kisi_1]","note":"[telefon_1] numarasını arayın"}';
    expect(JSON.parse(vault.unmaskJson(args))).toEqual({
      customer_name: 'Ayşe "Kaya" Demir',
      note: '0532 123 45 67 numarasını arayın',
    });
  });

  it('canlı akışta parçalara bölünmüş yer tutucuyu birleştirip açar', () => {
    const vault = createPiiVault({ names: ['Ahmet Yılmaz'] });
    vault.mask('Ahmet Yılmaz 0532 123 45 67');
    const full = 'Tamam, [kisi_1] için [telefon_1] numarasını not ettim. [Not] bitti.';
    for (const size of [1, 2, 3, 5, 7, 11]) {
      const emitted: string[] = [];
      const restorer = vault.restorer((text) => emitted.push(text));
      for (let i = 0; i < full.length; i += size) restorer.push(full.slice(i, i + size));
      restorer.flush();
      expect(emitted.join('')).toBe('Tamam, Ahmet Yılmaz için 0532 123 45 67 numarasını not ettim. [Not] bitti.');
      expect(emitted.every((part) => !/\[(kisi|telefon)_/.test(part))).toBe(true);
    }
  });

  it('akış sonunda yarım kalan metni olduğu gibi verir', () => {
    const vault = createPiiVault();
    const emitted: string[] = [];
    const restorer = vault.restorer((text) => emitted.push(text));
    restorer.push('Liste: [a');
    expect(emitted.join('')).toBe('Liste: ');
    restorer.flush();
    expect(emitted.join('')).toBe('Liste: [a');
  });

  it('akışta en fazla 15 karakterlik kapanmamış kuyruğu bekletir', () => {
    const vault = createPiiVault();
    const emitted: string[] = [];
    const restorer = vault.restorer((text) => emitted.push(text));
    restorer.push('A [bcdefghijklmno');
    expect(emitted).toEqual(['A ']);
    restorer.push('p');
    expect(emitted).toEqual(['A ', '[bcdefghijklmnop']);
  });
});

describe('README örnekleri', () => {
  it('maskeler, geri çevirir, JSON argümanlarını ve akışı açar', () => {
    const vault = createPiiVault({ names: ['Ayşe Yılmaz'] });
    expect(vault.mask('Ayşe Yılmaz aradı, numarası 0532 123 45 67, e-postası ayse.yilmaz@example.com.')).toBe(
      '[kisi_1] aradı, numarası [telefon_1], e-postası [eposta_1].',
    );
    expect(vault.mask('AYŞE YILMAZ ve ayse   yilmaz')).toBe('[kisi_1] ve [kisi_1]');
    expect(vault.unmask('[kisi_1] için not aldım, [telefon_1] numarasından aranacak.')).toBe(
      'Ayşe Yılmaz için not aldım, 0532 123 45 67 numarasından aranacak.',
    );
    expect(vault.unmaskJson('{"musteri":"[kisi_1]","not":"[telefon_1] numarasını arayın"}')).toBe(
      '{"musteri":"Ayşe Yılmaz","not":"0532 123 45 67 numarasını arayın"}',
    );
    const parts: string[] = [];
    const restorer = vault.restorer((text) => parts.push(text));
    restorer.push('Tamam, [ki');
    restorer.push('si_1] için not aldım.');
    restorer.flush();
    expect(parts).toEqual(['Tamam, ', 'Ayşe Yılmaz için not aldım.']);
  });
});
