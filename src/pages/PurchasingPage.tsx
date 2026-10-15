import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  ClipboardList,
  FileText,
  Landmark,
  Lock,
  PackageCheck,
  Pencil,
  Plus,
  Truck,
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
import { AGING_BUCKETS, AGING_LABELS, rupiah } from "@/lib/ar";
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory";
import { MATCH_DECISION_LABELS, MATCH_STATUS_LABELS } from "@/lib/threeway";
import {
  describeOrderProgress,
  lineRemaining,
  orderStatusFromLines,
  ORDER_STATUS_LABELS,
  REQUISITION_STATUS_LABELS,
  suggestSupplierCode,
} from "@/lib/purchasing";
import { useSession } from "@/lib/session";
import { PAYMENT_LABELS, useStore, type PaymentLabel } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useCan } from "@/lib/usePermission";
import { cn, formatIDR } from "@/lib/utils";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Pembelian: PR · PO · GRN (`purchasing.basic`) — Phase 3.
 *
 * Halaman ini menunjukkan alurnya, bukan menciptakannya: **PR** diajukan gudang,
 * **disetujui** pemilik/manajer, baru **PO** dibuat ke supplier, dan barangnya
 * dicatat datang lewat **GRN** — satu-satunya jalur yang menggerakkan stok masuk.
 * Setiap tombol mewakili izin yang berbeda, jadi tidak ada satu orang yang bisa
 * memesan, menyetujui, sekaligus menerima barangnya sendiri.
 *
 * Membuat PR/PO butuh paket yang memuat `purchasing.basic`; **menerima barang
 * tidak** — pesanan yang sudah jalan harus tetap bisa dicatat datang walau
 * paketnya turun.
 *
 * Tempo supplier tidak berhenti di kolom "tempo": barang yang datang dengan
 * jadwal bayar mundur otomatis menjadi **hutang usaha** dengan jatuh tempo, dan
 * halaman ini menunjukkan umurnya, sisanya, dan jalan membayarnya. Supplier yang
 * punya tagihan lewat jatuh tempo juga ditandai di sini — server menolak PO baru
 * ke supplier itu sampai dibayar.
 */
