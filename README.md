# @pmwdigital/kvkk-maske

Metni bir dil modeline (LLM) göndermeden önce içindeki kişisel verileri
`[telefon_1]` gibi yer tutucularla değiştirir. Hangi yer tutucunun hangi değerin
yerine geçtiğini bellekte saklar ve modelin cevabındaki yer tutucuları yeniden
asıl değerlere çevirir. Cevap parça parça akarken de çalışır.

Kişi adlarını (sizin verdiğiniz listeden), telefon numarasını, e-posta adresini,
TC kimlik numarasını, kart numarasını ve IBAN'ı tanır. Bağımlılığı yoktur.
TypeScript ile yazılmıştır, ESM olarak dağıtılır.

## Neden

Model, işini yapmak için çoğu zaman müşterinin gerçek adını ya da telefon
numarasını bilmek zorunda değildir. `[kisi_1]` ya da `[telefon_1]` demesi yeter.
Modele gönderdiğiniz bir veriyi geri alamazsınız, sağlayıcının sistemlerinde ve
kayıtlarında kalabilir. Bu yüzden modele olabildiğince az kişisel veri göndermek
gerekir.

Aynı değer her seferinde aynı yer tutucuyu alır. `0532 123 45 67` ile
`+90 532 123 45 67` aynı numaradır, ikisi de `[telefon_1]` olur. Böylece model,
metnin farklı yerlerinde geçen aynı kişiyi ya da numarayı yine aynı şey olarak görür.

## Kurulum

```bash
npm install github:pmwdigital/pmw-kvkk-maske
```

Kodun tamamı tek bir dosyadır (`src/index.ts`) ve başka hiçbir şey içe aktarmaz.
Node'a özgü bir API kullanmaz; Node 20 ve üstünde, Deno'da, edge ortamlarında ve
tarayıcıda çalışır. Paket kurmanın zor olduğu bir ortamda bu dosyayı olduğu gibi
kopyalayabilirsiniz.

## Kullanım

`createPiiVault` bir kasa oluşturur. Kasa, hangi yer tutucunun hangi değere karşılık
geldiğini bellekte tutar.

```ts
import { createPiiVault } from "@pmwdigital/kvkk-maske";

const vault = createPiiVault({ names: ["Ayşe Yılmaz"] });

vault.mask("Ayşe Yılmaz aradı, numarası 0532 123 45 67, e-postası ayse.yilmaz@example.com.");
// "[kisi_1] aradı, numarası [telefon_1], e-postası [eposta_1]."
```

Modele yalnızca maskelenmiş metni gönderin. `PII_PLACEHOLDER_NOTE` sabitini de
sistem talimatına ekleyin: bu kısa Türkçe metin modelden yer tutucuları olduğu gibi
yazmasını ve açmaya çalışmamasını ister.

Modelin cevabını kullanıcıya göstermeden önce açın:

```ts
vault.unmask("[kisi_1] için not aldım, [telefon_1] numarasından aranacak.");
// "Ayşe Yılmaz için not aldım, 0532 123 45 67 numarasından aranacak."
```

Kasada olmayan yer tutuculara (`[kisi_7]` gibi) ve köşeli parantez içindeki başka
metinlere dokunulmaz. Büyük küçük harf fark etmez, `[TELEFON_1]` de açılır.
`vault.size` kasadaki farklı değerlerin sayısını verir.

### Araç çağrıları

Model bir aracı yer tutucuyla çağırırsa argümanları `unmaskJson` ile açın. Değerdeki
tırnak gibi karakterler JSON kurallarına göre kaçışlanır, sonuç geçerli JSON olarak kalır:

```ts
vault.unmaskJson('{"musteri":"[kisi_1]","not":"[telefon_1] numarasını arayın"}');
// '{"musteri":"Ayşe Yılmaz","not":"0532 123 45 67 numarasını arayın"}'
```

Aracın sonucunu modele geri gönderirken onu da aynı kasayla maskeleyin. Aynı değer
yine aynı yer tutucuyu alır.

### Akan cevaplar

Cevap parça parça gelirken bir yer tutucu iki parçaya bölünebilir. `restorer`, gelen
metnin sonunda `[` ile başlayan ve henüz kapanmamış kısa bir kısım varsa onu bir
sonraki parçaya kadar bekletir, gerisini hemen açıp verir. Akış bitince `flush`
çağırın; bekleyen bir kısım varsa olduğu gibi verilir.

```ts
const parts: string[] = [];
const restorer = vault.restorer((text) => parts.push(text));

restorer.push("Tamam, [ki");
restorer.push("si_1] için not aldım.");
restorer.flush();

parts; // ["Tamam, ", "Ayşe Yılmaz için not aldım."]
```

Bekletilen kısım en fazla 15 karakterdir. En uzun yer tutucu (`[telefon_9999]`)
14 karakter olduğu için daha uzun bir kısım beklemeden verilir.

## Neyi tanır

