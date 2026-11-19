# SELATARA HEAT — CHARACTER STYLE LOCK (Appeal Pass, 2026-11-19)

Satu gaya untuk SEMUA orang. File ini mengunci arah visual karakter;
archetype yang melanggar file ini dianggap cacat. Rig, skinning, LOD,
pooling dan crowd TIDAK berubah oleh pass ini — ini murni gaya.

## Proporsi (stylized, ±6 kepala)

- Tinggi total = ±6× tinggi kepala (HEAD_RF 0.65; kepala ≈ 0,29 m pada
  figur 1,75 m). Kepala, tangan (handScale bawaan 1,14) dan sepatu
  (sol +~8% panjang, +~10% lebar) SENGAJA lebih besar dari realistis.
- Leher pendek-sedang (segmen terlihat ~0,011H), kepala duduk rendah,
  bahu tegas, lereng trapezius mengalir ke kepala.
- Anak: headScale 1,12 di atas badan kecil — bulat dan kecil.
- Semua archetype memakai tingkat detail yang sama (satu factory,
  satu set material, satu ramp shading).

## Bahasa bentuk per kelompok

| Kelompok | Bentuk dominan | Cara membaca |
|---|---|---|
| Protagonis & tokoh cerita | tegas + bulat, ramah | bahu tegas tapi sudut membulat; outline tipis |
| Aparat / antagonis | kotak dan runcing | bahu lebar (1,16–1,18), postur stiff, topi/helm bersudut |
| Warga biasa | bulat / lembut | bahu 0,94–1,06, siluet mengalir, warna kalem |
| Lansia / anak | bulat dan kecil | postur hunch (lansia), headScale besar (anak) |

## Elemen tanda tangan + palet per archetype

Aturan warna: maks 3 warna dominan + 1 aksen, rasio 60/30/10,
saturasi sedang (tidak neon, tidak pudar). Tokoh utama membawa aksen
kuat yang kontras dengan jalan/gedung; warga lebih kalem.

| Archetype | Elemen tanda tangan | Palet (60/30/10) |
|---|---|---|
| raka | jaket bomber marun | marun 0x6e1423 / celana arang 0x23242c / kulit tone 3 |
| mami | sanggul abu + kacamata bundar + kalung emas | blus merah 0xb83a4a / rok plum 0x4a2440 / emas |
| varga | topi perwira + kacamata hitam + kumis | navy arang 0x24303e / celana 0x1f2733 / lencana emas |
| dario | fedora krem + jas krem | krem 0xe9e2d0 / celana 0xd9d0ba / sepatu cokelat |
| patrol | topi + patch POLISI + radio dada | vest navy 0x1f3355 / celana 0x1a2742 / patch putih |
| detektif | dasi merah tua + lencana sabuk | kemeja pucat / celana gelap / dasi 0x6e1f2a |
| swat | helm + visor gelap + senapan | hitam 0x191c22 menyeluruh (siluet oleh helm/visor) |
| pilotHeli | helm putih + kacamata aviator | hijau zaitun 0x4a5548 / helm 0xdcd8ce |
| sindikatHawaii | kemeja hawaii motif bunga + tato lengan | krem bermotif / celana pendek / bunga koral |
| sindikatKulit | jaket kulit gelap + tato lengan | cokelat-hitam 0x2b2320 / celana gelap |
| penjagaGudang | topi + pistol | tee kusam / celana kerja |
| kurir | jaket cerah + tas selempang | oranye/biru/amber (diturunkan dari neon) / celana gelap |
| preman | rompi + tato lengan + badan besar | rompi tanah gelap / celana pendek |
| timHeist | topeng + ransel + senapan | hitam 0x17181c menyeluruh |
| turis | topi matahari lebar + kamera + kacamata | hawaii krem / celana pendek / kamera hitam |
| sekolah | ransel warna cerah | putih / merah atau biru / ransel |
| kantoran | blazer + tas kerja | blazer netral / celana gelap |
| pedagang | peci + batik | batik cokelat / celana tanah |
| warung | sanggul + rok + perut ramah | tee krem-hijau / rok tanah |
| nelayan | topi biru | tee biru laut / celana pendek |
| ojek | jaket hijau + helm oranye | hijau 0x2e7d32 / helm 0xcc3322 |
| jogger | tee sport cerah (saturasi sedang) | merah muda/teal/mustard lembut / celana pendek |
| ibuBelanja | tas belanja + rok | blus pastel / rok gelap |
| kakek | tongkat + rambut putih + bungkuk | abu kusam / celana cokelat tua |
| musisi | gitar + rambut afro/kuncir | tee garis / celana netral |
| pekerjaDermaga | rompi oranye + helm oranye | oranye 0xe86a1c / celana kerja |
| pasangan | blazer pastel | pastel / celana netral |
| ibuHijab | hijab warna kain bervariasi | kain ungu/biru/pink/hijau/tan / blus pucat |

