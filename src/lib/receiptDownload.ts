import { formatReceiptDate, formatRupees, type PaymentReceipt } from '@/hooks/usePaymentOrder';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const row = (label: string, value: string) =>
  `<tr><td>${escapeHtml(label)}</td><td class="right">${escapeHtml(value)}</td></tr>`;

/** A standalone, printable HTML receipt built only from the verified receipt data. */
export function buildReceiptHtml(receipt: PaymentReceipt): string {
  const courses = receipt.courses.length
    ? receipt.courses.map((c) => `<li>${escapeHtml(c.name)}</li>`).join('')
    : '<li>—</li>';
  const discountRows = receipt.discount > 0
    ? row('Course price (incl. GST)', formatRupees(receipt.subtotal)) +
      row(receipt.promoCode ? `Discount (${receipt.promoCode})` : 'Discount', `- ${formatRupees(receipt.discount)}`)
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Receipt ${escapeHtml(receipt.orderId)} | SimpleLecture</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; background: #f5f7f6; }
  .card { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 28px; border: 1px solid #e5e7eb; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #14532d; }
  .muted { color: #6b7280; font-size: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 20px 0; font-size: 14px; }
  .label { color: #6b7280; }
  .value { font-weight: 600; word-break: break-all; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 12px; }
  td { padding: 6px 0; border-top: 1px solid #f0f0f0; }
  .right { text-align: right; }
  .total td { font-weight: 700; font-size: 16px; border-top: 2px solid #1f2937; }
  .foot { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
  @media print { body { background: #fff; padding: 0; } .card { border: none; } }
</style>
</head>
<body>
<div class="card">
  <h1>Payment receipt</h1>
  <p class="muted">SimpleLecture · Payment successful</p>
  <div class="grid">
    <div><div class="label">Receipt number</div><div class="value">${escapeHtml(receipt.orderId)}</div></div>
    <div><div class="label">Date</div><div class="value">${escapeHtml(formatReceiptDate(receipt.completedAt ?? receipt.createdAt))}</div></div>
    <div><div class="label">Payment ID</div><div class="value">${escapeHtml(receipt.gatewayPaymentId ?? '—')}</div></div>
    <div><div class="label">Student</div><div class="value">${escapeHtml(receipt.studentName ?? '—')}</div><div class="muted">${escapeHtml(receipt.studentEmail ?? '')}</div></div>
  </div>
  <div class="label">Course</div>
  <ul>${courses}</ul>
  <table>
    ${discountRows}
    ${row('Base amount', formatRupees(receipt.baseAmount))}
    ${row('GST 18% (included)', formatRupees(receipt.gstAmount))}
    <tr class="total"><td>Total paid</td><td class="right">${escapeHtml(formatRupees(receipt.total))}</td></tr>
  </table>
  <p class="foot">Keep this receipt for your records. Need help? contact@simplelecture.com</p>
</div>
</body>
</html>`;
}

/** Saves the receipt as an HTML file. Falls back to opening it in a new tab. */
export function downloadReceipt(receipt: PaymentReceipt): void {
  const html = buildReceiptHtml(receipt);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const fileName = `SimpleLecture-receipt-${receipt.orderId}.html`;

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    window.open(url, '_blank');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