| Tür | Yer tutucu | Ne zaman maskelenir |
| --- | --- | --- |
| Kişi adı | `[kisi_1]` | `names` listesinde varsa. Türkçe harf ve büyük küçük harf farkı gözetilmez, `AYŞE YILMAZ` ile `ayse yilmaz` aynı addır. Kelimeler arasındaki boşluğun sayısı önemli değildir. |
| Telefon | `[telefon_1]` | Türkiye biçimleri (`0532 123 45 67`, `+90 532 123 45 67`, `0090 532 123 45 67`, `(0532) 123-45-67`, `5321234567`, sabit hat `0212 123 45 67`) ve `+` ile başlayan yurt dışı numaraları |
| E-posta | `[eposta_1]` | `ad@alanadi.com` biçimindeyse |
| TC kimlik no | `[tc_no_1]` | 11 haneliyse ve iki kontrol hanesi tutuyorsa |
| Kart no | `[kart_1]` | 15 ya da 16 haneliyse, ilk hanesi 3, 4, 5, 6 ya da 9 ise ve Luhn denetiminden geçiyorsa |
| IBAN | `[iban_1]` | ISO 13616 mod 97 denetiminden geçiyorsa. TR ile başlayan IBAN ayrıca 26 karakter olmalıdır. |

Ad listesi için kurallar:

- Ad en az iki kelime olmalı ve her kelimede en az iki harf bulunmalıdır. Tek
  kelimelik adlar (`Ali` gibi) gündelik kelimelerle karışacağı için atlanır.
- Ad başka bir kelimenin parçası olarak geçiyorsa maskelenmez. Listede
  `Ahmet Yılmaz` varsa `Ahmet Yılmazoğlu` olduğu gibi kalır.
- Bir ad başka bir adın başıysa (`Ayşe Kaya` ve `Ayşe Kaya Demir`) önce uzun olan aranır.
- Listeden en fazla 5000 farklı ad kullanılır, fazlası yok sayılır.
- `unmask` adı metindeki yazılışıyla değil, listede ilk verdiğiniz biçimiyle geri koyar.

TCKN ve IBAN denetimi `@pmwdigital/tr` ile aynı kurallara uyar. Bu paket edge ve
Deno ortamlarında kolay kurulsun diye ona bağımlı değildir, kurallar burada ayrıca
yazılmıştır. Denetim işlevlerini ayrıca da kullanabilirsiniz:

```ts
import { foldText, isValidIban, isValidTckn, passesLuhn } from "@pmwdigital/kvkk-maske";

isValidTckn("10000000146");                      // true
isValidIban("TR33 0006 1005 1978 6457 8413 26"); // true
passesLuhn("4111111111111111");                  // true
foldText("AYŞE YILMAZ");                         // "ayse yilmaz"
```

`foldText` harfleri küçültür ve Türkçe harfleri sadeleştirir (`Ş` yerine `s`, `İ`
yerine `i`). Metnin uzunluğu değişmez, bu yüzden sadeleştirilmiş metinde bulunan
bir ad asıl metinde de aynı yerdedir.

## Sınırlar

- Listede olmayan adlar, tek kelimelik adlar ve adın yalnızca bir kısmı
  (`Ayşe Hanım` gibi) maskelenmez.
- Adres, doğum tarihi, plaka, sağlık bilgisi gibi diğer kişisel veriler hiç aranmaz.
- Kontrol hanesi tutmayan TCKN, kart ve IBAN numaraları, yanlış yazılmış olanlar
  da dahil, olduğu gibi kalır.
- `+` olmadan yazılmış yurt dışı numaraları (`0044 20 7946 0958` gibi) yakalanmaz.
- Bir kasada aynı türden en fazla 9999 farklı değer geri çevrilebilir.
- Kasa eşleşmeleri yalnızca bellekte tutar, bir yere yazmaz ve listesini dışarı
  vermez. Bir kasayı tek bir konuşmanın içinde kullanın. Farklı kişilerin verisi
  aynı kasaya girerse birinin değeri ötekinin cevabında açılabilir.
- Tarayıcıda Safari 16.4 ya da üstü gerekir, çünkü düzenli ifadelerde geriye
  bakma (lookbehind) kullanılır.
- Bu kütüphane modele giden kişisel veriyi azaltır, tamamen ortadan kaldırmaz.
  KVKK'ya ya da başka bir düzenlemeye uyumu tek başına sağlamaz ve hukuki
  değerlendirmenin yerini tutmaz.

## Geliştirme

```bash
npm install
npm test
npm run typecheck
npm run build
```

Kapsam 18 testtir. Testlerdeki adlar uydurmadır, e-postalar `example.com` alan
adını kullanır. TCKN `10000000146` ve IBAN `TR33 0006 1005 1978 6457 8413 26`
yayımlanmış örneklerdir, `4111 1111 1111 1111` herkesin kullandığı test kartıdır.

## Lisans

MIT
