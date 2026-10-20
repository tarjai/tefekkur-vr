// Deste üretim script'i: Markdown notları → Claude → zod ile doğrulanmış deste JSON'u.
// Kullanım: npx tsx scripts/build-deck.ts notes/zaman.md --out decks/zaman.json
// Saf mantık (talimat, doğrulama, rapor) scripts/lib/deckPipeline.ts içinde; burada yalnız G/Ç ve API çağrısı var.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import {
  DECK_FALLBACK_BETA,
  DECK_FALLBACK_MODELS,
  DECK_MAX_RETRIES,
  DECK_MAX_TOKENS,
  DEFAULT_DECK_MODEL,
  LOCALE,
} from '../src/config';
import { DeckSchema } from '../src/deck/schema';
import {
  DECK_OUTPUT_JSON_SCHEMA,
  buildRetryMessage,
  buildSystemPrompt,
  buildUserContent,
  formatReport,
  parseModelText,
  processModelOutput,
  slugifyId,
  type NoteInput,
  type ProcessOptions,
  type ProcessResult,
} from './lib/deckPipeline';

const USAGE = `Kullanım:
  npx tsx scripts/build-deck.ts <not.md> [<not2.md> …] --out <deste.json> [seçenekler]
  npm run build-deck -- <not.md> [<not2.md> …] --out <deste.json> [seçenekler]

Markdown notlarından Claude ile tefekkür destesi (JSON) üretir ve src/deck/schema.ts şemasıyla doğrular.

Seçenekler:
  -o, --out <dosya>    Çıktı JSON dosyası (--dry-run dışında zorunlu). Klasör yoksa oluşturulur.
      --locale <kod>   Deste dili (varsayılan: ${LOCALE}). Notlar başka dilde olsa da prompt'lar bu dilde üretilir.
      --id <slug>      Deste id'si: küçük harf, rakam, tire (varsayılan: çıktı dosyasının adı).
      --title <metin>  Deste başlığı (varsayılan: modelin önerisi).
      --dry-run        API'yi çağırmaz: sistem talimatını, içerik boyutunu ve istek parametrelerini yazdırır.
  -h, --help           Bu yardımı gösterir.

Ortam değişkenleri:
  ANTHROPIC_API_KEY    Anthropic API anahtarı (ya da \`ant auth login\` ile kaydedilmiş profil).
  ANTHROPIC_MODEL      Kullanılacak model (varsayılan: ${DEFAULT_DECK_MODEL}).

Örnek:
  npx tsx scripts/build-deck.ts notes/zaman.md --out decks/zaman.json`;

const AUTH_HELP = `Deste üretmek için bir Anthropic API anahtarı gerekir. İki yol var:
  1) Anahtarı ANTHROPIC_API_KEY ortam değişkenine koy, sonra komutu yeniden çalıştır:
       PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."
       bash / zsh:  export ANTHROPIC_API_KEY="sk-ant-..."
  2) Ya da Anthropic CLI ile bir kez oturum aç:  ant auth login
Anahtarı koda ya da git'e giren bir dosyaya yazma. API'yi çağırmadan denemek için: --dry-run`;

/** Kullanıcıya gösterilecek, yığın izi gerektirmeyen hata. */
class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function num(n: number): string {
  return n.toLocaleString(LOCALE);
}

// ---------- Argümanlar ----------

const PARSE_ERRORS: Record<string, string> = {
  ERR_PARSE_ARGS_UNKNOWN_OPTION: 'Bilinmeyen seçenek.',
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE: 'Seçeneğin değeri eksik ya da geçersiz.',
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL: 'Beklenmeyen argüman.',
};

function parseCli(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: 'string', short: 'o' },
        locale: { type: 'string' },
        id: { type: 'string' },
        title: { type: 'string' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const tr = typeof code === 'string' ? PARSE_ERRORS[code] : undefined;
    return fail(`${tr ?? 'Geçersiz argüman.'} (${errorMessage(err)})\nYardım için: --help`);
  }
}

function resolveLocale(input: string | undefined): string {
  if (input === undefined) return LOCALE;
  try {
    const [canonical] = Intl.getCanonicalLocales(input.trim());
    if (canonical && DeckSchema.shape.locale.safeParse(canonical).success) return canonical;
  } catch {
    // aşağıda hata verilir
  }
  return fail(`Geçersiz dil kodu: "${input}" (ör. tr, en).`);
}

/** --id verilmişse doğrular; yoksa çıktı dosyasının adından türetir (geçersizse modelin önerisi kullanılır). */
function resolveId(explicit: string | undefined, out: string | undefined): { id?: string; source: string } {
  if (explicit !== undefined) {
    const check = DeckSchema.shape.id.safeParse(explicit);
    if (!check.success) fail(`Geçersiz --id "${explicit}": ${check.error.issues[0]?.message ?? 'biçim hatalı'}`);
    return { id: explicit, source: '--id' };
  }
  if (out) {
    const derived = slugifyId(path.parse(out).name);
    if (DeckSchema.shape.id.safeParse(derived).success) return { id: derived, source: 'çıktı dosyasının adı' };
  }
  return { source: 'model önerir' };
}

