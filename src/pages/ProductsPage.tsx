import { Fragment, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Boxes,
  Images,
  ImageUp,
  Layers,
  Lock,
  PackagePlus,
  Plus,
  Power,
  PowerOff,
  Puzzle,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  describeModifierGroups,
  suggestGroupCode,
  suggestOptionCode,
  type ModifierGroup,
} from "@/lib/modifiers";
import {
  categoryNameKey,
  categorySkuCode,
  deleteCategorySentence,
  duplicateCategoryCodes,
  selectableCategoryNames,
  validateCategoryName,
} from "@/lib/categories";
import {
  canAddProductImage,
  describeProductImages,
  MAX_PRODUCT_IMAGES,
  prepareProductImage,
  productImageSlots,
  PRODUCT_IMAGE_TYPES,
  readImageAsDataUrl,
  remainingProductImageSlots,
  validateProductImage,
} from "@/lib/productImages";
import { PRODUCT_SKU_PREFIX, suggestProductSku } from "@/lib/productSku";
import { productStatusSentence } from "@/lib/productEdit";
import type { StoreCategory, StoreProduct } from "@/lib/store";
import type { ProductDeletionInfo } from "@/lib/store";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/usePermission";
import { describeTiers, sortTiers } from "@/lib/wholesale";
import { formatIDR } from "@/lib/utils";

interface Draft {
  /** Nama produk yang tampil di kasir, struk, dan laporan. */
  name: string;
  /** SKU (dipakai apa adanya, unik per workspace). */
  sku: string;
  /** Harga beli per satuan dasar; dipakai menghitung margin di laporan. */
  cost: string;
  /** Kategori produk; kosong = tanpa kategori. Mengubahnya ikut mengubah SKU. */
  category: string;
  price: string;
  unit: string;
  units: { code: string; factor: string }[];
  tiers: { minQty: string; price: string }[];
}

const EMPTY_GROUP: ModifierDraftGroup = {
  name: "",
  min: "1",
  max: "1",
  options: [{ name: "", price: "0" }],
};

/** Draf modifier memakai nama saja; kodenya diusulkan otomatis saat disimpan. */
interface ModifierDraftGroup {
  name: string;
  min: string;
  max: string;
  options: { name: string; price: string }[];
}

/**
 * Editor modifier item (modul F&B). Sengaja hanya meminta nama + batas pilihan +
 * harga: kode grup/opsi diusulkan otomatis dari nama saat disimpan, supaya
 * pemilik toko tidak perlu mengarang kode dan tidak salah ketik.
 */
function ModifierEditor({
  draft,
  onChange,
  moduleOn,
}: {
  draft: ModifierDraftGroup[];
  onChange: (next: ModifierDraftGroup[]) => void;
  moduleOn: boolean;
}) {
  function updateGroup(index: number, patch: Partial<ModifierDraftGroup>) {
    onChange(draft.map((group, i) => (i === index ? { ...group, ...patch } : group)));
  }

  return (
    <div className="space-y-4">
      {!moduleOn && (
        <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-muted-foreground">
          Modul <strong className="text-foreground">Food &amp; Beverage</strong> belum aktif,
          jadi mengisi modifier akan ditolak server. Aktifkan dulu di halaman{" "}
          <Link to="/app/modules" className="text-primary hover:underline">
            Modul
          </Link>
          . Mengosongkan daftar tetap boleh.
        </p>
      )}

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Belum ada modifier — produk ini dijual tanpa pilihan tambahan.
        </p>
      )}

      {draft.map((group, index) => (
        <div key={index} className="rounded-lg border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`Nama grup modifier ${index + 1}`}
              value={group.name}
              placeholder="Level pedas"
              onChange={(e) => updateGroup(index, { name: e.target.value })}
            />
            <Input
              aria-label={`Pilihan minimum grup ${index + 1}`}
              value={group.min}
              inputMode="numeric"
              className="w-20"
              onChange={(e) => updateGroup(index, { min: e.target.value })}
            />
            <Input
              aria-label={`Pilihan maksimum grup ${index + 1}`}
              value={group.max}
              inputMode="numeric"
              className="w-20"
              onChange={(e) => updateGroup(index, { max: e.target.value })}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Hapus grup modifier ${index + 1}`}
              onClick={() => onChange(draft.filter((_, i) => i !== index))}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            nama grup · minimum · maksimum pilihan (minimum &gt; 0 berarti wajib dipilih)
          </p>

          <div className="mt-3 space-y-2">
            {group.options.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-2">
                <Input
                  aria-label={`Nama opsi ${index + 1}-${optionIndex + 1}`}
                  value={option.name}
                  placeholder="Telur"
                  onChange={(e) =>
                    updateGroup(index, {
                      options: group.options.map((o, i) =>
                        i === optionIndex ? { ...o, name: e.target.value } : o,
                      ),
                    })
                  }
                />
                <Input
                  aria-label={`Tambahan harga opsi ${index + 1}-${optionIndex + 1}`}
                  value={option.price}
                  inputMode="numeric"
                  className="w-28"
                  placeholder="0"
                  onChange={(e) =>
                    updateGroup(index, {
                      options: group.options.map((o, i) =>
                        i === optionIndex ? { ...o, price: e.target.value } : o,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Hapus opsi ${index + 1}-${optionIndex + 1}`}
                  onClick={() =>
                    updateGroup(index, {
                      options: group.options.filter((_, i) => i !== optionIndex),
                    })
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                updateGroup(index, {
                  options: [...group.options, { name: "", price: "0" }],
                })
              }
            >
              + Opsi
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...draft, { ...EMPTY_GROUP, options: [{ name: "", price: "0" }] }])}
      >
        + Grup modifier
      </Button>
    </div>
  );
}

/**
 * Draf produk baru. Semua nilai disimpan sebagai teks: kolom angka yang diketik
 * pengguna tidak boleh dipaksa jadi angka di tengah kalimat.
 */
interface NewProductDraft {
  name: string;
  sku: string;
  category: string;
  price: string;
  cost: string;
  unit: string;
  openingStock: string;
}

const EMPTY_PRODUCT: NewProductDraft = {
  name: "",
  sku: "",
  category: "",
  price: "",
  cost: "",
  unit: "PCS",
  openingStock: "0",
};

/**
 * Kategori produk untuk kolom pilihan: label “Tanpa kategori” yang dipakai tabel
 * berarti memang tidak ada kategori, jadi kolomnya kosong.
 */
function kategoriDraft(category: string | undefined): string {
  const value = (category ?? "").trim();
  return value.toLowerCase() === "tanpa kategori" ? "" : value;
}

function draftFrom(product: StoreProduct): Draft {
  return {
    name: product.name,
    sku: product.sku,
    cost: String(product.cost ?? 0),
    category: kategoriDraft(product.category),
    price: String(product.price),
    unit: product.unit ?? "PCS",
    units: (product.units ?? []).map((u) => ({ code: u.code, factor: String(u.factor) })),
    tiers: (product.tiers ?? []).map((t) => ({
      minQty: String(t.minQty),
      price: String(t.price),
    })),
  };
}

/** Satu gambar yang tampil di editor: `id` untuk menghapus, `url` untuk pratinjau. */
interface EditorProductImage {
  id: string;
  url: string;
}

/** Gambar yang sudah dipilih tetapi belum bisa diunggah (produknya belum ada). */
interface PendingProductImage {
  id: string;
  file: Blob;
  url: string;
}

/**
 * Editor gambar produk.
 *
 * Dipakai di **dua tempat**: form **Produk baru** (gambar masih tertahan di state,
 * karena `products.addImage` butuh id produk yang baru ada setelah disimpan) dan
 * panel **Atur harga** (gambar langsung ditautkan ke produk yang sudah ada).
 * Komponennya sengaja tidak tahu soal store — yang menentukan arti “tambah” dan
 * “hapus” adalah pemanggilnya — jadi satu tampilan melayani dua alur tanpa
 * bercabang, dan batasnya tetap satu angka yang sama.
 */
