# Tefekkür VR

Meta Quest 3 üzerinde tarayıcıdan (WebXR) çalışan kişisel düşünce sindirme aracı. Gözlüğü takıp oturursun; kendi notlarından üretilmiş kelime ve cümleler belli aralıklarla derinlikten görüş hizana yaklaşır, bekler ve geri çekilir. Amaç 30–60 dakika boyunca tek bir konu üzerinde, dikkat dağılmadan tefekkür etmek.

**Canlı:** https://tarjai.github.io/tefekkur-vr/ · Headset yoksa: [?emu](https://tarjai.github.io/tefekkur-vr/?emu) (Meta Quest 3 emülatörü) · Hızlı izleme: `?emu&speed=30`

Tek kullanıcı, hesap yok, sunucu yok. Seans günlüğü yalnızca tarayıcının `localStorage`'ında durur.

## Nasıl çalışır

1. 2D ekranda deste ve süre (30 / 45 / 60 dk) seç, **VR'a Gir**'e bas.
2. Seans beş fazdan geçer:

| Faz | Oran | Ne olur |
| --- | --- | --- |
| Varış (`arrival`) | %8 | Prompt yok; nefes pulsu, ses yavaşça açılır |
| Tohum (`seed`) | %10 | Çekirdek kavram (`anchor`) tek başına, uzun süre |
| Derinleşme (`deepening`) | %60 | Prompt'lar çağrışım sırasıyla; her 5 prompt'ta bir anchor |
| Düzlük (`plateau`) | %14 | Prompt yok; ortam koyulaşır, drone bir oktav alt katman kazanır |
| Dönüş (`return`) | %8 | Anchor son kez, sonra kapanış sorusu; ortam aydınlanır, ses kısılır |

3. Her prompt 12 m'den 2 m'ye 20 sn'de (2 nefes) yaklaşır, okunur, 10 sn'de (1 nefes) geri çekilir. Göz hizasının 7° altında, seans başındaki bakış yönüne sabitlenmiş durur; başını çevirince peşinden gelmez. Belirirken prompt'un konumundan 3B bir çan çalar.
4. **Duraklat / devam:** kontrolcü tetiği ya da el takibinde parmakları kıstırmak (masaüstünde Boşluk). Duraklatınca sahne yarı yarıya kararır, saat, ses ve animasyon donar.
5. Seans bitince 2D ekrana dönülür; destenin kapanış sorusuna cevabını yazarsın. **Dışa aktar** tüm seansları tek bir Markdown dosyası olarak indirir.

## Kendi desteni üret

Notların `notes/` klasöründe durur (git'e girmez). Bir veya birkaç Markdown dosyasından deste üretmek için:

```bash
export ANTHROPIC_API_KEY=...        # ya da `ant auth login`
npx tsx scripts/build-deck.ts notes/zaman.md --out decks/zaman.json
```

- Model `ANTHROPIC_MODEL` ile seçilir (varsayılan `claude-sonnet-5-5`); notlar başka dilde olsa da çıktı Türkçedir (`--locale` ile değişir).
- Çıktı `src/deck/schema.ts` şemasıyla (zod) doğrulanır. Geçmezse hata gösterilir, bir kez yeniden denenir, yine geçmezse durur. 60 karakteri aşan prompt'lar kırpılmaz; reddedilir ve raporlanır.
- `--dry-run` API'yi çağırmadan isteği gösterir. Örnek not: [examples/notes/zaman.md](examples/notes/zaman.md).
- `decks/` içindeki her geçerli JSON build'e girer ve başlangıç ekranında listelenir. Örnek deste `decks/example.json` (id `ornek-zaman`).
- **Sıra önemli:** derinleşme fazında prompt'ların görünür süresi fazın %40'ını geçemediği için bir seansta destenin yalnızca baştaki içerik prompt'ları gösterilir (30 / 45 / 60 dk için yaklaşık 5 / 8 / 10); gerisi sondan düşer. En güçlü prompt'ları başa koy.

## Geliştirme

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # planner, saat, runner, deste yükleyici ve üretim hattı, ses zarfı, sahne matematiği, günlük, font
npm run build      # tsc + font glif kontrolü + statik çıktı (dist/)
```

**Masaüstünde test:** `http://localhost:5173/?emu` Meta'nın Quest 3 emülatörünü (IWER) yükler; Chrome'un Immersive Web Emulator eklentisi de çalışır. `?speed=30` 45 dakikalık seansı 90 saniyede oynatır.

**Quest'te test (tercih edilen):** gözlüğü USB ile bağla, `adb reverse tcp:5173 tcp:5173`, Quest Browser'da `http://localhost:5173` aç (localhost güvenli bağlam sayılır, HTTPS gerekmez). Ya da doğrudan GitHub Pages adresini kullan: `main` dalına her push testleri çalıştırır ve siteyi yeniden yayınlar.

## Yapı

```
index.html              2D başlangıç ve kapanış ekranı
decks/                  deste JSON dosyaları (build'e statik girer)
notes/                  ham Markdown notların (git'e girmez)
scripts/build-deck.ts   notes/*.md → decks/*.json
scripts/lib/            deste işleme hattı, font glif denetimi (Vite eklentisi)
public/fonts/           Noto Sans (Türkçe karakterler tam, OFL lisanslı)
src/config.ts           tüm süreler, mesafeler, oranlar, renkler
src/strings.ts          arayüz metinleri (Türkçe)
src/deck/               şema (uygulama ve script ortak) ve yükleyici
src/session/            saat, planner (saf, test edilir), runner (olay yayar)
src/scene/              sahne çerçevesi, ortam, prompt görünümü, nefes, duraklatma örtüsü
src/audio/              AudioContext, prosedürel drone ve çan, ses zarfı
src/input/pause.ts      select → duraklat/devam
src/log/sessionLog.ts   seans günlüğü ve Markdown dışa aktarım
src/main.ts             XR oturumu ve modüllerin birbirine bağlanması
```

Modüller birbirini doğrudan çağırmaz: `runner` zaman çizelgesindeki olayları yayar, sahne, ses ve günlük `main.ts`'de bu olaylara abone olur. Tüm animasyonlar XR karesinin zamanıyla ilerler, kare sayısıyla değil.

## Bağımlılıklar ve gerekçeleri

| Paket | Neden |
| --- | --- |
| `three` | 3B sahne ve `WebXRManager` (`immersive-vr`) |
| `troika-three-text` | Keskin SDF metin; Türkçe glifler tek yerel fonttan |
| `zod` | Deste şeması: uygulama ve üretim script'i aynı doğrulamayı kullanır |
| `@anthropic-ai/sdk` (dev) | `build-deck` script'i notlardan deste üretir |
| `vite`, `typescript` (dev) | Build, dev server, sıkı tip denetimi |
| `vitest` (dev) | Planner birim testleri; Vite ile aynı dönüşüm hattı |
| `tsx` (dev) | `build-deck.ts` script'ini derlemeden çalıştırmak |
| `iwer` (dev) | `?emu` ile headset olmadan uçtan uca test; yalnız istenince yüklenir |

Font: [Noto Sans](public/fonts/OFL.txt), SIL Open Font License 1.1.
