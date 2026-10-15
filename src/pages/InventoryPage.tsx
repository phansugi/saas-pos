import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRightLeft,
  Lock,
  MapPin,
  Plus,
  Warehouse as WarehouseIcon,
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
import { DEFAULT_WAREHOUSE_ID, describeWarehouse, suggestWarehouseCode } from "@/lib/inventory";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useCan } from "@/lib/usePermission";
import { cn } from "@/lib/utils";

/**
 * Gudang & Stok (`inventory.multiwarehouse`) — Phase 3.
 *
 * Satu aturan yang menentukan halaman ini: **kasir menjual dari lokasi jual**,
 * bukan dari gudang. Karena itu halaman ini menunjukkan stok per lokasi dan
 * memindahkannya, sedangkan halaman Produk tetap menampilkan angka yang bisa
 * dijual. Barang yang masih di gudang harus dipindahkan dulu — persis seperti
 * stok fisik yang harus dibawa ke rak depan sebelum bisa terjual.
 *
 * Menambah gudang butuh fitur `inventory.multiwarehouse` (Enterprise) dan sisa
 * slot paket; memindahkan stok **tidak** digerbang fitur, supaya gudang lama
 * tetap bisa dikosongkan kalau paketnya turun.
 */
export function InventoryPage() {
  const {
    products,
    warehouses,
    stock,
    warehouseCapacity,
    transfers,
    createWarehouse,
    setWarehouseActive,
    transferStock,
    modules,
  } = useStore();
  const { session } = useSession();
  const can = useCan();

  const canManage = can("inventory.manage");
  const planKey = session?.tenant?.planKey ?? "starter";
  const gateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "inventory.multiwarehouse",
  );

  const namedWarehouses = useMemo(
    () => warehouses.filter((warehouse) => !warehouse.isDefault),
    [warehouses],
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", address: "" });
  const [move, setMove] = useState({
    productId: "",
    from: DEFAULT_WAREHOUSE_ID,
    to: "",
    quantity: "1",
    note: "",
  });

  const totals = useMemo(
    () => ({
      sellable: stock.reduce((sum, row) => sum + row.sellable, 0),
      stored: stock.reduce((sum, row) => sum + (row.total - row.sellable), 0),
      withStock: stock.filter((row) => row.total > 0).length,
    }),
    [stock],
  );

  function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    action()
      .then(() => setNotice(message))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  }

  function addWarehouse() {
    if (busy) return;
    run(
      async () => {
        const created = await createWarehouse({
          name: form.name,
          code: form.code.trim() || undefined,
          address: form.address.trim() || undefined,
        });
        setForm({ name: "", code: "", address: "" });
        return created;
      },
      `Gudang ${form.name} ditambahkan.`,
    );
  }

  function submitTransfer() {
    if (busy) return;
    const quantity = Number(move.quantity);
    const target = move.to || namedWarehouses[0]?.id || DEFAULT_WAREHOUSE_ID;
    run(
      async () => {
        const result = await transferStock({
          productId: move.productId || products[0]?.id || "",
          from: move.from,
          to: target,
          quantity,
          note: move.note.trim() || undefined,
        });
        setMove((current) => ({ ...current, quantity: "1", note: "" }));
        return result;
      },
      `${quantity} unit dipindahkan.`,
    );
  }

  const targetOptions = warehouses.filter((warehouse) => warehouse.id !== move.from);
  const defaultTarget = move.to || targetOptions[0]?.id || "";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <WarehouseIcon className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Gudang &amp; Stok</h2>
            <p className="text-sm text-muted-foreground">
              {warehouses.length} lokasi · {totals.withStock} dari {stock.length} SKU
              punya stok · batas paket {warehouseCapacity.limit === "unlimited"
                ? "tanpa batas"
                : `${warehouseCapacity.limit} lokasi`}
            </p>
          </div>
        </div>
        {gateReason && (
          <Badge variant="outline" className="gap-1.5 py-1">
            <Lock className="size-3" />
            Gudang tambahan tidak tersedia
          </Badge>
        )}
      </header>

      {gateReason && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {gateReason} Stok yang sudah ada tetap bisa dilihat dan dipindahkan —
          hanya menambah gudang baru yang memerlukannya.{" "}
          {can("billing.manage") && (
            <Link to="/app/subscription" className="underline">
              Kelola langganan
            </Link>
          )}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          {notice}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Lokasi stok",
            value: `${warehouseCapacity.used}`,
            hint: `${namedWarehouses.length} gudang + lokasi jual`,
          },
          { label: "Bisa dijual", value: String(totals.sellable), hint: "unit di lokasi jual" },
          { label: "Di gudang", value: String(totals.stored), hint: "belum bisa dijual" },
          {
            label: "Sisa slot",
            value:
              warehouseCapacity.limit === "unlimited"
                ? "∞"
                : String(warehouseCapacity.remaining),
            hint: "menurut paket aktif",
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="font-mono text-xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{card.hint}</CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lokasi stok</CardTitle>
          <CardDescription>
            Lokasi jual adalah tempat kasir menjual; setiap gudang menampung stok
            simpanan sampai dipindahkan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Kode</th>
                  <th className="px-2 py-2">Nama</th>
                  <th className="px-2 py-2">Alamat</th>
                  <th className="px-2 py-2">Stok</th>
                  <th className="px-2 py-2">Status</th>
                  {canManage && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {warehouses.map((warehouse) => {
                  const held = stock.reduce(
                    (sum, row) =>
                      sum +
                      (row.levels.find((level) => level.warehouseId === warehouse.id)
                        ?.quantity ?? 0),
                    0,
                  );
                  return (
                    <tr key={warehouse.id} className="border-t border-border/60">
                      <td className="px-2 py-2 font-mono text-xs">{warehouse.code}</td>
                      <td className="px-2 py-2">{warehouse.name}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {warehouse.address ?? "—"}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{held}</td>
                      <td className="px-2 py-2">
                        <Badge variant={warehouse.active ? "default" : "outline"}>
                          {warehouse.isDefault
                            ? "lokasi jual"
                            : warehouse.active
                              ? "aktif"
                              : "nonaktif"}
                        </Badge>
                      </td>
                      {canManage && (
                        <td className="px-2 py-2 text-right">
                          {!warehouse.isDefault && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => setWarehouseActive(warehouse.id, !warehouse.active),
                                  warehouse.active
                                    ? `${describeWarehouse(warehouse)} dinonaktifkan.`
                                    : `${describeWarehouse(warehouse)} diaktifkan kembali.`,
                                )
                              }
                            >
                              {warehouse.active ? "Nonaktifkan" : "Aktifkan"}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canManage && (
            <div className="mt-5 rounded-lg border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="size-4" />
                Tambah gudang
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Nama gudang
                  <Input
                    className="mt-1"
                    value={form.name}
                    placeholder="Gudang Utama"
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((current) => ({
                        ...current,
                        name,
                        code:
                          current.code === ""
                            ? suggestWarehouseCode(
                                name,
                                warehouses.map((warehouse) => warehouse.code),
                              )
                            : current.code,
                      }));
                    }}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Kode
                  <Input
                    className="mt-1 font-mono"
                    value={form.code}
                    placeholder="GD-A"
                    onChange={(e) => setForm((c) => ({ ...c, code: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Alamat (opsional)
                  <Input
                    className="mt-1"
                    value={form.address}
                    placeholder="Jl. Sudirman 12"
                    onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))}
                  />
                </label>
                <div className="flex items-start md:col-span-4">
                  <Button
                    className="w-full md:w-auto"
                    disabled={busy || gateReason !== null || form.name.trim().length < 2}
                    title={gateReason ?? "Tambah gudang"}
                    onClick={addWarehouse}
                  >
                    <WarehouseIcon />
                    Simpan gudang
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Lokasi jual sudah menempati satu slot paket
                {warehouseCapacity.limit === "unlimited"
                  ? "; paket ini tidak membatasi jumlah gudang."
                  : `; paket ini memungkinkan ${warehouseCapacity.limit} lokasi total.`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------ pindah stok ------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="size-4" />
            Pindah stok antar lokasi
          </CardTitle>
          <CardDescription>
            Perpindahan dicatat sebagai dua baris ledger dengan satu nomor
            (TRF-…), jadi total stok tidak pernah berubah karena pemindahan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            <label className="text-xs text-muted-foreground md:col-span-2">
              Produk
              <select
                className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={move.productId || products[0]?.id || ""}
                aria-label="Produk yang dipindahkan"
                onChange={(e) => setMove((c) => ({ ...c, productId: e.target.value }))}
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Dari
              <select
                className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={move.from}
                aria-label="Lokasi asal"
                onChange={(e) =>
                  setMove((c) => ({ ...c, from: e.target.value, to: "" }))
                }
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Ke
              <select
                className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={defaultTarget}
                aria-label="Lokasi tujuan"
                onChange={(e) => setMove((c) => ({ ...c, to: e.target.value }))}
              >
                {targetOptions.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Jumlah
              <Input
                className="mt-1 font-mono"
                type="number"
                min={1}
                value={move.quantity}
                aria-label="Jumlah dipindahkan"
                onChange={(e) => setMove((c) => ({ ...c, quantity: e.target.value }))}
              />
            </label>
            <label className="text-xs text-muted-foreground md:col-span-3">
              Catatan (opsional)
              <Input
                className="mt-1"
                value={move.note}
                placeholder="Stok untuk rak depan"
                onChange={(e) => setMove((c) => ({ ...c, note: e.target.value }))}
              />
            </label>
            <div className="flex items-start md:col-span-2">
              <Button
                className="w-full md:w-auto"
                disabled={busy || products.length === 0 || targetOptions.length === 0}
                onClick={submitTransfer}
              >
                <ArrowRightLeft />
                Pindah stok
              </Button>
            </div>
          </div>
          {!canManage && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Melihat lokasi butuh izin `inventory.view`; memindahkan stok butuh
              peran manajer, pemilik, atau staf gudang.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------- stok per lokasi --------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stok per lokasi</CardTitle>
          <CardDescription>
            Angka &quot;bisa dijual&quot; inilah yang dipakai kasir; sisanya berada di
            gudang sampai dipindahkan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Produk</th>
                  {warehouses.map((warehouse) => (
                    <th key={warehouse.id} className="px-2 py-2 text-right">
                      {warehouse.code}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <tr key={row.productId} className="border-t border-border/60">
                    <td className="px-2 py-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {row.sku} · {row.unit}
                      </div>
                    </td>
                    {warehouses.map((warehouse) => {
                      const quantity =
                        row.levels.find((level) => level.warehouseId === warehouse.id)
                          ?.quantity ?? 0;
                      return (
                        <td
                          key={warehouse.id}
                          className={cn(
                            "px-2 py-2 text-right font-mono",
                            warehouse.isDefault && quantity <= 5 && "text-destructive",
                            !warehouse.isDefault && quantity === 0 && "text-muted-foreground",
                          )}
                        >
                          {quantity}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right font-mono font-semibold">
                      {row.total}
                    </td>
                  </tr>
                ))}
                {stock.length === 0 && (
                  <tr>
                    <td
                      colSpan={warehouses.length + 2}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada produk aktif.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" />
            Riwayat perpindahan
          </CardTitle>
          <CardDescription>Langsung dari ledger stok, terbaru dulu.</CardDescription>
        </CardHeader>
        <CardContent>
          {transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada perpindahan stok.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {transfers.map((transfer) => (
                <li
                  key={`${transfer.number}-${transfer.at}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {transfer.number}
                  </span>
                  <span className="font-medium">{transfer.productName}</span>
                  <span className="text-muted-foreground">
                    {transfer.fromName} → {transfer.toName}
                  </span>
                  <span className="font-mono">{transfer.quantity} unit</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(transfer.at).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