function ProductImageEditor({
  scope,
  images,
  onAddFiles,
  onRemoveImage,
  busy,
  busyImageId,
  canEdit,
  note,
}: {
  /** Dipakai di label ARIA & keterangan: “produk baru” atau nama produknya. */
  scope: string;
  images: EditorProductImage[];
  onAddFiles: (files: File[]) => void;
  onRemoveImage: (imageId: string) => void;
  /** Benar saat berkas sedang disiapkan/diunggah. */
  busy: boolean;
  /** Id gambar yang sedang dihapus, supaya tombolnya tidak bisa diklik dua kali. */
  busyImageId: string | null;
  canEdit: boolean;
  note: string;
}) {
  const label = scope === "produk baru" ? "produk baru" : `produk ${scope}`;
  const room = remainingProductImageSlots(images.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Label>Gambar {label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Maksimal {MAX_PRODUCT_IMAGES} gambar per produk, satu berkas maksimal 2 MB (JPG, PNG, atau
            WebP). Gambar besar diperkecil otomatis sebelum dikirim, jadi foto dari kamera ponsel pun
            aman.
          </p>
        </div>
        <Badge variant={images.length === 0 ? "outline" : "secondary"}>
          {productImageSlots(images.length)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {images.map((image, index) => (
          <figure
            key={image.id}
            className="overflow-hidden rounded-lg border border-border bg-background"
          >
            <img
              src={image.url}
              alt={`Gambar ${index + 1} ${label}`}
              className="h-24 w-full object-cover"
            />
            <figcaption className="flex items-center justify-between gap-1 px-2 py-1">
              <span className="text-[11px] text-muted-foreground">Gambar {index + 1}</span>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Hapus gambar ${index + 1} ${label}`}
                  disabled={busyImageId === image.id}
                  onClick={() => onRemoveImage(image.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </figcaption>
          </figure>
        ))}

        {canEdit && (
          <label
            className={`grid h-full min-h-24 cursor-pointer place-items-center rounded-lg border border-dashed px-3 py-4 text-center text-xs ${
              room === 0
                ? "cursor-not-allowed border-border text-muted-foreground/60"
                : "border-primary/40 text-primary hover:border-primary"
            }`}
          >
            <span className="space-y-1">
              <ImageUp className="mx-auto size-5" />
              <span className="block font-medium">{busy ? "Menyiapkan…" : "Tambah gambar"}</span>
              <span className="block text-[11px] text-muted-foreground">
                {room === 0 ? `Penuh (${MAX_PRODUCT_IMAGES} gambar)` : `Sisa ${room} dari ${MAX_PRODUCT_IMAGES}`}
              </span>
            </span>
            <input
              type="file"
              accept={PRODUCT_IMAGE_TYPES.join(",")}
              multiple
              className="sr-only"
              aria-label={`Tambah gambar ${label}`}
              disabled={room === 0 || busy}
              onChange={(event) => {
                const input = event.currentTarget;
                const files = Array.from(input.files ?? []);
                // Dikosongkan supaya berkas yang sama bisa dipilih ulang
                // (mis. setelah gambarnya dihapus).
                input.value = "";
                onAddFiles(files);
              }}
            />
          </label>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function ProductsPage() {
  const {
    catalogProducts,
    categories,
    modules,
    setPricing,
    setCategory,
    updateProduct,
    setProductActive,
    checkProductDeletion,
    removeProduct,
    createCategory,
    renameCategory,
    setCategoryActive,
    removeCategory,
    setModifiers,
    createProduct,
    adjustStock,
    addProductImage,
    removeProductImage,
  } = useStore();
  const can = useCan();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingModifiers, setEditingModifiers] = useState<string | null>(null);
  const [modifierDraft, setModifierDraft] = useState<ModifierDraftGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingModifiers, setSavingModifiers] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newProduct, setNewProduct] = useState<NewProductDraft>(EMPTY_PRODUCT);
  /**
   * Benar kalau isi kolom SKU datang dari tombol **Buat otomatis** (bukan dari
   * ketikan pemilik toko). Selama itu, mengganti Kategori ikut mengganti SKU-nya —
   * `PBB-<KATEGORI>-<nomor urut>` harus mengikuti kategori yang dipilih. Begitu
   * kolomnya diketik sendiri, `skuAuto` mati dan ketikan itu tidak pernah ditimpa.
   */
  const [skuAuto, setSkuAuto] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustDraft, setAdjustDraft] = useState({ quantity: "", note: "" });
  const [adjustingStock, setAdjustingStock] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [removingImage, setRemovingImage] = useState<string | null>(null);
  /** Gambar yang dipilih di form Produk baru, menunggu produknya disimpan. */
  const [pendingImages, setPendingImages] = useState<PendingProductImage[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const pendingImageSequence = useRef(0);
  /** Produk yang sedang dinyalakan/dimatikan (id), supaya tombolnya menunggu. */
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null);
  /**
   * Dialog hapus: produk yang dipilih beserta pagar dari server. Pagarnya diambil
   * **sebelum** tombol Hapus aktif, supaya yang terlihat adalah hitungan sungguhan
   * (stok, penjualan, pergerakan stok, dokumen pembelian, opname) dan produk yang
   * sudah dipakai diarahkan ke “nonaktifkan saja”, bukan gagal setelah diklik.
   */
  const [hapusProduk, setHapusProduk] = useState<StoreProduct | null>(null);
  const [pagarHapus, setPagarHapus] = useState<ProductDeletionInfo | null>(null);
  const [memeriksaHapus, setMemeriksaHapus] = useState(false);
  const [menghapusProduk, setMenghapusProduk] = useState(false);

  // Tiga izin berbeda: membuat produk & menetapkan harga adalah `product.manage`,
  // menambah/mengurangi stok adalah `stock.adjust`, dan **kategori** (struktur
  // katalog yang menentukan kode SKU & tab kasir) diatur `category.manage` — jadi
  // staf gudang tetap bisa membuat produk, tetapi tidak mengubah kategorinya.
  const canCreate = can("product.manage");
  const canAdjust = can("stock.adjust");
  const canManageCategories = can("category.manage");

  /**
   * Keadaan pengelolaan kategori: form tambah, baris yang sedang diubah namanya,
   * dan baris yang menunggu konfirmasi hapus (hapus melepas produknya, jadi tidak
   * boleh sekali klik).
   */
  const [kategoriBaru, setKategoriBaru] = useState("");
  const [kategoriBusy, setKategoriBusy] = useState(false);
  const [kategoriUbah, setKategoriUbah] = useState<{ id: string; name: string } | null>(null);
  const [kategoriHapus, setKategoriHapus] = useState<string | null>(null);

  const kategoriAktif = useMemo(
    () => categories.filter((c) => c.active).length,
    [categories],
  );
  /** Kode SKU yang dipakai lebih dari satu kategori — cukup diberitahukan. */
  const kodeBentrok = useMemo(() => duplicateCategoryCodes(categories), [categories]);
  /** Nama kategori nonaktif, untuk menandai produk yang masih memakainya. */
  const kategoriNonaktif = useMemo(
    () => new Set(categories.filter((c) => !c.active).map((c) => categoryNameKey(c.name))),
    [categories],
  );
  /** Jumlah produk yang masih dijual — sisanya nonaktif dan tetap terlihat di tabel. */
  const produkAktif = useMemo(
    () => catalogProducts.filter((product) => product.active).length,
    [catalogProducts],
  );

  function gagalKategori(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    setNotice(null);
  }

  async function submitKategoriBaru() {
    if (kategoriBusy) return;
    // Aturan yang sama dengan server dan store demo, dipakai lebih dulu di sini
    // supaya kesalahannya terlihat sebelum menekan Simpan.
    const keputusan = validateCategoryName(
      { name: kategoriBaru },
      { existingNames: categories.map((c) => c.name), count: categories.length },
    );
    if (!keputusan.ok) {
      gagalKategori(new Error(keputusan.reason));
      return;
    }

    setKategoriBusy(true);
    setError(null);
    setNotice(null);
    try {
      const dibuat = await createCategory({ name: keputusan.value.name });
      setKategoriBaru("");
      setNotice(
        `Kategori ${dibuat.name} ditambahkan — kode SKU-nya ${categorySkuCode(dibuat.name)}. Produk baru yang memakai kategori ini memakai kode itu, mis. ${PRODUCT_SKU_PREFIX}-${categorySkuCode(dibuat.name)}-000042.`,
      );
    } catch (cause) {
      gagalKategori(cause);
    } finally {
      setKategoriBusy(false);
    }
  }

  async function submitKategoriUbah(kategori: StoreCategory) {
    if (kategoriBusy || !kategoriUbah) return;
    const keputusan = validateCategoryName(
      { name: kategoriUbah.name },
      {
        existingNames: categories.filter((c) => c.id !== kategori.id).map((c) => c.name),
      },
    );
    if (!keputusan.ok) {
      gagalKategori(new Error(keputusan.reason));
      return;
    }

    setKategoriBusy(true);
    setError(null);
    setNotice(null);
    try {
      const hasil = await renameCategory({
        categoryId: kategori.id,
        name: keputusan.value.name,
      });
      setKategoriUbah(null);
      const kodeLama = categorySkuCode(hasil.previousName);
      const kodeBaru = categorySkuCode(hasil.name);
      setNotice(
        hasil.skuCodeChanged
          ? `Kategori ${hasil.previousName} menjadi ${hasil.name}. Kode SKU kategori ini ${kodeLama} → ${kodeBaru}; SKU yang sudah ada tidak ditulis ulang, jadi ${hasil.previousName} tetap terbaca di tabel sampai produknya dipindah atau dibuat ulang.`
          : `Kategori ${hasil.previousName} menjadi ${hasil.name}. Kode SKU-nya tidak berubah (${kodeBaru}), jadi SKU yang sudah ada tetap cocok.`,
      );
    } catch (cause) {
      gagalKategori(cause);
    } finally {
      setKategoriBusy(false);
    }
  }

  async function toggleKategoriAktif(kategori: StoreCategory) {
    if (kategoriBusy) return;
    setKategoriBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setCategoryActive(kategori.id, !kategori.active);
      setNotice(
        kategori.active
          ? `Kategori ${kategori.name} dinonaktifkan — tidak bisa dipakai produk baru, tetapi ${kategori.productCount} produk yang sudah memakainya tetap dijual dan tetap ada tabnya di kasir.`
          : `Kategori ${kategori.name} diaktifkan kembali dan bisa dipakai produk baru.`,
      );
    } catch (cause) {
      gagalKategori(cause);
    } finally {
      setKategoriBusy(false);
    }
  }

  async function submitKategoriHapus(kategori: StoreCategory) {
    if (kategoriBusy) return;
    setKategoriBusy(true);
    setError(null);
    setNotice(null);
    try {
      const hasil = await removeCategory(kategori.id);
      setKategoriHapus(null);
      setNotice(
        hasil.detachedProducts === 0
          ? `Kategori ${hasil.name} dihapus — tidak ada produk yang memakainya.`
          : `Kategori ${hasil.name} dihapus; ${hasil.detachedProducts} produk menjadi “Tanpa kategori”. Produknya tetap ada dan SKU-nya tidak diubah.`,
      );
    } catch (cause) {
      gagalKategori(cause);
    } finally {
      setKategoriBusy(false);
    }
  }

  /**
   * Menyiapkan gambar untuk produk yang **belum** dibuat.
   *
   * Berkasnya diperkecil dan ditahan di state bersama pratinjaunya; unggahannya
   * baru dijalankan setelah produknya tersimpan, karena `products.addImage`
   * butuh id produk. Berkas yang ditolak aturan diberitahukan **sekarang**, bukan
   * setelah menekan Simpan produk.
   */
  async function pickNewProductImages(files: File[]) {
    if (preparingImages || files.length === 0) return;

    const room = remainingProductImageSlots(pendingImages.length);
    if (room === 0) {
      const full = canAddProductImage(pendingImages.length);
      setError(full.reason ?? `Gambar produk maksimal ${MAX_PRODUCT_IMAGES}.`);
      return;
    }

    const queue = files.slice(0, room);
    setPreparingImages(true);
    setError(null);
    setNotice(null);
    try {
      const prepared: PendingProductImage[] = [];
      const rejected: string[] = [];
      for (const file of queue) {
        const result = await prepareProductImage(file);
        const valid = validateProductImage({
          contentType: result.blob.type || file.type,
          size: result.blob.size,
        });
        if (!valid.ok) {
          if (valid.reason) rejected.push(`${file.name || "berkas"}: ${valid.reason}`);
          continue;
        }
        pendingImageSequence.current += 1;
        prepared.push({
          id: `pending-${Date.now()}-${pendingImageSequence.current}`,
          file: result.blob,
          url: await readImageAsDataUrl(result.blob),
        });
      }

      if (prepared.length > 0) {
        setPendingImages((current) => [...current, ...prepared]);
      }
      const skipped = files.length - queue.length;
      if (skipped > 0) {
        setError(
          `Hanya ${queue.length} berkas dipakai karena batas ${MAX_PRODUCT_IMAGES} gambar per produk (${skipped} berkas dilewati).`,
        );
      } else if (rejected.length > 0) {
        setError(rejected.join(" | "));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreparingImages(false);
    }
  }

  function removePendingImage(imageId: string) {
    setPendingImages((current) => current.filter((image) => image.id !== imageId));
  }

  /**
   * Saran SKU untuk kategori yang sedang dipilih. Dipakai tombol **Buat otomatis**
   * dan saat kategori diganti selama kolom SKU masih berasal dari tombol itu.
   */
  function saranSkuKategori(category: string): string {
    return suggestProductSku({
      category,
      // Termasuk produk nonaktif: SKU-nya tetap terpakai, jadi nomor baru tidak
      // boleh menabraknya.
      takenSkus: catalogProducts.map((product) => product.sku),
    });
  }

  async function submitNewProduct() {
    if (creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const stock = Math.max(0, Math.trunc(Number(newProduct.openingStock) || 0));
      const created = await createProduct({
        name: newProduct.name.trim(),
        // Kosong = dibuat otomatis oleh server (unik); nilai finalnya dipakai di
        // notis, bukan tebakan klien.
        sku: newProduct.sku.trim() || undefined,
        price: Math.round(Number(newProduct.price) || 0),
        cost: Math.round(Number(newProduct.cost) || 0),
        category: newProduct.category.trim() || undefined,
        unit: newProduct.unit.trim() || "PCS",
        openingStock: stock,
      });
      // Gambar menyusul setelah produknya ada: `addImage` butuh id produk, dan
      // berkasnya memang dikirim ke penyimpanan, bukan dititipkan ke `create`.
      let attached = 0;
      const failedImages: string[] = [];
      for (const image of pendingImages) {
        try {
          await addProductImage(created.id, image.file);
          attached += 1;
        } catch (cause) {
          failedImages.push(cause instanceof Error ? cause.message : String(cause));
        }
      }
      setPendingImages([]);

      setNewProduct(EMPTY_PRODUCT);
      setSkuAuto(false);
      setShowCreate(false);
      const imagesNote =
        attached > 0 ? ` ${attached} gambar ikut tersimpan (${productImageSlots(attached)}).` : "";
      setNotice(
        stock > 0
          ? `Produk ${created.sku} ditambahkan dengan stok awal ${stock}.${imagesNote}`
          : `Produk ${created.sku} ditambahkan tanpa stok awal — isi lewat “Sesuaikan stok” atau penerimaan barang di Pembelian.${imagesNote}`,
      );
      if (failedImages.length > 0) {
        setError(
          `Produk tersimpan, tetapi ${failedImages.length} gambar gagal diunggah: ${failedImages.join(" | ")}`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }

  /**
   * Menambahkan gambar ke sebuah produk.
   *
   * Tiga hal dikerjakan berurutan, dan urutannya penting: berkasnya diperkecil
   * dulu (`prepareProductImage`), hasilnya diperiksa aturan yang sama dengan
   * server, baru dikirim ke store. Sisa slot dihitung dari data produk, jadi
   * menambahkan 10 berkas sekaligus ke produk yang baru punya 5 gambar hanya
   * memakai 3 berkas pertama — sisanya diberitahukan, bukan dibuang diam-diam.
   */
  async function addImages(product: StoreProduct, files: File[]) {
    if (uploadingImage || files.length === 0) return;

    const existing = (product.images ?? []).length;
    const room = remainingProductImageSlots(existing);
    if (room === 0) {
      const full = canAddProductImage(existing);
      setError(full.reason ?? `Gambar produk maksimal ${MAX_PRODUCT_IMAGES}.`);
      return;
    }

    const queue = files.slice(0, room);
    setUploadingImage(true);
    setError(null);
    setNotice(null);
    try {
      let added = 0;
      const rejected: string[] = [];
      for (const file of queue) {
        const prepared = await prepareProductImage(file);
        const valid = validateProductImage({
          contentType: prepared.blob.type || file.type,
          size: prepared.blob.size,
        });
        if (!valid.ok) {
          if (valid.reason) rejected.push(`${file.name || "berkas"}: ${valid.reason}`);
          continue;
        }
        await addProductImage(product.id, prepared.blob);
        added += 1;
      }

      if (added > 0) {
        setNotice(
          `${added} gambar ditambahkan ke ${product.name} — kini ${productImageSlots(
            existing + added,
          )}.`,
        );
      }
      const skipped = files.length - queue.length;
      if (skipped > 0) {
        setError(
          `Hanya ${queue.length} berkas dipakai karena batas ${MAX_PRODUCT_IMAGES} gambar per produk (${skipped} berkas dilewati).`,
        );
      } else if (rejected.length > 0) {
        setError(rejected.join(" | "));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingImage(false);
    }
  }

  async function removeImage(product: StoreProduct, imageId: string) {
    if (removingImage) return;
    setRemovingImage(imageId);
    setError(null);
    setNotice(null);
    try {
      await removeProductImage(product.id, imageId);
      const remaining = (product.images ?? []).filter((image) => image.id !== imageId).length;
      setNotice(`Gambar ${product.name} dihapus — kini ${productImageSlots(remaining)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemovingImage(null);
    }
  }

  function openAdjuster(product: StoreProduct) {
    setAdjusting(product.id);
    setAdjustDraft({ quantity: "", note: "" });
    setError(null);
    setNotice(null);
  }

  async function submitAdjustment(product: StoreProduct) {
    if (adjustingStock) return;
    const delta = Math.trunc(Number(adjustDraft.quantity) || 0);
    if (delta === 0) {
      setError("Isi jumlah penyesuaian — pakai angka negatif untuk mengurangi stok.");
      return;
    }
    setAdjustingStock(true);
    setError(null);
    try {
      const balance = await adjustStock(
        product.id,
        delta,
        adjustDraft.note.trim() || "Penyesuaian manual dari halaman Produk",
      );
      setNotice(`Stok ${product.name} kini ${balance}.`);
      setAdjusting(null);
      setAdjustDraft({ quantity: "", note: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdjustingStock(false);
    }
  }

  // Fitur grosir (harga bertingkat + konversi satuan) hanya bisa diatur kalau
  // modulnya aktif — aturan yang sama dipakai server saat menyimpan.
  const wholesaleOn = modules.activeVerticals.includes("wholesale");
  // Modifier item milik modul F&B; mengosongkan daftar tetap boleh walau modul mati.
  const fnbOn = modules.activeVerticals.includes("fnb");

  function openModifierEditor(product: StoreProduct) {
    setEditingModifiers(product.id);
    setModifierDraft(
      (product.modifiers ?? []).map((group) => ({
        name: group.name,
        min: String(group.minSelect),
        max: String(group.maxSelect),
        options: group.options.map((option) => ({
          name: option.name,
          price: String(option.price),
        })),
      })),
    );
    setError(null);
  }

  function closeModifierEditor() {
    setEditingModifiers(null);
    setModifierDraft(null);
    setError(null);
  }

  async function saveModifiers(productId: string) {
    if (!modifierDraft) return;
    setSavingModifiers(true);
    setError(null);
    try {
      // Kode grup/opsi diusulkan dari nama (unik per produk), lalu divalidasi
      // ulang server lewat aturan yang sama.
      const groups: ModifierGroup[] = [];
      for (const raw of modifierDraft) {
        if (raw.name.trim().length === 0) continue;
        const groupCode = suggestGroupCode(
          raw.name,
          groups.map((group) => group.code),
        );
        const options: ModifierGroup["options"] = [];
        for (const option of raw.options) {
          if (option.name.trim().length === 0) continue;
          options.push({
            code: suggestOptionCode(
              option.name,
              options.map((existing) => existing.code),
            ),
            name: option.name.trim(),
            price: Number(option.price) || 0,
          });
        }
        groups.push({
          code: groupCode,
          name: raw.name.trim(),
          minSelect: Number(raw.min) || 0,
          maxSelect: Number(raw.max) || 1,
          options,
        });
      }

      await setModifiers({ productId, modifiers: groups });
      closeModifierEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingModifiers(false);
    }
  }

  function openEditor(product: StoreProduct) {
    setEditing(product.id);
    setDraft(draftFrom(product));
    setError(null);
  }

  function closeEditor() {
    setEditing(null);
    setDraft(null);
    setError(null);
  }

  async function save(product: StoreProduct) {
    if (!draft) return;
    const productId = product.id;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Identitas (nama/SKU/harga beli) disimpan lebih dulu dan lewat jalur
      // sendiri: ia tidak menyentuh harga jual, konversi satuan, atau modifier —
      // dan `changed` menyebut kolom mana yang benar-benar berubah, supaya tidak
      // ada audit maupun notis untuk perubahan kosong.
      const identitas = await updateProduct({
        productId,
        name: draft.name.trim(),
        sku: draft.sku.trim(),
        cost: Number(draft.cost) || 0,
      });
      const pesan: string[] = [];
      if (identitas.changed.includes("name")) {
        pesan.push(`Nama produk kini “${identitas.name}”.`);
      }
      if (identitas.changed.includes("sku")) {
        pesan.push(
          `SKU kini ${identitas.sku} — label harga dan catatan lama yang menyebut SKU sebelumnya harus disesuaikan.`,
        );
      }
      if (identitas.changed.includes("cost")) {
        pesan.push(`Harga beli kini ${formatIDR(identitas.cost)} per satuan dasar.`);
      }

      await setPricing({
        productId,
        price: Number(draft.price),
        unit: draft.unit,
        units: draft.units
          .filter((u) => u.code.trim().length > 0)
          .map((u) => ({ code: u.code, factor: Number(u.factor) })),
        tiers: draft.tiers
          .filter((t) => t.minQty.trim().length > 0 && t.price.trim().length > 0)
          .map((t) => ({ minQty: Number(t.minQty), price: Number(t.price) })),
      });

      // Kategori menentukan kode di tengah SKU, jadi perubahannya lewat jalur
      // sendiri; SKU sebelum & sesudah datang dari store/server, bukan dihitung
      // ulang di halaman ini.
      const kategoriBaru = draft.category.trim();
      if (kategoriBaru !== kategoriDraft(product.category)) {
        const label = kategoriBaru.length > 0 ? `“${kategoriBaru}”` : "Tanpa kategori";
        const hasil = await setCategory({ productId, category: kategoriBaru });
        pesan.push(
          hasil.sku === hasil.previousSku
            ? `Kategori ${identitas.name} kini ${label}; SKU ${hasil.sku} diketik sendiri, jadi tidak ikut berubah.`
            : `Kategori ${identitas.name} kini ${label} — SKU ikut menyesuaikan dari ${hasil.previousSku} menjadi ${hasil.sku}.`,
        );
      }

      closeEditor();
      if (pesan.length > 0) {
        setNotice(`${pesan.join(" ")} Perubahan tersimpan.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Aktif/nonaktifkan produk. Menonaktifkan **tidak** menghapus apa pun: produknya
   * hilang dari kasir & katalog penjualan (`products.listByStore` hanya memuat yang
   * aktif), tetapi stok, riwayat penjualan, dan dokumen supplier tetap menunjuk
   * produk yang sama — jadi bisa dinyalakan kembali kapan saja.
   */
  async function toggleStatus(product: StoreProduct) {
    if (togglingStatus) return;
    setTogglingStatus(product.id);
    setError(null);
    setNotice(null);
    try {
      const aktifBaru = !product.active;
      await setProductActive(product.id, aktifBaru);
      setNotice(productStatusSentence(product.name, aktifBaru, product.stock));
      // Baris yang sedang dibuka ikut menutup kalau produknya dimatikan: panel
      // “Atur harga” produk nonaktif hanya menyesatkan (harga tidak bisa dijual).
      if (!aktifBaru && editing === product.id) closeEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTogglingStatus(null);
    }
  }

  /**
   * Buka dialog hapus: pagarnya diambil dari server lebih dulu, jadi yang tampil
   * adalah hitungan sungguhan dan produk yang sudah dipakai tahu alasannya
   * sebelum tombol Hapus ditekan.
   */
  async function bukaHapus(product: StoreProduct) {
    setHapusProduk(product);
    setPagarHapus(null);
    setMemeriksaHapus(true);
    setError(null);
    setNotice(null);
    try {
      setPagarHapus(await checkProductDeletion(product.id));
    } catch (cause) {
      setHapusProduk(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMemeriksaHapus(false);
    }
  }

  function tutupHapus() {
    setHapusProduk(null);
    setPagarHapus(null);
  }

  /** Hapus produk yang memang belum dipakai; sisanya ditolak server dengan alasannya. */
  async function submitHapus(product: StoreProduct) {
    if (menghapusProduk) return;
    setMenghapusProduk(true);
    setError(null);
    setNotice(null);
    try {
      const hasil = await removeProduct(product.id);
      if (editing === product.id) closeEditor();
      if (adjusting === product.id) setAdjusting(null);
      if (editingModifiers === product.id) closeModifierEditor();
      tutupHapus();
      setNotice(
        `Produk ${hasil.name} (${hasil.sku}) dihapus — stok nol dan riwayatnya memang kosong, jadi tidak ada data lain yang ikut hilang.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMenghapusProduk(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <Boxes className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Produk &amp; Stok</h2>
            <p className="text-sm text-muted-foreground">
              {catalogProducts.length} produk ({produkAktif} aktif) · kolom stok adalah jumlah yang
              bisa dijual kasir dari lokasi jual toko. Produk nonaktif tidak muncul di kasir,
              tetapi tetap ada di daftar ini.
            </p>
          </div>
        </div>
        {canCreate && (
          <Button
            type="button"
            variant={showCreate ? "secondary" : "default"}
            onClick={() => {
              setShowCreate((open) => !open);
              // Menutup form membuang gambar yang belum jadi diunggah — produknya
              // tidak disimpan, jadi gambar itu memang belum punya tempat.
              setPendingImages([]);
              setSkuAuto(false);
              setError(null);
              setNotice(null);
            }}
          >
            {showCreate ? <X className="size-4" /> : <Plus className="size-4" />}
            {showCreate ? "Tutup form" : "Tambah produk"}
          </Button>
        )}
      </header>

      {/*
        Jalur paling awal mengisi stok: buat produk, lalu isi stok awalnya di
        form yang sama. Tanpa ini stok hanya bisa masuk lewat penerimaan barang di
        halaman Pembelian — dan toko baru belum punya supplier maupun PO.
      */}
      {showCreate && canCreate && (
        <Card className="border-primary/30">
          <CardContent className="space-y-4 pt-6">
            <div>
              <CardTitle className="text-base">Produk baru</CardTitle>
              <CardDescription className="mt-1">
                Isi nama, harga, dan <strong>stok awal</strong> yang benar-benar ada di rak.
                Stok awal dicatat server sebagai penyesuaian beralasan “Stok awal”, jadi
                angkanya punya jejak di ledger.
              </CardDescription>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-xs text-muted-foreground">
                Nama produk
                <Input
                  value={newProduct.name}
                  placeholder="Kopi Susu Gula Aren"
                  aria-label="Nama produk baru"
                  onChange={(e) => {
                    const name = e.target.value;
                    setNewProduct((current) => ({ ...current, name }));
                  }}
                />
              </label>
              {/**
                SKU sengaja **tidak** diisi otomatis dari nama produk: kolom yang
                dibiarkan kosong berarti “buatkan untuk saya”, dan servernya yang
                menentukan nomor finalnya. Tombol di sampingnya hanya mengisi kolom
                lebih dulu (dari daftar SKU yang sudah ada), supaya pemilik toko bisa
                melihat & mengubahnya sebelum menyimpan — dan selama isinya datang
                dari tombol itu, mengganti Kategori ikut mengganti kode SKU-nya.
              */}
              <label className="space-y-1 text-xs text-muted-foreground">
                SKU <span className="font-normal">(opsional)</span>
                <div className="flex items-center gap-2">
                  <Input
                    className="font-mono"
                    value={newProduct.sku}
                    placeholder={`${PRODUCT_SKU_PREFIX}-SAN-000042`}
                    aria-label="SKU produk baru"
                    onChange={(e) => {
                      // Diketik sendiri = milik pemilik toko; berhenti mengikuti
                      // kategori sampai tombolnya ditekan lagi.
                      setSkuAuto(false);
                      setNewProduct((current) => ({ ...current, sku: e.target.value }));
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    aria-label="Buat SKU otomatis"
                    title={
                      newProduct.sku.trim().length > 0
                        ? "Kosongkan kolom SKU lebih dulu untuk memakai tombol ini"
                        : "Isi kolom SKU dari daftar SKU yang sudah ada"
                    }
                    disabled={newProduct.sku.trim().length > 0}
                    onClick={() => {
                      setSkuAuto(true);
                      setNewProduct((current) => ({
                        ...current,
                        sku: saranSkuKategori(current.category),
                      }));
                    }}
                  >
                    <Sparkles className="size-3.5" /> Buat otomatis
                  </Button>
                </div>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  Kosongkan dan simpan untuk dibuat otomatis &amp; unik — format{" "}
                  <span className="font-mono">
                    {PRODUCT_SKU_PREFIX}-&lt;KATEGORI&gt;-&lt;nomor urut&gt;
                  </span>{" "}
                  (contoh <span className="font-mono">{PRODUCT_SKU_PREFIX}-SAN-000042</span>). Tombol{" "}
                  <strong>Buat otomatis</strong> mengisi kolomnya dari daftar SKU yang sudah ada,
                  dan selama isinya berasal dari tombol itu, <strong>mengganti Kategori ikut
                  mengganti kode SKU-nya</strong>.
                </span>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Kategori
                <select
                  className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                  value={newProduct.category}
                  aria-label="Kategori produk baru"
                  onChange={(e) => {
                    const category = e.target.value;
                    setNewProduct((current) => ({
                      ...current,
                      category,
                      // SKU dari tombol mengikuti kategori baru; SKU yang diketik
                      // pemilik toko dibiarkan apa adanya.
                      sku: skuAuto ? saranSkuKategori(category) : current.sku,
                    }));
                  }}
                >
                  <option value="">Tanpa kategori</option>
                  {/**
                    Hanya kategori aktif untuk produk **baru**; pilihan yang sedang
                    terpilih ikut ditampilkan walau kategorinya baru saja
                    dinonaktifkan di tempat lain, supaya layarnya tidak diam-diam
                    menampilkan kategori lain dari yang akan dikirim.
                  */}
                  {selectableCategoryNames(categories, newProduct.category).map((nama) => (
                    <option key={nama} value={nama}>
                      {nama}
                      {kategoriNonaktif.has(categoryNameKey(nama)) ? " (nonaktif)" : ""}
                    </option>
                  ))}
                </select>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {kategoriAktif < categories.length
                    ? `${categories.length - kategoriAktif} kategori nonaktif tidak ditawarkan di sini — aktifkan dulu di kartu “Kategori produk”.`
                    : "Kategori diatur di kartu “Kategori produk” di bawah daftar."}
                </span>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Harga jual
                <Input
                  inputMode="numeric"
                  value={newProduct.price}
                  placeholder="22000"
                  aria-label="Harga jual produk baru"
                  onChange={(e) =>
                    setNewProduct((current) => ({ ...current, price: e.target.value }))
                  }
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Harga beli (opsional)
                <Input
                  inputMode="numeric"
                  value={newProduct.cost}
                  placeholder="12000"
                  aria-label="Harga beli produk baru"
                  onChange={(e) =>
                    setNewProduct((current) => ({ ...current, cost: e.target.value }))
                  }
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Satuan dasar
                <Input
                  value={newProduct.unit}
                  placeholder="PCS"
                  aria-label="Satuan dasar produk baru"
                  onChange={(e) =>
                    setNewProduct((current) => ({ ...current, unit: e.target.value }))
                  }
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Stok awal
                <Input
                  inputMode="numeric"
                  value={newProduct.openingStock}
                  placeholder="0"
                  aria-label="Stok awal produk baru"
                  onChange={(e) =>
                    setNewProduct((current) => ({ ...current, openingStock: e.target.value }))
                  }
                />
              </label>
            </div>

            {/*
              Gambar ikut di sini sejak awal: toko baru biasanya sudah punya foto
              produk sebelum mengetik datanya, dan mencarinya di tempat lain
              membuat gambar tidak pernah diunggah sama sekali.
            */}
            {canCreate && (
              <div className="rounded-lg border border-border bg-background p-3">
                <ProductImageEditor
                  scope="produk baru"
                  images={pendingImages}
                  onAddFiles={(files) => void pickNewProductImages(files)}
                  onRemoveImage={removePendingImage}
                  busy={preparingImages}
                  busyImageId={null}
                  canEdit
                  note={
                    pendingImages.length === 0
                      ? `Belum ada gambar dipilih. Gambar pertama akan jadi thumbnail produk ini (maksimal ${MAX_PRODUCT_IMAGES}).`
                      : "Gambar yang dipilih ikut tersimpan begitu produknya disimpan."
                  }
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={creating || newProduct.name.trim().length < 2}
                onClick={() => void submitNewProduct()}
              >
                <PackagePlus className="size-4" />
                {creating ? "Menyimpan…" : "Simpan produk"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Gambar yang dipilih di atas ikut tersimpan bersama produknya. Satuan besar (Dus/Pak),
                harga bertingkat, dan gambar yang sudah tersimpan diatur belakangan lewat tombol{" "}
                <strong>Atur harga</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/*
        Kategori produk (`category.manage`).

        Namanya bukan sekadar label: ia menentukan kode di tengah SKU
        (`PBB-<KATEGORI>-<nomor urut>`) dan susunan tab di kasir. Karena itu
        pengelolaannya dipisah dari `product.manage` — peran yang lebih tinggi
        (pemilik/manajer) yang menambah, mengubah nama, menonaktifkan, dan
        menghapus; staf gudang tetap memakai kategori yang aktif di form produk.
      */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-primary" />
                Kategori produk
              </CardTitle>
              <CardDescription className="mt-1">
                {canManageCategories
                  ? `Kategori menentukan kode di tengah SKU (${PRODUCT_SKU_PREFIX}-<kategori>-<nomor>) dan susunan tab di kasir. Kategori nonaktif tidak bisa dipakai produk baru, tetapi produk yang sudah memakainya tetap dijual.`
                  : "Kategori menentukan kode SKU dan susunan tab di kasir. Menambah, mengubah, menonaktifkan, atau menghapusnya butuh peran manajer/pemilik."}
              </CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0">
              {categories.length} kategori · {kategoriAktif} aktif
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {kodeBentrok.length > 0 && (
            <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              {kodeBentrok
                .map(({ code, names }) => `Kode SKU ${code} dipakai ${names.join(" & ")}`)
                .join("; ")}
              . SKU-nya tetap unik karena nomor urutnya berlaku untuk seluruh katalog, tetapi nama
              yang kodenya berbeda lebih mudah dibaca dari SKU.
            </p>
          )}

          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada kategori — semua produk tampil sebagai “Tanpa kategori”.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Kategori</th>
                    <th className="px-2 py-2">Kode SKU</th>
                    <th className="px-2 py-2 text-right">Produk</th>
                    <th className="px-2 py-2">Status</th>
                    {canManageCategories && <th className="px-2 py-2 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => {
                    const sedangUbah = kategoriUbah?.id === c.id;
                    const sedangHapus = kategoriHapus === c.id;
                    return (
                      <tr key={c.id} className="border-t border-border/60">
                        <td className="px-2 py-2">
                          {sedangUbah ? (
                            <Input
                              className="h-8 w-full max-w-56"
                              value={kategoriUbah.name}
                              aria-label={`Nama baru kategori ${c.name}`}
                              onChange={(e) => setKategoriUbah({ id: c.id, name: e.target.value })}
                            />
                          ) : (
                            c.name
                          )}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                          {categorySkuCode(sedangUbah ? kategoriUbah.name : c.name)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs">{c.productCount}</td>
                        <td className="px-2 py-2">
                          <Badge variant={c.active ? "default" : "outline"}>
                            {c.active ? "aktif" : "nonaktif"}
                          </Badge>
                        </td>
                        {canManageCategories && (
                          <td className="px-2 py-2 text-right">
                            {sedangHapus ? (
                              <div className="ml-auto flex max-w-md flex-col items-end gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {deleteCategorySentence(c.name, c.productCount)}
                                </span>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                                    disabled={kategoriBusy}
                                    aria-label={`Konfirmasi hapus kategori ${c.name}`}
                                    onClick={() => void submitKategoriHapus(c)}
                                  >
                                    <Trash2 className="size-3.5" /> Ya, hapus
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={kategoriBusy}
                                    aria-label={`Batal hapus kategori ${c.name}`}
                                    onClick={() => setKategoriHapus(null)}
                                  >
                                    Batal
                                  </Button>
                                </div>
                              </div>
                            ) : sedangUbah ? (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={
                                    kategoriBusy ||
                                    kategoriUbah.name.trim().length < 2 ||
                                    kategoriUbah.name.trim() === c.name
                                  }
                                  aria-label={`Simpan nama kategori ${c.name}`}
                                  onClick={() => void submitKategoriUbah(c)}
                                >
                                  <Save className="size-3.5" /> Simpan
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={kategoriBusy}
                                  aria-label={`Batal ubah kategori ${c.name}`}
                                  onClick={() => setKategoriUbah(null)}
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={kategoriBusy}
                                  aria-label={`Ubah nama kategori ${c.name}`}
                                  onClick={() => setKategoriUbah({ id: c.id, name: c.name })}
                                >
                                  Ubah nama
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={kategoriBusy}
                                  aria-label={
                                    c.active
                                      ? `Nonaktifkan kategori ${c.name}`
                                      : `Aktifkan kategori ${c.name}`
                                  }
                                  onClick={() => void toggleKategoriAktif(c)}
                                >
                                  {c.active ? "Nonaktifkan" : "Aktifkan"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={kategoriBusy}
                                  aria-label={`Hapus kategori ${c.name}`}
                                  onClick={() => setKategoriHapus(c.id)}
                                >
                                  Hapus
                                </Button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canManageCategories ? (
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="size-4" /> Tambah kategori
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="text-xs text-muted-foreground">
                  Nama kategori
                  <Input
                    className="mt-1 w-56"
                    value={kategoriBaru}
                    placeholder="Sanitasi"
                    aria-label="Nama kategori baru"
                    onChange={(e) => setKategoriBaru(e.target.value)}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Kode SKU:{" "}
                  <span className="font-mono text-foreground">
                    {categorySkuCode(kategoriBaru || "?")}
                  </span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="ml-auto"
                  disabled={kategoriBusy || kategoriBaru.trim().length < 2}
                  aria-label="Simpan kategori baru"
                  onClick={() => void submitKategoriBaru()}
                >
                  <Plus className="size-4" /> Simpan kategori
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Nama “Tanpa kategori” tidak bisa dipakai — kalimat itu sudah berarti “produk ini tidak
                punya kategori” di seluruh aplikasi.{kategoriUbah ? " Selesai mengubah nama lebih dulu untuk menambah kategori baru." : ""}
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Hanya pemilik/manajer yang bisa menambah, mengubah, menonaktifkan, atau menghapus kategori.
            </p>
          )}
        </CardContent>
      </Card>

      {!wholesaleOn && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Puzzle className="size-4 text-primary" />
                Harga bertingkat & konversi satuan butuh modul Grosir
              </CardTitle>
              <CardDescription className="mt-1">
                Harga sudah termasuk di paket {modules.planName}, tetapi modul Grosir belum
                aktif — jadi kolom satuan/tier dikunci dan produk bergrosir tidak bisa
                dijual.
              </CardDescription>
            </div>
            <Link
              to="/app/modules"
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <PackagePlus className="size-4" />
              Aktifkan modul Grosir
            </Link>
          </CardContent>
        </Card>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          {notice}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 font-medium">Produk</th>
              <th className="px-4 py-2 font-medium">Gambar</th>
              <th className="px-4 py-2 text-right font-medium">Harga</th>
              <th className="px-4 py-2 font-medium">Satuan & tier</th>
              <th className="px-4 py-2 font-medium">Modifier</th>
              <th className="px-4 py-2 text-right font-medium">Stok</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {catalogProducts.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                  Belum ada produk.
                </td>
              </tr>
            ) : (
              catalogProducts.map((p) => {
                const tiers = sortTiers(p.tiers ?? []);
                const images = p.images ?? [];
                const isEditing = editing === p.id;
                const isModifierEditing = editingModifiers === p.id;
                const isAdjusting = adjusting === p.id;
                const deltaDraft = Math.trunc(Number(adjustDraft.quantity) || 0);
                return (
                  <Fragment key={p.id}>
                    <tr className="border-t border-border/70">
                      <td className="px-4 py-2 font-mono text-muted-foreground">{p.sku}</td>
                      <td className="px-4 py-2 font-medium">
                        {p.name}
                        <div className="text-xs font-normal text-muted-foreground">
                          {p.category}
                          {/** Produk di kategori nonaktif tetap dijual; tandanya cuma di sini. */}
                          {kategoriNonaktif.has(categoryNameKey(p.category)) && (
                            <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                              kategori nonaktif
                            </Badge>
                          )}
                        </div>
                      </td>
                      {/**
                        Thumbnail, bukan daftar nama gambar: yang perlu dilihat
                        pemilik toko adalah "produk ini sudah ada fotonya atau
                        belum", dan gambar pertamalah yang mewakilinya.
                      */}
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {images.length === 0 ? (
                            <span className="grid size-10 place-items-center rounded-md border border-dashed border-border text-muted-foreground">
                              <Images className="size-4" />
                            </span>
                          ) : (
                            <img
                              src={images[0].url}
                              alt={`Gambar utama ${p.name}`}
                              className="size-10 rounded-md border border-border object-cover"
                            />
                          )}
                          <Badge variant={images.length === 0 ? "outline" : "secondary"}>
                            {productImageSlots(images.length)}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatIDR(p.price)}
                        <div className="text-xs font-normal text-muted-foreground">
                          per {p.unit ?? "PCS"}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {wholesaleOn ? (
                          <div className="space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1">
                              {(p.units ?? []).length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  Tanpa satuan besar
                                </span>
                              ) : (
                                (p.units ?? []).map((u) => (
                                  <Badge key={u.code} variant="outline" className="gap-1">
                                    <Layers className="size-3" />
                                    {u.code} = {u.factor} {p.unit ?? "PCS"}
                                  </Badge>
                                ))
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {tiers.length === 0
                                ? "Harga dasar saja"
                                : `Tier: ${describeTiers(p.tiers)}`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Terkunci</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-xs text-muted-foreground">
                          {describeModifierGroups(p.modifiers)}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{p.stock}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col items-start gap-1">
                          {/*
                            Dua hal berbeda: ketersediaan stok dan status jual.
                            Produk nonaktif tetap bisa berstok (barangnya ada di
                            gudang), jadi keduanya ditampilkan, bukan saling
                            menimpa.
                          */}
                          {p.stock === 0 ? (
                            <Badge variant="outline">Habis</Badge>
                          ) : p.stock <= 5 ? (
                            <Badge variant="accent">Menipis</Badge>
                          ) : (
                            <Badge>Tersedia</Badge>
                          )}
                          {p.active ? (
                            <span className="text-xs text-muted-foreground">Dijual di kasir</span>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <PowerOff className="size-3" /> Nonaktif
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col items-end gap-1">
                          {canAdjust && (
                            <Button
                              type="button"
                              size="sm"
                              variant={isAdjusting ? "secondary" : "outline"}
                              aria-label={`Sesuaikan stok ${p.name}`}
                              onClick={() =>
                                isAdjusting ? setAdjusting(null) : openAdjuster(p)
                              }
                            >
                              {isAdjusting ? (
                                <>
                                  <X className="size-3.5" /> Tutup
                                </>
                              ) : (
                                "Sesuaikan stok"
                              )}
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant={isEditing ? "secondary" : "outline"}
                            aria-label={`Atur harga ${p.name}`}
                            onClick={() => (isEditing ? closeEditor() : openEditor(p))}
                          >
                            {isEditing ? (
                              <>
                                <X className="size-3.5" /> Tutup
                              </>
                            ) : (
                              "Atur harga"
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={isModifierEditing ? "secondary" : "outline"}
                            aria-label={`Modifier ${p.name}`}
                            onClick={() =>
                              isModifierEditing
                                ? closeModifierEditor()
                                : openModifierEditor(p)
                            }
                          >
                            {isModifierEditing ? (
                              <>
                                <X className="size-3.5" /> Tutup
                              </>
                            ) : (
                              <>
                                <Sparkles className="size-3.5" /> Modifier
                              </>
                            )}
                          </Button>
                          {canCreate && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={togglingStatus === p.id}
                              aria-label={
                                p.active
                                  ? `Nonaktifkan produk ${p.name}`
                                  : `Aktifkan produk ${p.name}`
                              }
                              onClick={() => void toggleStatus(p)}
                            >
                              {p.active ? (
                                <>
                                  <PowerOff className="size-3.5" />
                                  {togglingStatus === p.id ? "Menyimpan…" : "Nonaktifkan"}
                                </>
                              ) : (
                                <>
                                  <Power className="size-3.5" />
                                  {togglingStatus === p.id ? "Menyimpan…" : "Aktifkan"}
                                </>
                              )}
                            </Button>
                          )}
                          {canCreate && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={menghapusProduk && hapusProduk?.id === p.id}
                              aria-label={`Hapus produk ${p.name}`}
                              onClick={() => void bukaHapus(p)}
                            >
                              <Trash2 className="size-3.5" /> Hapus
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isModifierEditing && modifierDraft && (
                      <tr className="border-t border-border/70 bg-secondary/20">
                        <td colSpan={9} className="px-4 py-4">
                          <ModifierEditor
                            draft={modifierDraft}
                            onChange={setModifierDraft}
                            moduleOn={fnbOn}
                          />
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Button
                              type="button"
                              disabled={savingModifiers}
                              onClick={() => void saveModifiers(p.id)}
                            >
                              <Save className="size-4" />
                              {savingModifiers ? "Menyimpan…" : "Simpan modifier"}
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              Harga modifier ditambahkan <strong>per unit yang dijual</strong>{" "}
                              (2× pesanan = 2× tambahan), dan grup bertanda “wajib” harus
                              dipilih kasir sebelum pesanan bisa disimpan.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}

                    {isAdjusting && (
                      <tr className="border-t border-border/70 bg-secondary/20">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid gap-3 md:grid-cols-4">
                            <div className="text-xs text-muted-foreground md:col-span-4">
                              Stok <strong className="text-foreground">{p.name}</strong> saat ini{" "}
                              <span className="font-mono text-foreground">{p.stock}</span>{" "}
                              {p.unit ?? "PCS"} di lokasi jual. Tulis angka <strong>negatif</strong>{" "}
                              untuk mengurangi (mis. rusak, hilang, salah hitung).
                            </div>
                            <label className="space-y-1 text-xs text-muted-foreground">
                              Jumlah penyesuaian
                              <Input
                                className="font-mono"
                                inputMode="numeric"
                                value={adjustDraft.quantity}
                                placeholder="12"
                                aria-label={`Jumlah penyesuaian stok ${p.name}`}
                                onChange={(e) =>
                                  setAdjustDraft((current) => ({
                                    ...current,
                                    quantity: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">
                              Catatan (opsional)
                              <Input
                                value={adjustDraft.note}
                                placeholder="Barang datang tanpa PO"
                                aria-label={`Catatan penyesuaian stok ${p.name}`}
                                onChange={(e) =>
                                  setAdjustDraft((current) => ({
                                    ...current,
                                    note: e.target.value,
                                  }))
                                }
                              />
                            </label>
                            <div className="flex flex-col justify-end gap-2">
                              <p className="text-xs text-muted-foreground">
                                Stok jadi{" "}
                                <span className="font-mono text-foreground">
                                  {p.stock + deltaDraft}
                                </span>
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                disabled={adjustingStock || p.stock + deltaDraft < 0}
                                onClick={() => void submitAdjustment(p)}
                              >
                                <Save className="size-3.5" />
                                {adjustingStock ? "Menyimpan…" : "Sesuaikan stok"}
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {isEditing && draft && (
                      <tr className="border-t border-border/70 bg-secondary/20">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-3">
                            <div className="space-y-2">
                              <Label htmlFor={`nama-${p.id}`}>Nama produk</Label>
                              <Input
                                id={`nama-${p.id}`}
                                value={draft.name}
                                aria-label={`Nama produk ${p.name}`}
                                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                              />
                              <Label htmlFor={`sku-${p.id}`}>SKU</Label>
                              <Input
                                id={`sku-${p.id}`}
                                className="font-mono"
                                value={draft.sku}
                                aria-label={`SKU produk ${p.name}`}
                                onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                              />
                              <Label htmlFor={`biaya-${p.id}`}>Harga beli per satuan dasar</Label>
                              <Input
                                id={`biaya-${p.id}`}
                                inputMode="numeric"
                                className="font-mono"
                                value={draft.cost}
                                aria-label={`Harga beli ${p.name}`}
                                onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Nama dan SKU dipakai apa adanya (SKU tetap unik per workspace);
                                harga beli dipakai menghitung margin, bukan harga yang dibayar
                                pembeli.
                              </p>
                              <Label htmlFor={`price-${p.id}`}>Harga dasar</Label>
                              <Input
                                id={`price-${p.id}`}
                                inputMode="numeric"
                                value={draft.price}
                                onChange={(e) =>
                                  setDraft({ ...draft, price: e.target.value })
                                }
                              />
                              <Label htmlFor={`unit-${p.id}`}>Satuan dasar</Label>
                              <Input
                                id={`unit-${p.id}`}
                                value={draft.unit}
                                disabled={!wholesaleOn}
                                onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                                placeholder="PCS"
                              />
                              <Label htmlFor={`category-${p.id}`}>Kategori</Label>
                              <select
                                id={`category-${p.id}`}
                                className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                                value={draft.category}
                                aria-label={`Kategori produk ${p.name}`}
                                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                              >
                                <option value="">Tanpa kategori</option>
                                {/**
                                  Kategori aktif, ditambah kategori produk ini sendiri
                                  walau sudah nonaktif — kalau tidak, membuka “Atur
                                  harga” akan tampak seperti memindahkan produknya.
                                */}
                                {selectableCategoryNames(categories, p.category).map((nama) => (
                                  <option key={nama} value={nama}>
                                    {nama}
                                    {kategoriNonaktif.has(categoryNameKey(nama))
                                      ? " (nonaktif)"
                                      : ""}
                                  </option>
                                ))}
                              </select>
                              <p className="text-[11px] text-muted-foreground">
                                SKU <span className="font-mono text-foreground">{p.sku}</span> — SKU buatan
                                sistem (PBB-…) ikut menyesuaikan saat kategorinya diganti; SKU yang diketik
                                sendiri tidak diubah.
                              </p>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label>Konversi satuan</Label>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={!wholesaleOn}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      units: [...draft.units, { code: "", factor: "" }],
                                    })
                                  }
                                >
                                  + Satuan
                                </Button>
                              </div>
                              {draft.units.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Belum ada satuan besar (mis. DUS = 24 Pcs).
                                </p>
                              )}
                              {draft.units.map((unit, index) => (
                                <div key={index} className="flex items-center gap-2">
                                  <Input
                                    aria-label={`Kode satuan ${index + 1}`}
                                    value={unit.code}
                                    disabled={!wholesaleOn}
                                    placeholder="DUS"
                                    onChange={(e) => {
                                      const units = [...draft.units];
                                      units[index] = { ...unit, code: e.target.value };
                                      setDraft({ ...draft, units });
                                    }}
                                  />
                                  <Input
                                    aria-label={`Faktor satuan ${index + 1}`}
                                    value={unit.factor}
                                    disabled={!wholesaleOn}
                                    inputMode="numeric"
                                    placeholder="24"
                                    onChange={(e) => {
                                      const units = [...draft.units];
                                      units[index] = { ...unit, factor: e.target.value };
                                      setDraft({ ...draft, units });
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={!wholesaleOn}
                                    aria-label={`Hapus satuan ${index + 1}`}
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        units: draft.units.filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    <X className="size-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label>Harga bertingkat</Label>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={!wholesaleOn}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      tiers: [...draft.tiers, { minQty: "", price: "" }],
                                    })
                                  }
                                >
                                  + Tier
                                </Button>
                              </div>
                              {draft.tiers.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Belum ada tier; semua kuantitas memakai harga dasar.
                                </p>
                              )}
                              {draft.tiers.map((tier, index) => (
                                <div key={index} className="flex items-center gap-2">
                                  <Input
                                    aria-label={`Kuantitas tier ${index + 1}`}
                                    value={tier.minQty}
                                    disabled={!wholesaleOn}
                                    inputMode="numeric"
                                    placeholder="24"
                                    onChange={(e) => {
                                      const tiers = [...draft.tiers];
                                      tiers[index] = { ...tier, minQty: e.target.value };
                                      setDraft({ ...draft, tiers });
                                    }}
                                  />
                                  <Input
                                    aria-label={`Harga tier ${index + 1}`}
                                    value={tier.price}
                                    disabled={!wholesaleOn}
                                    inputMode="numeric"
                                    placeholder="4500"
                                    onChange={(e) => {
                                      const tiers = [...draft.tiers];
                                      tiers[index] = { ...tier, price: e.target.value };
                                      setDraft({ ...draft, tiers });
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={!wholesaleOn}
                                    aria-label={`Hapus tier ${index + 1}`}
                                    onClick={() =>
                                      setDraft({
                                        ...draft,
                                        tiers: draft.tiers.filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    <X className="size-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Button
                              type="button"
                              disabled={saving}
                              onClick={() => void save(p)}
                            >
                              <Save className="size-4" />
                              {saving ? "Menyimpan…" : "Simpan harga"}
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              Tier selalu dihitung dalam satuan dasar
                              {wholesaleOn
                                ? " — harga tier tidak boleh lebih mahal dari harga dasar."
                                : "."}
                            </p>
                          </div>

                          {/*
                            Gambar produk ada di kartu edit ini juga: unggahannya
                            **langsung** tersimpan (tidak menunggu “Simpan harga”),
                            karena berkasnya sudah punya tempat di penyimpanan begitu
                            ditautkan ke produk.
                          */}
                          {canCreate && (
                            <div className="mt-5 border-t border-border/60 pt-4">
                              <ProductImageEditor
                                scope={p.name}
                                images={images}
                                onAddFiles={(files) => void addImages(p, files)}
                                onRemoveImage={(imageId) => void removeImage(p, imageId)}
                                busy={uploadingImage}
                                busyImageId={removingImage}
                                canEdit
                                note={
                                  images.length === 0
                                    ? `${describeProductImages(0)} — unggah foto produk supaya kasir gampang memastikan barangnya. Unggahan langsung tersimpan, tanpa menekan “Simpan harga”.`
                                    : "Gambar pertama dipakai sebagai thumbnail di daftar produk. Unggahan dan penghapusan gambar langsung tersimpan, tanpa menekan “Simpan harga”."
                                }
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/*
        Dialog hapus produk. Yang tampil adalah pagar dari server
        (`products.deletionCheck`), bukan tebakan halaman: produk yang sudah
        terjual/berstok/terpakai dokumen ditolak dengan alasannya satu per satu, dan
        tawarannya adalah menonaktifkan — bukan menghapus riwayat orang lain.
      */}
      {hapusProduk && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-label={`Hapus produk ${hapusProduk.name}`}
            className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <ShieldAlert className="size-5 text-destructive" /> Hapus produk
                </h3>
                <p className="text-sm text-muted-foreground">
                  {hapusProduk.name} · <span className="font-mono">{hapusProduk.sku}</span>
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog hapus produk"
                className="text-muted-foreground hover:text-foreground"
                onClick={tutupHapus}
              >
                <X className="size-5" />
              </button>
            </div>

            {memeriksaHapus || !pagarHapus ? (
              <p className="mt-4 rounded-lg bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                Memeriksa apakah produk ini masih dipakai…
              </p>
            ) : (
              <>
                <p className="mt-4 rounded-lg bg-secondary/40 px-4 py-3 text-sm">
                  {pagarHapus.sentence}
                </p>
                {pagarHapus.blockers.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {pagarHapus.blockers.map((alasan) => (
                      <li key={alasan}>{alasan}</li>
                    ))}
                  </ul>
                )}
                {pagarHapus.canDelete && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Tindakan ini tidak bisa dibatalkan. Kalau produknya hanya berhenti dijual,
                    tekan <strong>Nonaktifkan</strong> — produknya hilang dari kasir tanpa
                    kehilangan data.
                  </p>
                )}
              </>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={tutupHapus}>
                Batal
              </Button>
              {pagarHapus && !pagarHapus.canDelete && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={togglingStatus === hapusProduk.id}
                  aria-label={`Nonaktifkan saja ${hapusProduk.name}`}
                  onClick={() => {
                    const produk = hapusProduk;
                    tutupHapus();
                    void toggleStatus(produk);
                  }}
                >
                  <PowerOff className="size-4" /> Nonaktifkan saja
                </Button>
              )}
              <Button
                type="button"
                variant="accent"
                disabled={
                  menghapusProduk || memeriksaHapus || !pagarHapus || !pagarHapus.canDelete
                }
                aria-label={`Konfirmasi hapus produk ${hapusProduk.name}`}
                onClick={() => void submitHapus(hapusProduk)}
              >
                <Trash2 className="size-4" />
                {menghapusProduk ? "Menghapus…" : "Hapus produk"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