## Shading & cahaya (terkunci)

- SOFT TOON: satu ramp gradien 4 langkah bersama (DataTexture 4×1,
  LinearFilter — langkah lembut, tidak keras, tidak flat) di kulit,
  baju, rambut. Tidak ada highlight spekular tajam di mana pun pada
  karakter (material lama MeshStandardMaterial diganti Toon).
- Rim light HANGAT dari belakang-samping khusus karakter (lab:
  0xffc890; di game nanti diwire pada Stage E — rim dunia yang biru
  bukan untuk orang).
- AO palsu vertex color: ketiak (0,80), lipatan siku/lutut (0,93),
  bawah dagu/leher (0,88–0,94), bawah kerah baju (0,90), pinggang
  bawah hem (0,95–0,97).
- Outline inverted-hull tipis (0,0038 m, cokelat gelap hangat
  0x2e1c11, bukan hitam murni) HANYA untuk lead: raka, mami, varga,
  dario. Ketebalan konstan.
- Blob shadow lembut di bawah kaki setiap karakter (radial, α 0,50
  pusat) — tidak ada yang melayang.

## Wajah (sederhana dan simpatik)

- Flat canvas, bersih: mata oval besar-sedang, putih krem 0xf2ede4,
  iris jelas + 1 titik highlight, garis kelopak atas tegas; alis
  tebal ekspresif warna rambut; fitur berjarak lebar (±13,5/256);
  hidung HANYA bayangan lembut + tinta hangat di ujung; mulut satu
  garis berlengkung; rahang bawah kecil membulat (jaw taper rig).
- Kulit: 8 tone hangat; variasi merah-kuning-oranye lembut di pipi
  (semua wajah 0,05; blush archetype 0,10), ujung hidung, dan zona
  telinga/leher.
- 5 ekspresi lewat swap tekstur — `char.setExpression(name)`:
  neutral, smile, serious, angry, surprised. Data lama (mouth
  grin/flat/stern) dipetakan otomatis: grin→smile, flat/stern→serious.
- Detail wajah yang ragu-ragu: HAPUS. Bersih mengalahkan detail meleset.

## Rambut

- Volume besar 2–3 lapis (cangkang berundak + lapisan luar), tepi
  bergerigi tidak beraturan, siluet jelas dari belakang dan samping.
- Warna DUA NADA dibake ke vertex: nada dasar (hitam kebiruan
  0x1b1e28 / cokelat tua — tidak pernah hitam pekat polos) + SATU
  pita terang melengkung lembut di atas mahkota. Bukan kilap logam,
  bukan spekular.
- Hijab = kain (material cloth), bukan rambut; warnanya dari daftar
  clothColors archetype.

## Pakaian

- Detail penjual dari TEKSTUR canvas (painter 'cloth'): jahitan
  putus-putus di sambungan, shading lipatan di hem/kerah, kolom
  kancing + kantong dada untuk jaket/blazer. Bukan mesh kecil.
- Lipatan geometri hanya dari loft badan sendiri (+offset) — tidak
  ada pakaian melebar seperti jubah, tidak ada celah gelap pinggang.
- Sepatu dan tangan dibesarkan dan dibulatkan; tangan mitten halus
  + jempol terpisah.

## Animasi yang terasa hidup

- Bobot: pelvis bob jalan 0,016 / lari 0,032 (dy saja — kalibrasi
  stride Tahap D tidak berubah; rasio stride tetap ~1,00).
- Antisipasi: shoot_pistol mencelup 60 ms sebelum recoil.
- Overlapping: rambut ayun (ponytail/long) spring yang sudah ada.
- Kepribadian: postur per archetype (aparat stiff, kakek hunch
  0,55, warung hunch 0,3), gait per archetype (kakek walk_old),
  idle variatif per archetype + fase acak per seed di lab/crowd.

## Tes kualitas (wajib lulus tiap perubahan gaya)

1. Siluet hitam di putih: 28 archetype terbedakan dari siluet saja.
2. Squint 64 px: sheet diperkecil — tokoh masih terbaca.
3. Grayscale: kepala / badan / kaki terpisah oleh nilai terang-gelap.
4. Jarak kamera game DARI BELAKANG: rambut + outline + blob terbaca.
5. Latar jalan / taman / pasar malam: karakter tidak menyatu latar.
6. Close-up cutscene: wajah tokoh utama simpatik, tidak seram.