async function readNotes(files: string[]): Promise<NoteInput[]> {
  const notes: NoteInput[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      return fail(code === 'ENOENT' ? `Not dosyası bulunamadı: ${file}` : `Not dosyası okunamadı: ${file} (${errorMessage(err)})`);
    }
    if (!content.replace(/^﻿/, '').trim()) fail(`Not dosyası boş: ${file}`);
    const name = path.basename(file);
    if (seen.has(name)) fail(`Aynı adlı iki not var: ${name} (sourceNote dosya adıdır, benzersiz olmalı).`);
    seen.add(name);
    if (path.extname(name).toLocaleLowerCase(LOCALE) !== '.md') console.warn(`Uyarı: ${file} Markdown (.md) dosyası değil gibi görünüyor.`);
    notes.push({ file: name, content });
  }
  return notes;
}

// ---------- API ----------

function usesFallback(model: string): boolean {
  return (DECK_FALLBACK_MODELS as readonly string[]).includes(model);
}

/** SDK'nın kimlik bilgisi bulunamadığında fırlattığı hata (tipli sınıfı yok; ilk istekte düz Error olarak gelir). */
function isMissingCredentials(err: unknown): boolean {
  return (
    err instanceof Error &&
    !(err instanceof Anthropic.APIError) &&
    /Could not resolve authentication method|Profile ".*" could not be resolved/.test(err.message)
  );
}