export function PurchasingPage() {
  const {
    products,
    warehouses,
    suppliers,
    requisitions,
    orders,
    receipts,
    purchasingSummary,
    createSupplier,
    updateSupplier,
    createRequisition,
    decideRequisition,
    createOrder,
    cancelOrder,
    receiveGoods,
    payables,
    payablePayments,
    payableSummary,
    threewaySummary,
    paymentBatches,
    createBill,
    recordInvoice,
    resolvePayableMatch,
    recordPayablePayment,
    payPayables,
    modules,
  } = useStore();
  const { session } = useSession();
  const can = useCan();

  const canRequest = can("purchase.request");
  const canApprove = can("purchase.approve");
  const canReceive = can("purchase.receive");
  const canSeePayables = can("payable.view");
  const canPay = can("payable.manage");

  const planKey = session?.tenant?.planKey ?? "starter";
  const gateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "purchasing.basic",
  );
  /** Gerbang fitur untuk pencocokan 3 arah (paket yang memuat `purchasing.threeway`). */
  const threewayGate = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "purchasing.threeway",
  );

  const costById = useMemo(
    () => new Map(products.map((product) => [product.id, product.cost])),
    [products],
  );
  const nameById = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [prForm, setPrForm] = useState({ productId: "", quantity: "1", note: "" });
  const [prLines, setPrLines] = useState<
    { productId: string; quantity: number; note?: string }[]
  >([]);

  const [orderForm, setOrderForm] = useState({
    requisitionId: "",
    supplierId: "",
    costs: {} as Record<string, string>,
    expectedAt: "",
  });

  const [receiptForm, setReceiptForm] = useState({
    orderId: "",
    warehouseId: DEFAULT_WAREHOUSE_ID,
    quantities: {} as Record<string, string>,
    note: "",
  });

  const [supplierForm, setSupplierForm] = useState({
    name: "",
    code: "",
    phone: "",
    termDays: "30",
  });

  /** Supplier yang sedang diubah (dialog), `null` = tidak ada dialog. */
  const [editSupplier, setEditSupplier] = useState<{
    id: string;
    name: string;
    phone: string;
    address: string;
    termDays: string;
    active: boolean;
  } | null>(null);

  const [billForm, setBillForm] = useState({
    supplierId: "",
    reference: "",
    amount: "",
    dueDate: "",
    note: "",
  });

  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentLabel>("Transfer");

  /** Pencocokan 3 arah: dokumen supplier yang sedang diisi & keputusan selisih. */
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({
    reference: "",
    dueDate: "",
    lines: [] as { productId: string; name: string; quantity: string; unitCost: string }[],
  });
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  /** Bayar sekaligus: tagihan terpilih + metode satu kali bayar. */
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchMethod, setBatchMethod] = useState<PaymentLabel>("Transfer");

  const approvedWithoutOrder = requisitions.filter(
    (row) => row.status === "approved" && !row.orderNumber,
  );
  const openOrders = orders.filter(
    (order) => order.status === "open" || order.status === "partial",
  );
  const selectedOrder =
    openOrders.find((order) => order.id === receiptForm.orderId) ?? openOrders[0] ?? null;
  const selectedRequisition =
    approvedWithoutOrder.find((row) => row.id === orderForm.requisitionId) ??
    approvedWithoutOrder[0] ??
    null;
  const selectedSupplierId =
    suppliers.find((supplier) => supplier.id === orderForm.supplierId)?.id ??
    suppliers.find((supplier) => supplier.active)?.id ??
    "";
  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null;

  const openPayables = useMemo(
    () => payables.filter((row) => row.balance > 0),
    [payables],
  );
  const payablesById = useMemo(
    () => new Map(payables.map((row) => [row.id, row])),
    [payables],
  );
  /** Tagihan terbuka yang dokumen suppliernya belum dicatat atau masih berselisih. */
  const reviewPayables = useMemo(
    () =>
      openPayables.filter(
        (row) =>
          row.match.status === "waiting_invoice" ||
          (row.match.flagged && row.decision?.kind !== "accepted"),
      ),
    [openPayables],
  );
  /** Tagihan terbuka, yang perlu ditinjau lebih dulu — itulah urutan kerja keuangan. */
  const matchRows = useMemo(
    () =>
      openPayables
        .slice()
        .sort((a, b) => {
          const rank = (row: (typeof openPayables)[number]) =>
            row.match.status === "waiting_invoice" ? 0 : row.match.flagged ? 1 : 2;
          return rank(a) - rank(b) || a.dueDate - b.dueDate;
        }),
    [openPayables],
  );
  const selectedMatch = detailFor ? (payablesById.get(detailFor) ?? null) : null;
  const invoiceTarget = invoiceFor ? (payablesById.get(invoiceFor) ?? null) : null;
  const invoiceLines = invoiceForm.lines;
  const invoiceTotal = invoiceLines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0),
    0,
  );
  /** Nilai barang yang sudah diterima untuk tagihan yang sedang diisi dokumennya. */
  const invoiceReceivedValue = invoiceTarget?.match.receivedValue ?? 0;
  const batchPayables = batchIds
    .map((id) => payablesById.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const batchTotal = batchPayables.reduce((sum, row) => sum + row.balance, 0);
  const payingPayable = openPayables.find((row) => row.id === payFor) ?? null;
  const billSupplierId =
    billForm.supplierId || suppliers.find((supplier) => supplier.active)?.id || "";
  const latestPayments = payablePayments.slice(0, 5);

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

  function addRequisitionLine() {
    const productId = prForm.productId || products[0]?.id;
    const quantity = Number(prForm.quantity);
    if (!productId) return;
    if (prLines.some((line) => line.productId === productId)) {
      setError(`${nameById.get(productId) ?? "Produk"} sudah ada di daftar permintaan.`);
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Jumlah permintaan harus bilangan bulat lebih dari 0.");
      return;
    }
    setError(null);
    setPrLines((current) => [
      ...current,
      { productId, quantity: Math.trunc(quantity), note: prForm.note.trim() || undefined },
    ]);
    setPrForm((current) => ({ ...current, quantity: "1", note: "" }));
  }

  function submitRequisition() {
    if (busy || prLines.length === 0) return;
    run(
      async () => {
        const created = await createRequisition({ lines: prLines });
        setPrLines([]);
        return created;
      },
      "Permintaan pembelian dikirim dan menunggu persetujuan.",
    );
  }

  function submitOrder() {
    if (busy || !selectedRequisition || !selectedSupplierId) return;
    const lines = selectedRequisition.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitCost: Number(
        orderForm.costs[line.productId] ?? String(costById.get(line.productId) ?? 0),
      ),
    }));
    run(
      async () => {
        const created = await createOrder({
          supplierId: selectedSupplierId,
          requisitionId: selectedRequisition.id,
          lines,
          expectedAt: orderForm.expectedAt
            ? new Date(`${orderForm.expectedAt}T00:00:00`).getTime()
            : undefined,
        });
        setOrderForm((current) => ({ ...current, requisitionId: "", costs: {} }));
        return created;
      },
      "PO dibuat dan dikirim ke supplier.",
    );
  }

  function submitReceipt() {
    if (busy || !selectedOrder) return;
    const lines = selectedOrder.lines
      .map((line) => ({
        productId: line.productId,
        quantity: Number(
          receiptForm.quantities[line.productId] ?? String(lineRemaining(line)),
        ),
      }))
      // Baris yang belum datang cukup dikosongkan/diisi 0.
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    if (lines.length === 0) {
      setError("Isi jumlah barang yang benar-benar diterima (minimal satu baris).");
      return;
    }
    run(
      async () => {
        const result = await receiveGoods({
          orderId: selectedOrder.id,
          warehouseId: receiptForm.warehouseId,
          lines,
          note: receiptForm.note.trim() || undefined,
        });
        setReceiptForm({ orderId: "", warehouseId: DEFAULT_WAREHOUSE_ID, quantities: {}, note: "" });
        return result;
      },
      "Barang diterima dan stok masuk ke lokasi yang dipilih.",
    );
  }

  function submitSupplierEdit() {
    if (busy || !editSupplier) return;
    const target = editSupplier;
    run(
      async () => {
        await updateSupplier({
          supplierId: target.id,
          name: target.name,
          phone: target.phone,
          address: target.address,
          paymentTermDays: Number(target.termDays) || 0,
          active: target.active,
        });
        setEditSupplier(null);
      },
      "Supplier diperbarui — tempo baru dipakai untuk hutang berikutnya.",
    );
  }

  function submitBill() {
    if (busy || !billSupplierId) return;
    const amount = Number(billForm.amount);
    const due = billForm.dueDate
      ? new Date(`${billForm.dueDate}T00:00:00`).getTime()
      : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Nilai tagihan supplier harus lebih dari 0.");
      return;
    }
    if (!Number.isFinite(due)) {
      setError("Isi tanggal jatuh tempo tagihan.");
      return;
    }
    run(
      async () => {
        const created = await createBill({
          supplierId: billSupplierId,
          reference: billForm.reference.trim() || undefined,
          amount,
          dueDate: due,
          note: billForm.note.trim() || undefined,
        });
        setBillForm({ supplierId: "", reference: "", amount: "", dueDate: "", note: "" });
        return created;
      },
      "Tagihan supplier dicatat sebagai hutang usaha.",
    );
  }

  /**
   * Membuka form dokumen supplier untuk satu tagihan: barisnya dimulai dari
   * yang **benar-benar diterima** (GRN), jadi mencatat tagihan yang cocok tidak
   * perlu mengetik ulang apa pun.
   */
  function openInvoiceForm(payable: (typeof payables)[number]) {
    setError(null);
    setNotice(null);
    setDetailFor(payable.id);
    setInvoiceFor(payable.id);
    const lines = payable.invoice
      ? payable.invoice.lines
      : payable.match.lines
          .filter((line) => line.receivedQty > 0)
          .map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.receivedQty,
            unitCost: line.receivedUnitCost,
          }));
    setInvoiceForm({
      reference: payable.invoice?.reference ?? payable.reference ?? "",
      dueDate: new Date(payable.dueDate).toISOString().slice(0, 10),
      lines: lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: String(line.quantity),
        unitCost: String(line.unitCost),
      })),
    });
  }

  function submitInvoice() {
    if (busy || !invoiceTarget) return;
    if (invoiceForm.lines.length === 0) {
      setError("Tidak ada baris barang untuk dicocokkan di tagihan ini.");
      return;
    }
    const due = invoiceForm.dueDate
      ? new Date(`${invoiceForm.dueDate}T00:00:00`).getTime()
      : undefined;
    const target = invoiceTarget;
    const total = invoiceTotal;
    run(
      async () => {
        const result = await recordInvoice({
          payableId: target.id,
          reference: invoiceForm.reference.trim() || undefined,
          dueDate: due,
          lines: invoiceForm.lines.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            unitCost: Number(line.unitCost),
          })),
        });
        setInvoiceFor(null);
        return result;
      },
      `Dokumen supplier ${target.number} dicatat (${(total / 1).toLocaleString("id-ID")} rupiah); hasil pencocokannya langsung terlihat di tabel.`,
    );
  }

  function submitDecision(
    payable: (typeof payables)[number],
    kind: "accepted" | "disputed" | "none",
  ) {
    if (busy) return;
    const note = decisionNote.trim() || undefined;
    if (kind === "disputed" && (note ?? "").length < 3) {
      setError("Tuliskan alasan sengketa (minimal 3 karakter).");
      return;
    }
    run(
      async () => {
        const result = await resolvePayableMatch({
          payableId: payable.id,
          kind,
          note: kind === "none" ? undefined : note,
        });
        setDecisionNote("");
        return result;
      },
      kind === "accepted"
        ? `Selisih ${payable.number} diterima; nilai hutangnya menyesuaikan total tagihan supplier.`
        : kind === "disputed"
          ? `Tagihan ${payable.number} disengketakan; pembayarannya ditahan sampai sengketanya selesai.`
          : `Sengketa ${payable.number} dicabut; tagihannya bisa dibayar lagi.`,
    );
  }

  function toggleBatch(id: string) {
    setBatchIds((current) =>
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
    );
  }

  function submitBatchPayment() {
    if (busy || batchPayables.length === 0) return;
    const rows = batchPayables;
    const total = batchTotal;
    run(
      async () => {
        const result = await payPayables({
          payments: rows.map((row) => ({ payableId: row.id, amount: row.balance })),
          method: batchMethod,
        });
        setBatchIds([]);
        return result;
      },
      `${rows.length} tagihan dibayar sekaligus lewat ${batchMethod} (${(total / 1).toLocaleString("id-ID")} rupiah).`,
    );
  }

  function submitPayablePayment() {
    if (busy || !payingPayable) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Jumlah pembayaran harus lebih dari 0.");
      return;
    }
    if (amount > payingPayable.balance) {
      setError(`Pembayaran melebihi sisa hutang (${rupiah(payingPayable.balance)}).`);
      return;
    }
    const target = payingPayable;
    run(
      async () => {
        const result = await recordPayablePayment({
          payableId: target.id,
          amount,
          method: payMethod,
        });
        setPayFor(null);
        setPayAmount("");
        return result;
      },
      "Pembayaran hutang dicatat.",
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <Truck className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Pembelian</h2>
            <p className="text-sm text-muted-foreground">
              Permintaan (PR) · Pesanan (PO) · Penerimaan (GRN) · {suppliers.length} supplier ·{" "}
              {orders.length} PO
            </p>
          </div>
        </div>
        {gateReason && (
          <Badge variant="outline" className="gap-1.5 py-1">
            <Lock className="size-3" />
            PR &amp; PO baru tidak tersedia
          </Badge>
        )}
      </header>

      {gateReason && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {gateReason} Dokumen lama tetap bisa dilihat, dan{" "}
          <strong>penerimaan barang tetap bisa dicatat</strong> supaya pesanan yang
          sudah jalan tidak menggantung.{" "}
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
            label: "Menunggu persetujuan",
            value: String(purchasingSummary.pendingRequisitions),
            hint: "PR yang belum diputuskan",
          },
          {
            label: "PO terbuka",
            value: String(purchasingSummary.openOrders),
            hint: `${purchasingSummary.openOrderUnits} unit belum datang`,
          },
          {
            label: "Nilai PO terbuka",
            value: formatIDR(purchasingSummary.openOrderValue),
            hint: "komitmen belanja",
          },
          {
            label: "Diterima bulan ini",
            value: formatIDR(purchasingSummary.receivedThisMonth),
            hint: `${receipts.length} GRN tercatat`,
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

      {/* ------------------------------ PR ------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4" />
            Permintaan pembelian (PR)
          </CardTitle>
          <CardDescription>
            Diajukan staf gudang, diputuskan pemilik/manajer — yang meminta tidak
            menyetujui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Nomor</th>
                  <th className="px-2 py-2">Baris</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">PO</th>
                  {canApprove && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {requisitions.map((row) => (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="px-2 py-2 font-mono text-xs">{row.number}</td>
                    <td className="px-2 py-2">
                      <div className="space-y-0.5">
                        {row.lines.map((line) => (
                          <div key={line.productId} className="text-xs">
                            {line.quantity}× {line.name}
                            {line.note ? (
                              <span className="text-muted-foreground"> · {line.note}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Badge
                        variant={
                          row.status === "approved"
                            ? "default"
                            : row.status === "rejected"
                              ? "outline"
                              : "accent"
                        }
                      >
                        {REQUISITION_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {row.orderNumber ?? "—"}
                    </td>
                    {canApprove && (
                      <td className="px-2 py-2 text-right">
                        {row.status === "submitted" && (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => decideRequisition({ requisitionId: row.id, approve: true }),
                                  `${row.number} disetujui — lanjutkan ke PO.`,
                                )
                              }
                            >
                              Setujui
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => decideRequisition({ requisitionId: row.id, approve: false }),
                                  `${row.number} ditolak.`,
                                )
                              }
                            >
                              Tolak
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {requisitions.length === 0 && (
                  <tr>
                    <td
                      colSpan={canApprove ? 5 : 4}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada permintaan pembelian.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canRequest && (
            <div className="mt-5 rounded-lg border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="size-4" />
                Ajukan permintaan
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Produk
                  <select
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                    value={prForm.productId || products[0]?.id || ""}
                    aria-label="Produk yang diminta"
                    onChange={(e) => setPrForm((c) => ({ ...c, productId: e.target.value }))}
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
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
                    value={prForm.quantity}
                    aria-label="Jumlah diminta"
                    onChange={(e) => setPrForm((c) => ({ ...c, quantity: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Catatan
                  <Input
                    className="mt-1"
                    value={prForm.note}
                    placeholder="Stok rak depan"
                    onChange={(e) => setPrForm((c) => ({ ...c, note: e.target.value }))}
                  />
                </label>
                <div className="flex items-start gap-2 md:col-span-4">
                  <Button variant="outline" disabled={busy} onClick={addRequisitionLine}>
                    Tambah baris
                  </Button>
                  <Button
                    disabled={busy || prLines.length === 0 || gateReason !== null}
                    title={gateReason ?? "Kirim permintaan pembelian"}
                    onClick={submitRequisition}
                  >
                    Kirim permintaan ({prLines.length})
                  </Button>
                  {prLines.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setPrLines([])}
                    >
                      Kosongkan
                    </button>
                  )}
                </div>
              </div>
              {prLines.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {prLines.map((line) => (
                    <li key={line.productId}>
                      {line.quantity}× {nameById.get(line.productId) ?? line.productId}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!canRequest && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Mengajukan permintaan butuh izin `purchase.request` (staf gudang,
              manajer, pemilik).
            </p>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------ PO ------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            Pesanan pembelian (PO)
          </CardTitle>
          <CardDescription>
            Dibuat dari PR yang sudah disetujui; supplier dan harga beli ditentukan
            di sini.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Nomor</th>
                  <th className="px-2 py-2">Supplier</th>
                  <th className="px-2 py-2">Dari PR</th>
                  <th className="px-2 py-2">Progres</th>
                  <th className="px-2 py-2 text-right">Nilai</th>
                  <th className="px-2 py-2">Status</th>
                  {canApprove && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-border/60">
                    <td className="px-2 py-2 font-mono text-xs">{order.number}</td>
                    <td className="px-2 py-2">{order.supplierName}</td>
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                      {order.requisitionNumber ?? "—"}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">
                      {describeOrderProgress(order.lines)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {formatIDR(order.total)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge
                        variant={
                          order.status === "received"
                            ? "default"
                            : order.status === "cancelled"
                              ? "outline"
                              : "accent"
                        }
                      >
                        {ORDER_STATUS_LABELS[orderStatusFromLines(order.status, order.lines)]}
                      </Badge>
                    </td>
                    {canApprove && (
                      <td className="px-2 py-2 text-right">
                        {(order.status === "open" || order.status === "partial") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => cancelOrder(order.id),
                                `${order.number} dibatalkan.`,
                              )
                            }
                          >
                            Batalkan
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td
                      colSpan={canApprove ? 7 : 6}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada PO.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canApprove && (
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Truck className="size-4" />
                Buat PO dari PR yang disetujui
              </div>
              {approvedWithoutOrder.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Tidak ada PR yang menunggu dipesankan.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    <label className="text-xs text-muted-foreground">
                      PR
                      <select
                        className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                        value={selectedRequisition?.id ?? ""}
                        aria-label="Pilih PR"
                        onChange={(e) =>
                          setOrderForm((c) => ({
                            ...c,
                            requisitionId: e.target.value,
                            costs: {},
                          }))
                        }
                      >
                        {approvedWithoutOrder.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.number}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Supplier
                      <select
                        className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                        value={selectedSupplierId}
                        aria-label="Pilih supplier"
                        onChange={(e) =>
                          setOrderForm((c) => ({ ...c, supplierId: e.target.value }))
                        }
                      >
                        {suppliers
                          .filter((supplier) => supplier.active)
                          .map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.name}
                              {supplier.overdueAmount > 0 ? " (menunggak)" : ""}
                            </option>
                          ))}
                      </select>
                      {selectedSupplier && selectedSupplier.overdueAmount > 0 && (
                        <span className="mt-1 block text-[11px] text-destructive">
                          Hutang lewat jatuh tempo {formatIDR(selectedSupplier.overdueAmount)} —
                          bayar dulu sebelum memesan lagi.
                        </span>
                      )}
                    </label>
                    <label className="text-xs text-muted-foreground md:col-span-2">
                      Perkiraan datang (opsional)
                      <Input
                        className="mt-1"
                        type="date"
                        value={orderForm.expectedAt}
                        aria-label="Perkiraan tanggal datang"
                        onChange={(e) =>
                          setOrderForm((c) => ({ ...c, expectedAt: e.target.value }))
                        }
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    {selectedRequisition?.lines.map((line) => (
                      <div
                        key={line.productId}
                        className="grid items-center gap-2 md:grid-cols-4"
                      >
                        <span className="text-xs md:col-span-2">
                          {line.quantity}× {line.name}
                        </span>
                        <label className="text-xs text-muted-foreground">
                          Harga beli / unit
                          <Input
                            className="mt-1 font-mono"
                            type="number"
                            min={0}
                            aria-label={`Harga beli ${line.name}`}
                            value={
                              orderForm.costs[line.productId] ??
                              String(costById.get(line.productId) ?? 0)
                            }
                            onChange={(e) =>
                              setOrderForm((c) => ({
                                ...c,
                                costs: { ...c.costs, [line.productId]: e.target.value },
                              }))
                            }
                          />
                        </label>
                        <span className="text-right font-mono text-xs text-muted-foreground">
                          {formatIDR(
                            line.quantity *
                              Number(
                                orderForm.costs[line.productId] ??
                                  String(costById.get(line.productId) ?? 0),
                              ),
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  <Button
                    disabled={
                      busy ||
                      gateReason !== null ||
                      !selectedRequisition ||
                      !selectedSupplierId
                    }
                    title={gateReason ?? "Buat PO"}
                    onClick={submitOrder}
                  >
                    <FileText />
                    Buat PO
                  </Button>
                </div>
              )}
            </div>
          )}

          {canApprove && (
            <div className="rounded-lg border border-border/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="size-4" />
                Supplier
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Tempo menentukan kapan barang yang sudah diterima harus dibayar:
                hutangnya lahir otomatis saat penerimaan, dan umurnya tampil di
                bagian Hutang usaha.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2">Kode</th>
                      <th className="px-2 py-2">Nama</th>
                      <th className="px-2 py-2">Tempo</th>
                      <th className="px-2 py-2 text-right">Hutang</th>
                      <th className="px-2 py-2">Status</th>
                      {canApprove && <th className="px-2 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((supplier) => (
                      <tr key={supplier.id} className="border-t border-border/60">
                        <td className="px-2 py-2 font-mono text-xs">{supplier.code}</td>
                        <td className="px-2 py-2">
                          {supplier.name}
                          {supplier.phone ? (
                            <span className="block text-xs text-muted-foreground">
                              {supplier.phone}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">
                          {supplier.paymentTermDays === 0
                            ? "tunai"
                            : `${supplier.paymentTermDays} hari`}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs">
                          {supplier.openCount === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                supplier.overdueAmount > 0 && "text-destructive",
                              )}
                            >
                              {formatIDR(supplier.outstanding)}
                              {supplier.overdueCount > 0 && (
                                <span className="block text-[11px] text-destructive">
                                  {supplier.overdueCount} lewat jatuh tempo
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant={supplier.active ? "default" : "outline"}>
                            {supplier.active ? "aktif" : "nonaktif"}
                          </Badge>
                        </td>
                        {canApprove && (
                          <td className="px-2 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                setEditSupplier({
                                  id: supplier.id,
                                  name: supplier.name,
                                  phone: supplier.phone ?? "",
                                  address: supplier.address ?? "",
                                  termDays: String(supplier.paymentTermDays),
                                  active: supplier.active,
                                })
                              }
                            >
                              <Pencil />
                              Atur
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {suppliers.length === 0 && (
                      <tr>
                        <td
                          colSpan={canApprove ? 6 : 5}
                          className="px-2 py-3 text-center text-xs text-muted-foreground"
                        >
                          Belum ada supplier.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 text-sm font-semibold">Tambah supplier</div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Nama supplier
                  <Input
                    className="mt-1"
                    value={supplierForm.name}
                    placeholder="PT Sumber Rejeki"
                    onChange={(e) => {
                      const name = e.target.value;
                      setSupplierForm((current) => ({
                        ...current,
                        name,
                        code:
                          current.code === ""
                            ? suggestSupplierCode(
                                name,
                                suppliers.map((row) => row.code),
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
                    value={supplierForm.code}
                    placeholder="PSR"
                    onChange={(e) =>
                      setSupplierForm((c) => ({ ...c, code: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Tempo (hari)
                  <Input
                    className="mt-1 font-mono"
                    type="number"
                    min={0}
                    value={supplierForm.termDays}
                    onChange={(e) =>
                      setSupplierForm((c) => ({ ...c, termDays: e.target.value }))
                    }
                  />
                </label>
                <div className="md:col-span-4">
                  <Button
                    variant="outline"
                    disabled={busy || supplierForm.name.trim().length < 2}
                    onClick={() =>
                      run(
                        async () => {
                          const created = await createSupplier({
                            name: supplierForm.name,
                            code: supplierForm.code.trim() || undefined,
                            paymentTermDays: Number(supplierForm.termDays) || 0,
                          });
                          setSupplierForm({ name: "", code: "", phone: "", termDays: "30" });
                          return created;
                        },
                        "Supplier ditambahkan.",
                      )
                    }
                  >
                    Simpan supplier
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------ GRN ------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="size-4" />
            Penerimaan barang (GRN)
          </CardTitle>
          <CardDescription>
            Stok masuk ke lokasi yang dipilih, dan sisa PO dihitung ulang dari
            barisnya — bukan dari status yang bisa basi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {openOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tidak ada PO yang menunggu barang.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-xs text-muted-foreground">
                  PO
                  <select
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                    value={selectedOrder?.id ?? ""}
                    aria-label="Pilih PO"
                    onChange={(e) =>
                      setReceiptForm((c) => ({
                        ...c,
                        orderId: e.target.value,
                        quantities: {},
                      }))
                    }
                  >
                    {openOrders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.number} · {order.supplierName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  Lokasi tujuan
                  <select
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                    value={receiptForm.warehouseId}
                    aria-label="Lokasi penerimaan"
                    onChange={(e) =>
                      setReceiptForm((c) => ({ ...c, warehouseId: e.target.value }))
                    }
                  >
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                        {warehouse.active ? "" : " (nonaktif)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Catatan
                  <Input
                    className="mt-1"
                    value={receiptForm.note}
                    placeholder="Surat jalan 123/IX"
                    onChange={(e) =>
                      setReceiptForm((c) => ({ ...c, note: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="space-y-2">
                {selectedOrder?.lines.map((line) => (
                  <div key={line.productId} className="grid items-center gap-2 md:grid-cols-4">
                    <span className="text-xs md:col-span-2">
                      {line.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · sisa {lineRemaining(line)} dari {line.quantity}
                      </span>
                    </span>
                    <label className="text-xs text-muted-foreground">
                      Terima
                      <Input
                        className="mt-1 font-mono"
                        type="number"
                        min={0}
                        aria-label={`Terima ${line.name}`}
                        value={
                          receiptForm.quantities[line.productId] ??
                          String(lineRemaining(line))
                        }
                        onChange={(e) =>
                          setReceiptForm((c) => ({
                            ...c,
                            quantities: {
                              ...c.quantities,
                              [line.productId]: e.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <span className="text-right font-mono text-xs text-muted-foreground">
                      {formatIDR(
                        Number(
                          receiptForm.quantities[line.productId] ??
                            String(lineRemaining(line)),
                        ) * line.unitCost,
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <Button disabled={busy || !canReceive || !selectedOrder} onClick={submitReceipt}>
                <PackageCheck />
                Terima barang
              </Button>
              {!canReceive && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="size-3.5" />
                  Menerima barang butuh izin `purchase.receive` (staf gudang,
                  manajer, pemilik).
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------- Hutang usaha (AP) ----------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4" />
            Hutang usaha (AP)
          </CardTitle>
          <CardDescription>
            Barang yang datang dengan tempo supplier menjadi hutang dengan jatuh
            tempo sendiri; pelunasan boleh sebagian, dan umurnya dihitung dari
            tagihannya — bukan dari perkiraan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canSeePayables ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-3.5" />
              Hutang supplier hanya terlihat oleh peran dengan izin `payable.view`
              (keuangan, manajer, pemilik).
            </p>
          ) : payables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada tagihan supplier. Terima barang dari supplier bertempo,
              atau catat tagihan lama di bawah.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    label: "Total hutang terbuka",
                    value: formatIDR(payableSummary.outstanding),
                    hint: `${payableSummary.openCount} tagihan belum lunas`,
                  },
                  {
                    label: "Lewat jatuh tempo",
                    value: formatIDR(payableSummary.overdueAmount),
                    hint:
                      payableSummary.overdueCount > 0
                        ? `${payableSummary.overdueCount} supplier tidak dilayani PO baru`
                        : "tidak ada yang menunggak",
                    alarm: payableSummary.overdueAmount > 0,
                  },
                  {
                    label: "Jatuh tempo ≤ 7 hari",
                    value: formatIDR(payableSummary.dueSoonAmount),
                    hint: "siapkan pembayaran",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className={cn(
                      "rounded-lg border px-4 py-3",
                      stat.alarm
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border/60 bg-secondary/20",
                    )}
                  >
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                    <div
                      className={cn(
                        "font-mono text-lg font-bold",
                        stat.alarm && "text-destructive",
                      )}
                    >
                      {stat.value}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{stat.hint}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {canPay && <th className="px-2 py-2" aria-label="Pilih untuk bayar sekaligus" />}
                      <th className="px-2 py-2">Nomor</th>
                      <th className="px-2 py-2">Supplier</th>
                      <th className="px-2 py-2">Asal</th>
                      <th className="px-2 py-2">Jatuh tempo</th>
                      <th className="px-2 py-2">Umur</th>
                      <th className="px-2 py-2">3 arah</th>
                      <th className="px-2 py-2 text-right">Sisa</th>
                      {canPay && <th className="px-2 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {payables.map((payable) => (
                      <tr key={payable.id} className="border-t border-border/60">
                        {canPay && (
                          <td className="px-2 py-2">
                            {payable.balance > 0 && (
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                aria-label={`Pilih ${payable.number} untuk bayar sekaligus`}
                                checked={batchIds.includes(payable.id)}
                                disabled={payable.decision?.kind === "disputed"}
                                title={
                                  payable.decision?.kind === "disputed"
                                    ? "Tagihan bersengketa tidak bisa dibayar"
                                    : "Pilih untuk bayar sekaligus"
                                }
                                onChange={() => toggleBatch(payable.id)}
                              />
                            )}
                          </td>
                        )}
                        <td className="px-2 py-2 font-mono text-xs">
                          {payable.number}
                          {payable.reference ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {payable.reference}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">{payable.supplierName}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">
                          {payable.source}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">
                          {formatDate(payable.dueDate)}
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            variant={
                              payable.status === "paid"
                                ? "default"
                                : payable.overdue
                                  ? "accent"
                                  : "outline"
                            }
                          >
                            {payable.status === "paid"
                              ? "lunas"
                              : payable.overdue
                                ? `lewat ${payable.daysPastDue} hari`
                                : AGING_LABELS[payable.bucket]}
                          </Badge>
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            variant={
                              payable.decision?.kind === "disputed"
                                ? "accent"
                                : payable.match.flagged
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {payable.decision?.kind === "disputed"
                              ? MATCH_DECISION_LABELS.disputed
                              : MATCH_STATUS_LABELS[payable.match.status]}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {payable.balance > 0 ? (
                            formatIDR(payable.balance)
                          ) : (
                            <span className="text-muted-foreground">
                              {formatIDR(payable.amount)} · lunas
                            </span>
                          )}
                          {payable.paidAmount > 0 && payable.balance > 0 && (
                            <span className="block text-[11px] text-muted-foreground">
                              dibayar {formatIDR(payable.paidAmount)}
                            </span>
                          )}
                        </td>
                        {canPay && (
                          <td className="px-2 py-2 text-right">
                            {payable.balance > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  setPayFor(payable.id);
                                  setPayAmount(String(payable.balance));
                                  setPayMethod("Transfer");
                                }}
                              >
                                Bayar
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {AGING_BUCKETS.map((bucket) => (
                  <span key={bucket} className="flex items-center gap-1.5">
                    <span className="text-foreground">{AGING_LABELS[bucket]}</span>
                    <span className="font-mono">{formatIDR(payableSummary.byBucket[bucket])}</span>
                  </span>
                ))}
              </div>

              {canPay && openPayables.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-secondary/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <BadgeCheck className="size-4" />
                    Bayar sekaligus
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Centang tagihan di tabel, lalu bayar semuanya dalam satu nomor batch
                    (`PAY-…`). Jejaknya tetap satu baris per tagihan, jadi rekonsiliasi bank
                    tetap bisa dicocokkan — tagihan yang sedang disengketakan tidak ikut.
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div className="text-xs text-muted-foreground">
                      {batchPayables.length} tagihan terpilih
                      <div className="font-mono text-base font-bold text-foreground">
                        {formatIDR(batchTotal)}
                      </div>
                    </div>
                    <label className="text-xs text-muted-foreground">
                      Metode
                      <select
                        className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                        value={batchMethod}
                        aria-label="Metode bayar sekaligus"
                        onChange={(e) => setBatchMethod(e.target.value as PaymentLabel)}
                      >
                        {PAYMENT_LABELS.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={busy || batchPayables.length === 0}
                        onClick={submitBatchPayment}
                      >
                        Bayar terpilih
                      </Button>
                      {batchIds.length > 0 && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setBatchIds([])}
                        >
                          Kosongkan pilihan
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {paymentBatches.length > 0 && (
                <div>
                  <div className="text-sm font-semibold">Riwayat bayar sekaligus</div>
                  <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
                    {paymentBatches.slice(0, 5).map((batch) => (
                      <li
                        key={batch.number}
                        className="rounded-lg border border-border/60 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-foreground">{batch.number}</span>
                          <span className="font-mono text-foreground">
                            {formatIDR(batch.total)}
                          </span>
                          <span>{batch.count} tagihan</span>
                          <span>{batch.method}</span>
                          <span>{formatDate(batch.at)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {batch.bills.map((bill) => (
                            <span key={bill.payableId} className="font-mono">
                              {bill.payableNumber} · {formatIDR(bill.amount)}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {canPay && (
            <div className="rounded-lg border border-border/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="size-4" />
                Catat tagihan supplier (di luar PO)
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Untuk saldo awal atau tagihan jasa. Jatuh temponya boleh sudah lewat,
                supaya umur hutang lamanya ikut benar.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-5">
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Supplier
                  <select
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                    value={billSupplierId}
                    aria-label="Supplier tagihan"
                    onChange={(e) =>
                      setBillForm((c) => ({ ...c, supplierId: e.target.value }))
                    }
                  >
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  Nomor tagihan
                  <Input
                    className="mt-1"
                    value={billForm.reference}
                    placeholder="INV/2026/0912"
                    onChange={(e) =>
                      setBillForm((c) => ({ ...c, reference: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Nilai
                  <Input
                    className="mt-1 font-mono"
                    type="number"
                    min={0}
                    value={billForm.amount}
                    onChange={(e) =>
                      setBillForm((c) => ({ ...c, amount: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Jatuh tempo
                  <Input
                    className="mt-1"
                    type="date"
                    value={billForm.dueDate}
                    onChange={(e) =>
                      setBillForm((c) => ({ ...c, dueDate: e.target.value }))
                    }
                  />
                </label>
                <div className="flex items-end md:col-span-5">
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      gateReason !== null ||
                      !billForm.amount ||
                      !billForm.dueDate
                    }
                    title={gateReason ?? "Catat tagihan supplier"}
                    onClick={submitBill}
                  >
                    Simpan tagihan
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground md:col-span-5">
                  Saldo awal & tagihan jasa dicatat di sini. Tagihan yang lahir dari
                  penerimaan barang dicocokkan dengan PO/GRN di bagian “Pencocokan 3 arah”
                  di bawah.
                </p>
              </div>
            </div>
          )}

          {payablePayments.length > 0 && (
            <div>
              <div className="text-sm font-semibold">Pembayaran terakhir</div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {latestPayments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap gap-2">
                    <span className="font-mono text-foreground">{payment.payableNumber}</span>
                    <span>{payment.supplierName}</span>
                    <span className="font-mono text-foreground">
                      {formatIDR(payment.amount)}
                    </span>
                    <span>{payment.method}</span>
                    <span>{formatDate(payment.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!canPay && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Melihat dan membayar hutang butuh izin `payable.view` /
              `payable.manage` (keuangan, manajer, pemilik). Hutang lama tetap bisa
              dibayar walau paketnya tidak memuat pembelian.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ------------- Pencocokan 3 arah (PO ↔ GRN ↔ tagihan) -------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            Pencocokan 3 arah (PO ↔ GRN ↔ tagihan)
          </CardTitle>
          <CardDescription>
            Dokumen yang dikirim supplier dibandingkan dengan barang yang **dipesan**
            (PO) dan yang **datang** (GRN). Selisihnya harus diputuskan: diterima
            (nilai hutang mengikuti total tagihan supplier) atau disengketakan
            (pembayarannya ditahan sampai sengketanya selesai).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canSeePayables ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-3.5" />
              Pencocokan tagihan hanya terlihat oleh peran dengan izin `payable.view`
              (keuangan, manajer, pemilik).
            </p>
          ) : (openPayables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada tagihan terbuka untuk dicocokkan.
            </p>
          ) : (
            <>
              {reviewPayables.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-accent/50 bg-accent/10 px-4 py-3 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {reviewPayables.length} tagihan perlu ditinjau lebih dulu:
                    {" "}
                    {reviewPayables
                      .slice(0, 3)
                      .map((row) => row.number)
                      .join(", ")}
                    {reviewPayables.length > 3
                      ? `, +${reviewPayables.length - 3} lagi`
                      : ""}
                    . Catat dokumen suppliernya atau selesaikan selisihnya sebelum
                    membayar.
                  </span>
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  {
                    label: "Perlu ditinjau",
                    value: String(threewaySummary.needsReview),
                    hint: `${formatIDR(threewaySummary.openVarianceValue)} selisih belum selesai`,
                    alarm: threewaySummary.needsReview > 0,
                  },
                  {
                    label: "Menunggu dokumen",
                    value: String(threewaySummary.waitingInvoice),
                    hint: "tagihan supplier belum dicatat",
                    alarm: false,
                  },
                  {
                    label: "Cocok",
                    value: String(threewaySummary.matched),
                    hint: "PO · GRN · tagihan sama",
                    alarm: false,
                  },
                  {
                    label: "Sengketa",
                    value: String(threewaySummary.disputed),
                    hint: "pembayaran ditahan",
                    alarm: threewaySummary.disputed > 0,
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className={cn(
                      "rounded-lg border px-4 py-3",
                      stat.alarm
                        ? "border-accent/50 bg-accent/10"
                        : "border-border/60 bg-secondary/20",
                    )}
                  >
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                    <div className="font-mono text-lg font-bold">{stat.value}</div>
                    <div className="text-[11px] text-muted-foreground">{stat.hint}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2">Nomor</th>
                      <th className="px-2 py-2">Supplier</th>
                      <th className="px-2 py-2">Asal</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2 text-right">Diterima</th>
                      <th className="px-2 py-2 text-right">Ditagih</th>
                      <th className="px-2 py-2 text-right">Selisih</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {matchRows.map((payable) => (
                      <tr key={payable.id} className="border-t border-border/60">
                        <td className="px-2 py-2 font-mono text-xs">
                          {payable.number}
                          {payable.invoice?.reference ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {payable.invoice.reference}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">{payable.supplierName}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">
                          {payable.source}
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            variant={
                              payable.decision?.kind === "disputed"
                                ? "accent"
                                : payable.match.flagged
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {payable.decision?.kind === "accepted"
                              ? MATCH_DECISION_LABELS.accepted
                              : payable.decision?.kind === "disputed"
                                ? MATCH_DECISION_LABELS.disputed
                                : MATCH_STATUS_LABELS[payable.match.status]}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                          {formatIDR(payable.match.receivedValue)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                          {payable.match.billedValue === undefined
                            ? "—"
                            : formatIDR(payable.match.billedValue)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right font-mono",
                            payable.match.flagged && "text-accent",
                          )}
                        >
                          {payable.match.valueVariance === undefined
                            ? "—"
                            : formatIDR(payable.match.valueVariance)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canPay &&
                              payable.invoice === null &&
                              payable.match.status === "waiting_invoice" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => openInvoiceForm(payable)}
                                >
                                  Catat dokumen
                                </Button>
                              )}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                if (detailFor === payable.id) {
                                  setDetailFor(null);
                                  setInvoiceFor(null);
                                } else {
                                  setDetailFor(payable.id);
                                }
                              }}
                            >
                              {detailFor === payable.id ? "Tutup" : "Tinjau"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedMatch && (
                <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      {selectedMatch.number} · {selectedMatch.supplierName}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          selectedMatch.decision?.kind === "disputed"
                            ? "accent"
                            : selectedMatch.match.flagged
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {MATCH_STATUS_LABELS[selectedMatch.match.status]}
                      </Badge>
                      {canPay &&
                        selectedMatch.invoice === null &&
                        invoiceFor !== selectedMatch.id && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || !selectedMatch.receiptNumber}
                            title={
                              selectedMatch.receiptNumber
                                ? "Isi barisnya otomatis dari yang benar-benar diterima"
                                : "Tagihan ini tidak punya penerimaan barang untuk dicocokkan"
                            }
                            onClick={() => openInvoiceForm(selectedMatch)}
                          >
                            Catat dokumen supplier
                          </Button>
                        )}
                    </div>
                  </div>

                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {selectedMatch.match.reasons.map((reason) => (
                      <li key={reason} className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        {reason}
                      </li>
                    ))}
                  </ul>

                  {selectedMatch.match.lines.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5">Barang</th>
                            <th className="px-2 py-1.5 text-right">Pesan</th>
                            <th className="px-2 py-1.5 text-right">Datang</th>
                            <th className="px-2 py-1.5 text-right">Harga terima</th>
                            <th className="px-2 py-1.5 text-right">Ditagih</th>
                            <th className="px-2 py-1.5 text-right">Harga tagihan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedMatch.match.lines.map((line) => (
                            <tr key={line.productId} className="border-t border-border/60">
                              <td className="px-2 py-1.5">{line.name}</td>
                              <td className="px-2 py-1.5 text-right font-mono">
                                {line.orderedQty}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">
                                {line.receivedQty}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">
                                {formatIDR(line.receivedUnitCost)}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">
                                {line.billedQty === undefined ? "—" : line.billedQty}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">
                                {line.billedUnitCost === undefined
                                  ? "—"
                                  : formatIDR(line.billedUnitCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {invoiceFor === selectedMatch.id && canPay && selectedMatch.receiptNumber ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-xs text-muted-foreground">
                          Nomor tagihan supplier
                          <Input
                            className="mt-1"
                            value={invoiceForm.reference}
                            placeholder="INV/2026/0912"
                            onChange={(e) =>
                              setInvoiceForm((current) => ({
                                ...current,
                                reference: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Jatuh tempo menurut dokumen
                          <Input
                            className="mt-1"
                            type="date"
                            value={invoiceForm.dueDate}
                            onChange={(e) =>
                              setInvoiceForm((current) => ({
                                ...current,
                                dueDate: e.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1.5">Barang</th>
                              <th className="px-2 py-1.5 text-right">Datang (GRN)</th>
                              <th className="px-2 py-1.5 text-right">Ditagih</th>
                              <th className="px-2 py-1.5 text-right">Harga satuan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoiceForm.lines.map((line, index) => (
                              <tr key={line.productId} className="border-t border-border/60">
                                <td className="px-2 py-1.5">{line.name}</td>
                                <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                                  {selectedMatch.match.lines.find(
                                    (row) => row.productId === line.productId,
                                  )?.receivedQty ?? 0}
                                </td>
                                <td className="px-2 py-1.5">
                                  <Input
                                    className="ml-auto w-20 text-right font-mono"
                                    type="number"
                                    min={1}
                                    value={line.quantity}
                                    aria-label={`Jumlah ditagih ${line.name}`}
                                    onChange={(e) =>
                                      setInvoiceForm((current) => ({
                                        ...current,
                                        lines: current.lines.map((row, i) =>
                                          i === index
                                            ? { ...row, quantity: e.target.value }
                                            : row,
                                        ),
                                      }))
                                    }
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <Input
                                    className="ml-auto w-28 text-right font-mono"
                                    type="number"
                                    min={0}
                                    value={line.unitCost}
                                    aria-label={`Harga satuan ditagih ${line.name}`}
                                    onChange={(e) =>
                                      setInvoiceForm((current) => ({
                                        ...current,
                                        lines: current.lines.map((row, i) =>
                                          i === index
                                            ? { ...row, unitCost: e.target.value }
                                            : row,
                                        ),
                                      }))
                                    }
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="text-muted-foreground">
                          Total tagihan supplier:{" "}
                          <span className="font-mono text-foreground">
                            {formatIDR(invoiceTotal)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          Nilai barang diterima:{" "}
                          <span className="font-mono text-foreground">
                            {formatIDR(invoiceReceivedValue)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "font-mono",
                            invoiceTotal - invoiceReceivedValue === 0
                              ? "text-muted-foreground"
                              : "text-accent",
                          )}
                        >
                          Selisih {formatIDR(invoiceTotal - invoiceReceivedValue)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          disabled={busy || threewayGate !== null || invoiceTotal <= 0}
                          title={threewayGate ?? "Simpan & cocokkan"}
                          onClick={submitInvoice}
                        >
                          Simpan &amp; cocokkan
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setInvoiceFor(null)}
                        >
                          Batal
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Total dihitung dari barisnya, jadi baris dan total tidak pernah
                          berbeda.
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {selectedMatch.invoice !== null && canPay && (
                    <div className="space-y-3 border-t border-border/60 pt-3">
                      <div className="text-xs text-muted-foreground">
                        Dokumen supplier{" "}
                        <span className="font-mono text-foreground">
                          {selectedMatch.invoice.reference ?? "tanpa nomor"}
                        </span>{" "}
                        · total{" "}
                        <span className="font-mono text-foreground">
                          {formatIDR(selectedMatch.invoice.total)}
                        </span>{" "}
                        · dicatat {formatDate(selectedMatch.invoice.recordedAt)}
                        {selectedMatch.invoice.note
                          ? ` · ${selectedMatch.invoice.note}`
                          : ""}
                      </div>

                      {selectedMatch.decision?.kind === "accepted" ? (
                        <p className="text-xs text-muted-foreground">
                          Selisihnya diterima: nilai hutang menyesuaikan total tagihan
                          supplier ({formatIDR(selectedMatch.amount)}).
                        </p>
                      ) : selectedMatch.decision?.kind === "disputed" ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-xs text-destructive">
                            Disengketakan: {selectedMatch.decision.note}
                          </span>
                          <Button
                            variant="outline"
                            disabled={busy || threewayGate !== null}
                            onClick={() => submitDecision(selectedMatch, "none")}
                          >
                            Cabut sengketa
                          </Button>
                        </div>
                      ) : selectedMatch.match.flagged ? (
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="text-xs text-muted-foreground">
                            Catatan keputusan
                            <Input
                              className="mt-1"
                              value={decisionNote}
                              placeholder="mis. barang kurang 2 unit, potong tagihan"
                              onChange={(e) => setDecisionNote(e.target.value)}
                            />
                          </label>
                          <Button
                            disabled={busy || threewayGate !== null}
                            title={threewayGate ?? "Terima selisih"}
                            onClick={() => submitDecision(selectedMatch, "accepted")}
                          >
                            Terima selisih
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || threewayGate !== null}
                            onClick={() => submitDecision(selectedMatch, "disputed")}
                          >
                            Sengketa
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Cocok dengan PO &amp; penerimaan — tagihannya bisa langsung dibayar.
                        </p>
                      )}

                      {threewayGate !== null && (
                        <p className="text-xs text-accent">
                          {threewayGate} Pencocokan tagihan lama tetap bisa dilihat, dan
                          tagihannya tetap bisa dibayar.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Riwayat penerimaan</CardTitle>
          <CardDescription>
            Setiap GRN menaikkan stok sekali dan menyimpan harga belinya di produk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada penerimaan barang.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2",
                  )}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {receipt.number}
                  </span>
                  <span className="font-mono text-xs">PO {receipt.orderNumber}</span>
                  <span className="text-muted-foreground">{receipt.locationName}</span>
                  <span className="text-xs text-muted-foreground">
                    {receipt.lines
                      .map((line) => `${line.quantity}× ${line.name}`)
                      .join(" · ")}
                  </span>
                  <span className="font-mono">{formatIDR(receipt.total)}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(receipt.createdAt).toLocaleDateString("id-ID", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* --------------------- Dialog: ubah supplier --------------------- */}
      {editSupplier && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Ubah supplier</h3>
                <p className="text-sm text-muted-foreground">
                  Kode supplier tidak bisa diubah — sudah tercetak di PO lama.
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog supplier"
                onClick={() => setEditSupplier(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-xs text-muted-foreground">
                Nama supplier
                <Input
                  className="mt-1"
                  aria-label="Nama supplier diubah"
                  value={editSupplier.name}
                  onChange={(e) =>
                    setEditSupplier((current) =>
                      current ? { ...current, name: e.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Telepon
                <Input
                  className="mt-1 font-mono"
                  aria-label="Telepon supplier"
                  value={editSupplier.phone}
                  onChange={(e) =>
                    setEditSupplier((current) =>
                      current ? { ...current, phone: e.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Alamat
                <Input
                  className="mt-1"
                  aria-label="Alamat supplier"
                  value={editSupplier.address}
                  onChange={(e) =>
                    setEditSupplier((current) =>
                      current ? { ...current, address: e.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Tempo pembayaran (hari)
                <Input
                  className="mt-1 font-mono"
                  type="number"
                  min={0}
                  aria-label="Tempo supplier"
                  value={editSupplier.termDays}
                  onChange={(e) =>
                    setEditSupplier((current) =>
                      current ? { ...current, termDays: e.target.value } : current,
                    )
                  }
                />
              </label>
              <p className="text-[11px] text-muted-foreground">
                Tempo 0 berarti bayar langsung: penerimaan berikutnya tidak
                menghasilkan hutang. Tagihan yang sudah ada menyimpan temponya
                sendiri, jadi jatuh temponya tidak berubah.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="Supplier aktif"
                  checked={editSupplier.active}
                  onChange={(e) =>
                    setEditSupplier((current) =>
                      current ? { ...current, active: e.target.checked } : current,
                    )
                  }
                />
                Supplier aktif (siap diberi PO baru)
              </label>
            </div>

            <Button
              className="mt-5 w-full"
              disabled={busy || editSupplier.name.trim().length < 2}
              onClick={submitSupplierEdit}
            >
              <BadgeCheck />
              Simpan perubahan
            </Button>
          </div>
        </div>
      )}

      {/* ------------------- Dialog: bayar hutang supplier ------------------- */}
      {payingPayable && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Bayar hutang supplier</h3>
                <p className="text-sm text-muted-foreground">
                  {payingPayable.number} · {payingPayable.supplierName}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog pembayaran hutang"
                onClick={() => setPayFor(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 flex items-baseline justify-between rounded-lg bg-secondary/40 px-4 py-3">
              <span className="text-sm text-muted-foreground">Sisa hutang</span>
              <span className="font-mono text-xl font-bold text-primary">
                {formatIDR(payingPayable.balance)}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Jatuh tempo {formatDate(payingPayable.dueDate)}</span>
              <span>
                {payingPayable.overdue
                  ? `lewat ${payingPayable.daysPastDue} hari`
                  : AGING_LABELS[payingPayable.bucket]}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium" htmlFor="ap-amount">
                Jumlah dibayar
              </label>
              <Input
                id="ap-amount"
                type="number"
                min={0}
                className="font-mono"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              {Number(payAmount) > 0 && Number(payAmount) < payingPayable.balance && (
                <p className="text-xs text-muted-foreground">
                  Sisa setelah pembayaran:{" "}
                  {formatIDR(payingPayable.balance - Number(payAmount))}
                </p>
              )}
              {Number(payAmount) > payingPayable.balance && (
                <p className="text-xs text-destructive">
                  Melebihi sisa hutang {formatIDR(payingPayable.balance)}.
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {PAYMENT_LABELS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPayMethod(method)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                    payMethod === method
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {method}
                </button>
              ))}
            </div>

            <Button
              className="mt-6 w-full"
              size="lg"
              disabled={
                busy || !Number(payAmount) || Number(payAmount) > payingPayable.balance
              }
              onClick={submitPayablePayment}
            >
              <BadgeCheck />
              Catat pembayaran
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
