#!/usr/bin/env node
/* plan.md → naim.nextusservis.com/plan

   Kullanım:
     node araclar/plan-yukle.mjs                      Masaüstü\DeepCore\plan.md'yi yükler
     node araclar/plan-yukle.mjs <plan.md>            başka dosya
     node araclar/plan-yukle.mjs --deneme             yüklemeden önce yerelde okur, özet verir

   Ayar (biri yeter; depoya ASLA girmez):
     ortam:  PLAN_ADRES, PLAN_ANAHTAR
     dosya:  %USERPROFILE%\.nextus-plan.json   { "adres": "https://naim.nextusservis.com", "anahtar": "..." }

   Anahtar hiçbir koşulda ekrana yazılmaz.
   Aynı plan iki kez yüklenirse kopya oluşmaz; yapılmış, taşınmış ya da elle düzeltilmiş görev korunur. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planAyristir } from '../sunucu/plan-ayristir.mjs';

const argumanlar = process.argv.slice(2);
const deneme = argumanlar.includes('--deneme');
const dosya = path.resolve(argumanlar.find((a) => !a.startsWith('--')) || path.join(os.homedir(), 'Desktop', 'DeepCore', 'plan.md'));
const GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

function cik(mesaj, kod = 1) { console.error(mesaj); process.exit(kod); }

if (!fs.existsSync(dosya)) cik(`❌ Plan dosyası yok: ${dosya}`);
const metin = fs.readFileSync(dosya, 'utf8');
const p = planAyristir(metin);

console.log(`\n📄 ${path.basename(dosya)} — ${p.baslik || '(başlıksız)'}`);
for (const g of p.gunler) {
  const d = new Date(g.gun + 'T12:00:00');
  console.log(`   ${GUN[d.getDay()]} ${g.gun}  ${String(g.gorevler.length).padStart(2)} görev`);
}
const toplam = p.gunler.reduce((n, g) => n + g.gorevler.length, 0);
console.log(`   ${toplam} görev, ${p.gunler.length} gün`);
if (p.uyarilar.length) {
  console.log('\n⚠️  Uyarılar:');
  for (const u of p.uyarilar) console.log('   · ' + u);
}
if (!p.gunler.length) cik('\n❌ Dosyada "## YYYY-MM-DD Gün" başlığı yok; yüklenecek bir şey bulunamadı.');
if (deneme) { console.log('\n(deneme — yüklenmedi)\n'); process.exit(0); }

function ayarOku() {
  if (process.env.PLAN_ADRES && process.env.PLAN_ANAHTAR) {
    return { adres: process.env.PLAN_ADRES, anahtar: process.env.PLAN_ANAHTAR };
  }
  const yol = path.join(os.homedir(), '.nextus-plan.json');
  try {
    const v = JSON.parse(fs.readFileSync(yol, 'utf8'));
    if (v.adres && v.anahtar) return v;
  } catch { /* aşağıda */ }
  cik(`\n❌ Ayar yok. ${yol} dosyasını oluştur:\n   { "adres": "https://naim.nextusservis.com", "anahtar": "<PLAN_ANAHTAR>" }`);
}

const ayar = ayarOku();
const hedef = ayar.adres.replace(/\/+$/, '') + '/api/plan/yukle';

let c;
try {
  c = await fetch(hedef, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ayar.anahtar },
    body: JSON.stringify({ metin }),
    signal: AbortSignal.timeout(30e3)
  });
} catch (h) {
  const kod = String((h && h.cause && h.cause.code) || (h && h.code) || '');
  // Kurumsal ağ (FortiGate) HTTPS'i kendi sertifikasıyla yeniden imzalar; Node bunu tanımaz,
  // Windows tanır. Bir kez sistem sertifikalarıyla tekrar dene.
  if (/CERT|SELF_SIGNED|ISSUER|UNABLE_TO_VERIFY/.test(kod) && !process.execArgv.includes('--use-system-ca')) {
    console.log('\n↻ Ağ HTTPS sertifikasını yeniden imzalıyor; sistem sertifikalarıyla tekrar deneniyor…');
    const r = spawnSync(process.execPath, ['--use-system-ca', ...process.execArgv, process.argv[1], ...argumanlar], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  cik(`\n❌ Sunucuya ulaşılamadı (${kod || (h && h.name) || 'bağlantı'}). İnternet bağlantısını ve ${ayar.adres} adresini kontrol et.`);
}

let v = {};
try { v = await c.json(); } catch { /* gövdesiz */ }

if (c.ok) {
  const o = v.ozet || {};
  console.log(`\n✅ Yüklendi → ${ayar.adres.replace(/\/+$/, '')}/plan/`);
  console.log(`   ${o.eklenen ?? 0} yeni · ${o.guncellenen ?? 0} güncellendi · ${o.korunan ?? 0} korundu · ${o.silinen ?? 0} kaldırıldı`);
  if (o.silinen) console.log('   (kaldırılanlar: planda artık olmayan, dokunulmamış görevler — yapılmışlar silinmez)');
  if (o.atlanan) console.log(`   ${o.atlanan} görev geri getirilmedi — telefonda bilerek silinmişti`);
  console.log('');
  process.exit(0);
}

const SEBEP = {
  kurulmadi: 'Sunucuda PLAN_SIFRE tanımlı değil — Coolify ortam değişkenlerini ekleyip yeniden dağıt.',
  oturum: 'Anahtar reddedildi — .nextus-plan.json içindeki anahtar ile Coolify\'daki PLAN_ANAHTAR aynı mı?',
  depolama: 'Sunucu veri klasörüne yazamıyor — Coolify → Storages → /app/veri birimini kontrol et.',
  bos: 'Sunucu dosyada gün bulamadı.',
  buyuk: 'Dosya çok büyük (512 KB üstü).'
};
cik(`\n❌ ${c.status}: ${SEBEP[v.sebep] || v.sebep || 'bilinmeyen hata'}\n`);