function apiFailure(err: unknown, model: string): never {
  if (err instanceof Anthropic.AuthenticationError) {
    fail(`Kimlik doğrulama başarısız (401): API anahtarı geçersiz ya da iptal edilmiş.\n${AUTH_HELP}`);
  }
  if (isMissingCredentials(err)) {
    fail(`Kimlik doğrulama başarısız: Anthropic API anahtarı bulunamadı (ANTHROPIC_API_KEY tanımlı değil, kayıtlı profil yok).\n${AUTH_HELP}`);
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    fail(`Erişim reddedildi (403): bu anahtarın "${model}" modeline ya da bu özelliğe erişimi yok.\n  ${err.message}`);
  }
  if (err instanceof Anthropic.NotFoundError) {
    fail(`Model bulunamadı (404): "${model}". ANTHROPIC_MODEL değerini kontrol et.\n  ${err.message}`);
  }
  if (err instanceof Anthropic.BadRequestError) {
    fail(`İstek reddedildi (400): ${err.message}`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    fail(`Hız sınırına takıldı (429); birkaç dakika sonra yeniden dene.\n  ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    fail(`API'ye bağlanılamadı: ${err.message}\n  İnternet bağlantını kontrol et.`);
  }
  if (err instanceof Anthropic.APIError) {
    fail(`API hatası${err.status ? ` (${err.status})` : ''}: ${err.message}`);
  }
  throw err;
}

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

async function requestDeck(client: Anthropic, model: string, system: string, messages: BetaMessageParam[]): Promise<BetaMessage> {
  try {
    return await client.beta.messages.create({
      model,
      max_tokens: DECK_MAX_TOKENS,
      ...(usesFallback(model) ? { betas: [DECK_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      system,
      messages,
      output_config: { format: { type: 'json_schema', schema: DECK_OUTPUT_JSON_SCHEMA } },
    });
  } catch (err) {
    return apiFailure(err, model);
  }
}

/** İçeriği okumadan önce durma nedenini denetler; deste üretilemeyecek durumlarda durur. */
function checkStop(response: BetaMessage): void {
  switch (response.stop_reason) {
    case 'refusal': {
      const d = response.stop_details;
      const lines = ['Model isteği reddetti (stop_reason: refusal).'];
      if (d?.category) lines.push(`  Kategori: ${d.category}`);
      if (d?.explanation) lines.push(`  Açıklama: ${d.explanation}`);
      lines.push('  Notların içeriğini gözden geçirip yeniden dene.');
      return fail(lines.join('\n'));
    }
    case 'max_tokens':
      return fail(
        `Model çıktısı ${num(DECK_MAX_TOKENS)} token sınırına takıldı; deste yarım kaldı (stop_reason: max_tokens).\n` +
          '  Daha kısa notlarla yeniden dene ya da DECK_MAX_TOKENS değerini (src/config.ts) artır.',
      );
    case 'model_context_window_exceeded':
      return fail('Notlar modelin bağlam penceresini aştı; daha az ya da daha kısa not ver.');
    default:
      return;
  }
}

function responseText(response: BetaMessage): string {
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function reportResponse(response: BetaMessage): void {
  for (const block of response.content) {
    if (block.type === 'fallback') {
      console.error(`Not: ${block.from.model} isteği reddetti; yanıtı yedek model ${block.to.model} üretti.`);
    }
  }
  const u = response.usage;
  console.error(`Kullanım: ${num(u.input_tokens)} girdi / ${num(u.output_tokens)} çıktı token (${response.model}).`);
}

// ---------- Akış ----------

function printDryRun(params: {
  model: string;
  modelFromEnv: boolean;
  locale: string;
  notes: NoteInput[];
  userContent: string;
  system: string;
  out?: string;
  id: { id?: string; source: string };
  title?: string;
}): void {
  const { model, notes, userContent, system } = params;
  const fallback = usesFallback(model);
  const lines = [
    'Kuru çalıştırma — API çağrılmadı.',
    '',
    `Notlar (${notes.length}):`,
    ...notes.map((n) => `  - ${n.file}: ${num([...n.content].length)} karakter`),
    `Kullanıcı içeriği: ${num([...userContent].length)} karakter, ${num(Buffer.byteLength(userContent, 'utf8'))} bayt (UTF-8)`,
    `Çıktı: ${params.out ?? '(verilmedi; gerçek çalıştırmada --out zorunlu)'}`,
    `Deste id: ${params.id.id ?? '—'} (${params.id.source}); başlık: ${params.title ?? '(model önerir)'}`,
    '',
    'İstek parametreleri (client.beta.messages.create):',
    `  model: ${model} (${params.modelFromEnv ? 'ANTHROPIC_MODEL' : 'varsayılan; ANTHROPIC_MODEL ile değişir'})`,
    `  max_tokens: ${DECK_MAX_TOKENS}`,
    fallback
      ? `  betas: ["${DECK_FALLBACK_BETA}"]\n  fallbacks: "default" (ret durumunda sunucu tarafı yedek model)`
      : '  betas / fallbacks: gönderilmez (bu model sunucu tarafı yedeği desteklemiyor)',
    '  output_config.format: json_schema (deste şekli; sınırlar sonradan zod ile denetlenir)',
    '  thinking: gönderilmez',
    `  locale: ${params.locale}`,
    `  yeniden deneme: şemaya uymazsa en fazla ${DECK_MAX_RETRIES} kez`,
    '',
    `--- Sistem talimatı (${num([...system].length)} karakter) ---`,
    system,
    '',
    '--- Çıktı JSON şeması ---',
    JSON.stringify(DECK_OUTPUT_JSON_SCHEMA, null, 2),
  ];
  console.log(lines.join('\n'));
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseCli(argv);
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const dryRun = values['dry-run'] ?? false;
  if (positionals.length === 0) fail('En az bir Markdown not dosyası ver.\nYardım için: --help');
  if (!values.out && !dryRun) fail('Çıktı dosyası gerekli: --out <deste.json>\nYardım için: --help');
  const title = values.title?.trim();
  if (values.title !== undefined && !title) fail('--title boş olamaz.');

  const locale = resolveLocale(values.locale);
  const idChoice = resolveId(values.id, values.out);
  const envModel = process.env.ANTHROPIC_MODEL?.trim();
  const model = envModel || DEFAULT_DECK_MODEL;

  const notes = await readNotes(positionals);
  const system = buildSystemPrompt(locale);
  const userContent = buildUserContent(notes);

  if (dryRun) {
    printDryRun({ model, modelFromEnv: !!envModel, locale, notes, userContent, system, out: values.out, id: idChoice, title });
    return 0;
  }

  const out = values.out as string;
  const processOptions: ProcessOptions = {
    locale,
    ...(idChoice.id !== undefined ? { id: idChoice.id } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(notes.length === 1 ? { sourceNote: notes[0]!.file } : { notes: notes.map((n) => n.file) }),
  };

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch (err) {
    return fail(`Anthropic istemcisi oluşturulamadı: ${errorMessage(err)}\n${AUTH_HELP}`);
  }

  const messages: BetaMessageParam[] = [{ role: 'user', content: userContent }];
  const attempts = DECK_MAX_RETRIES + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    console.error(`Model çağrılıyor: ${model} (deneme ${attempt}/${attempts})…`);
    const response = await requestDeck(client, model, system, messages);
    checkStop(response);
    reportResponse(response);

    const parsed = parseModelText(responseText(response));
    let result: ProcessResult;
    if (parsed.ok) {
      result = processModelOutput(parsed.value, processOptions);
    } else {
      console.error(`${parsed.error}\n--- Ham çıktı önizlemesi ---\n${parsed.preview}\n---`);
      result = { deck: null, rejected: [], errors: [parsed.error], warnings: [] };
    }

    if (result.deck) {
      await mkdir(path.dirname(path.resolve(out)), { recursive: true });
      await writeFile(out, `${JSON.stringify(result.deck, null, 2)}\n`, 'utf8');
      console.log(formatReport(result));
      console.log(`\nDeste yazıldı: ${out}`);
      return 0;
    }

    console.error(`Deste şemaya uymadı (deneme ${attempt}/${attempts}).\n${formatReport(result)}`);
    if (attempt < attempts) {
      console.error('Hatalar modele bildirilip yeniden deneniyor…');
      // Asistan turu olduğu gibi geri gönderilir (düşünme blokları dahil; ayıklanırsa API imza hatası verebilir).
      messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: buildRetryMessage(result) });
    }
  }

  return fail(`Deste ${attempts} denemede de şemaya uymadı; durduruldu. Hiçbir dosya yazılmadı.`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof CliError) console.error(`Hata: ${err.message}`);
    else console.error('Beklenmeyen hata:', err);
    process.exitCode = 1;
  },
);
